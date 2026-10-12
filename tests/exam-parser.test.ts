import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { z } from "zod";
import type { DigitalExam, ParsedPage, QuestionFragment } from "@/contracts/exams";
import { parsedPageSchema } from "@/contracts/exams";
import { createDeepSeekExamModel, type ExamModel } from "@/server/ai/deepseek";
import { parseExam } from "@/server/exams/parser";
import { appendParsedPage, finalizeExam } from "@/server/exams/assemble";
import { exportExamMarkdown } from "@/server/exams/export";
import { anchorGeometryRegion } from "@/server/exams/geometry";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
const region = { page: 1, x: 0.1, y: 0.1, width: 0.3, height: 0.2 };
const question = (overrides: Partial<QuestionFragment> = {}): QuestionFragment => ({
  number: "1", section: "一、选择题", type: "single_choice", continuation: false, continuesNextPage: false,
  points: 3, blocks: [{ type: "text", text: "如图，下列说法正确的是____。" }],
  options: [{ label: "A", blocks: [{ type: "math", latex: "\\frac{1}{2}" }] }],
  parts: [], materialRefs: [], regions: [region], ...overrides,
});
const parsedPage = (overrides: Partial<ParsedPage> = {}): ParsedPage => ({
  documentType: "question_paper", title: "测试", subject: "数学", grade: null, instructions: [],
  questions: [question()], materials: [], annotations: [], findings: [], ...overrides,
});
function exam(): DigitalExam {
  return { schemaVersion: "1.0", id: "test", title: null, subject: null, grade: null, sourceFiles: [],
    pages: [1, 2].map((page) => ({ page, key: `${page}.jpg`, width: 100, height: 100, rotation: 0, documentType: "question_paper", status: "verified" })),
    instructions: [], questions: [], materials: [], annotations: [], assets: [],
    verification: { status: "partial", model: "test", promptVersion: "test", findings: [], corrections: [], usage: { inputTokens: 0, outputTokens: 0, calls: 0 } } };
}
async function imageInput() {
  const directory = await mkdtemp(join(tmpdir(), "exam-parser-test-")); directories.push(directory);
  const input = join(directory, "paper.png");
  await sharp({ create: { width: 300, height: 200, channels: 3, background: "white" } }).png().toFile(input);
  return { input, outputDir: join(directory, "output"), directory };
}
function scriptedModel(values: unknown[]): ExamModel {
  return { name: "test", async generate<T>(request: { schema: z.ZodType<T>; name: string }) {
    if (request.name === "exam_figure_bounds") return { output: request.schema.parse({ figures: [{ index: 0,
      left: 0.1, top: 0.1, right: 0.4, bottom: 0.3, contaminated: true, role: "question_figure", issue: null }] }), inputTokens: 10, outputTokens: 20 };
    if (request.name === "exam_layout") {
      const page = values[0] as ParsedPage;
      return { output: request.schema.parse({ documentType: page.documentType,
        questions: page.questions.map((q) => ({ number: q.number, section: q.section, continuation: q.continuation })), description: "Test inventory" }), inputTokens: 10, outputTokens: 20 };
    }
    const value = values.shift();
    if (value instanceof Error) throw value;
    return { output: request.schema.parse(value), inputTokens: 10, outputTokens: 20 };
  } };
}

describe("exam parsing", () => {
  it("merges cross-page options and subparts, but preserves section number resets", () => {
    const result = exam();
    appendParsedPage(result, parsedPage({ questions: [question({ continuesNextPage: true,
      parts: [{ label: "(1)", parentLabel: null, points: null, blocks: [{ type: "text", text: "第一部分" }] }] })] }), 1);
    appendParsedPage(result, parsedPage({ questions: [question({ continuation: true,
      blocks: [{ type: "text", text: "续接条件" }], regions: [{ ...region, page: 2 }],
      options: [{ label: "B", blocks: [{ type: "text", text: "另一个选项" }] }],
      parts: [{ label: "(1)", parentLabel: null, points: null, blocks: [{ type: "text", text: "剩余条件" }] }] }),
      question({ section: "二、解答题", regions: [{ ...region, page: 2 }] })] }), 2);
    expect(result.questions).toHaveLength(2);
    expect(result.questions[0].regions.map((r) => r.page)).toEqual([1, 2]);
    expect(result.questions[0].options.map((o) => o.label)).toEqual(["A", "B"]);
    expect(result.questions[0].parts[0].blocks).toHaveLength(2);
  });

  it("preserves duplicate questions for review and flags missing materials", () => {
    const result = exam();
    appendParsedPage(result, parsedPage({ questions: [question({ materialRefs: ["absent"] }), question()] }), 1);
    finalizeExam(result, []);
    expect(result.questions).toHaveLength(2);
    expect(result.verification.findings.map((f) => f.code)).toEqual(expect.arrayContaining(["duplicate_question", "missing_material"]));
    expect(result.verification.status).toBe("needs_review");
  });

  it("merges shared cross-page materials once and preserves question references", () => {
    const result = exam();
    const first = { key: "reading-I", title: "阅读材料", section: "阅读", blocks: [{ type: "text" as const, text: "第一段" }],
      regions: [region], continuation: false, continuesNextPage: true };
    appendParsedPage(result, parsedPage({ questions: [question({ materialRefs: [first.key] })], materials: [first] }), 1);
    appendParsedPage(result, parsedPage({ questions: [question({ number: "2", materialRefs: [first.key], regions: [{ ...region, page: 2 }] })],
      materials: [{ ...first, blocks: [{ type: "text", text: "续段" }], regions: [{ ...region, page: 2 }], continuation: true, continuesNextPage: false }] }), 2);
    expect(result.materials).toHaveLength(1);
    expect(result.materials[0].blocks).toHaveLength(2);
    expect(result.materials[0].continuesNextPage).toBe(false);
    expect(result.questions.every((q) => q.materialRefs[0] === "reading-I")).toBe(true);
  });

  it("preserves printed table rows as selectable choices without leaking selected answers", () => {
    const result = exam();
    appendParsedPage(result, parsedPage({ questions: [question({ options: [], blocks: [
      { type: "text", text: "下列说法正确的是____。" },
      { type: "table", rows: [["选项", "陈述I", "陈述II"], ["A", "陈述A", "原因A"], ["B", "陈述B", "原因B"]] },
    ] })] }), 1);
    expect(result.questions[0].options.map((option) => option.label)).toEqual(["A", "B"]);
    expect(result.questions[0].blocks).toHaveLength(1);
    expect(result.questions[0].options[0].blocks).toEqual([{ type: "table", rows: [["陈述I", "陈述II"], ["陈述A", "原因A"]] }]);
  });

  it("rotates photographs, uses verifier corrections, crops evidence and withholds polluted figures", async () => {
    const { input, outputDir } = await imageInput();
    const draft = parsedPage({ questions: [question({ blocks: [{ type: "text", text: "错误草稿" }] })] });
    const verified = parsedPage({ questions: [question({ blocks: [
      { type: "text", text: "正确题干" }, { type: "figure", caption: "几何图", region, contaminated: true },
    ] })], annotations: [{ questionNumber: "1", section: "一、选择题", partLabel: null,
      kind: "student_answer", blocks: [{ type: "text", text: "学生答案秘密" }], regions: [region] }] });
    const result = await parseExam({ files: [input], outputDir,
      model: scriptedModel([{ clockwiseDegrees: "270" }, draft, { page: verified, corrections: ["修正题干"] }]) });
    expect(result.pages[0]).toMatchObject({ width: 200, height: 300, rotation: 270 });
    expect(result.questions[0].blocks[0]).toEqual({ type: "text", text: "正确题干" });
    expect(result.questions[0].status).toBe("needs_review");
    expect(result.assets[0].cleanKey).toBeNull();
    const crop = await sharp(join(outputDir, result.assets[0].evidenceKey)).metadata();
    expect(crop.width).toBe(60); expect(crop.height).toBe(60);
    const markdown = await readFile(join(outputDir, "exam.md"), "utf8");
    expect(markdown).toContain("图像待复核");
    expect(markdown).not.toContain("学生答案秘密");
    expect(markdown).not.toContain("错误草稿");
    expect(markdown).not.toContain("figures/");
    expect(result.verification.usage.calls).toBe(5);
    await expect(parseExam({ files: [input], outputDir, model: scriptedModel([]) })).rejects.toThrow();
  });

  it("keeps answer-key-only pages free of invented questions", async () => {
    const { input, outputDir } = await imageInput();
    const page = parsedPage({ documentType: "answer_key", questions: [], annotations: [{
      questionNumber: "1", section: "阅读", partLabel: null, kind: "reference_answer",
      blocks: [{ type: "text", text: "C，解析..." }], regions: [region],
    }] });
    const result = await parseExam({ files: [input], outputDir,
      model: scriptedModel([{ clockwiseDegrees: "0" }, page, { page: { ...page, questions: [question()] }, corrections: [] }]) });
    expect(result.questions).toHaveLength(0); expect(result.annotations.length).toBeGreaterThanOrEqual(1);
    expect(exportExamMarkdown(result)).not.toContain("C，解析");
  });

  it("saves unverified drafts as review work and failed pages as partial", async () => {
    const first = await imageInput();
    const result = await parseExam({ files: [first.input], outputDir: first.outputDir,
      model: scriptedModel([{ clockwiseDegrees: "0" }, parsedPage(), new Error("provider secret must not leak")]) });
    expect(result.questions[0].status).toBe("needs_review");
    expect(JSON.stringify(result)).not.toContain("provider secret");
    expect(result.verification.findings.some((finding) => finding.code === "verification_failed")).toBe(true);
    const second = await imageInput();
    const failed = await parseExam({ files: [second.input], outputDir: second.outputDir,
      model: scriptedModel([new Error("offline")]) });
    expect(failed.verification.status).toBe("partial");
    expect(failed.questions).toHaveLength(0);
  });

  it("rejects disguised unsupported files, page limits, and cancellation", async () => {
    const { input, directory, outputDir } = await imageInput();
    const invalid = join(directory, "fake.pdf"); await writeFile(invalid, "not a PDF");
    await expect(parseExam({ files: [invalid], outputDir, model: scriptedModel([]) })).rejects.toThrow(/Supported exam formats/);
    await expect(parseExam({ files: [input], outputDir: join(directory, "negative"), limits: { maxPages: 0 }, model: scriptedModel([]) })).rejects.toThrow(/positive integers/);
    const signal = AbortSignal.abort();
    await expect(parseExam({ files: [input], outputDir: join(directory, "canceled"), model: scriptedModel([]), signal })).rejects.toThrow();
  });

  it("does not crop figures pointing at an adjacent page", async () => {
    const { input, outputDir } = await imageInput();
    const page = parsedPage({ questions: [question({ blocks: [{ type: "figure", caption: "无效", region: { ...region, page: 2 }, contaminated: false }] })] });
    const result = await parseExam({ files: [input], outputDir,
      model: scriptedModel([{ clockwiseDegrees: "0" }, page, { page, corrections: [] }]) });
    expect(result.assets).toHaveLength(0);
    expect(result.verification.findings.some((f) => f.code === "invalid_source_region")).toBe(true);
  });

  it("anchors a clipped geometry box to complete source strokes", async () => {
    const { input } = await imageInput();
    await sharp(Buffer.from('<svg width="300" height="200"><rect width="300" height="200" fill="white"/><path d="M 90 70 L 220 70 L 160 115 Z" fill="none" stroke="black" stroke-width="2"/></svg>')).png().toFile(input);
    const anchored = await anchorGeometryRegion({ page: 1, key: "1.png", path: input, width: 300, height: 200,
      rotation: 0, text: "", isPhotograph: false }, { page: 1, x: 0.35, y: 0.3, width: 0.32, height: 0.25 });
    expect(anchored).not.toBeNull();
    expect(anchored!.x).toBeLessThan(90 / 300);
    expect(anchored!.x + anchored!.width).toBeGreaterThan(220 / 300);
    expect(anchored!.y + anchored!.height).toBeGreaterThan(115 / 200);
  });
});

describe("DeepSeek Responses adapter", () => {
  it("sends schema and inline images to /responses using deepseek-flash", async () => {
    let requestBody: Record<string, unknown> = {};
    const mockFetch: typeof fetch = async (input, init) => {
      expect(String(input)).toBe("https://api.deepseek.com/responses");
      requestBody = JSON.parse(String(init?.body));
      return Response.json({ id: "response-test", object: "response", created_at: 1, status: "completed",
        model: "deepseek-flash", output: [{ type: "message", id: "msg-test", role: "assistant", status: "completed",
          content: [{ type: "output_text", text: '{"ok":true}', annotations: [] }] }],
        usage: { input_tokens: 8, output_tokens: 5, total_tokens: 13, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } },
      });
    };
    const model = createDeepSeekExamModel({ apiKey: "test", fetch: mockFetch });
    const result = await model.generate({ name: "test", schema: z.object({ ok: z.boolean() }), system: "Return JSON",
      content: [{ type: "file", data: new Uint8Array([1, 2, 3]), mediaType: "image/jpeg" }] });
    expect(result.output).toEqual({ ok: true });
    expect(requestBody.model).toBe("deepseek-flash");
    expect(requestBody.store).toBe(false);
    expect(JSON.stringify(requestBody.input)).toContain("input_image");
    expect(JSON.stringify(requestBody.text)).toContain("json_schema");
  });
  it("requires API credentials without invoking the network", () => {
    expect(() => createDeepSeekExamModel({ apiKey: "" })).toThrow(/DEEPSEEK_API_KEY/);
    expect(parsedPageSchema.safeParse({ questions: [] }).success).toBe(false);
  });
  it("repairs malformed JSON once and counts both model outputs", async () => {
    let calls = 0;
    const mockFetch: typeof fetch = async () => Response.json({
      id: "response", object: "response", created_at: 1, model: "deepseek-flash", status: "completed",
      output: [{ type: "message", id: "msg", role: "assistant", status: "completed", content: [{
        type: "output_text", text: ++calls === 1 ? '{"ok",true}' : '{"ok":true}', annotations: [],
      }] }], usage: { input_tokens: 8, output_tokens: 5, total_tokens: 13 },
    });
    const result = await createDeepSeekExamModel({ apiKey: "test", fetch: mockFetch }).generate({
      schema: z.object({ ok: z.boolean() }), name: "test", system: "JSON only", content: "Read an exam",
    });
    expect(result).toMatchObject({ output: { ok: true }, calls: 2, inputTokens: 16, outputTokens: 10 });
  });
  it("rejects token-truncated results even if their JSON happens to validate", async () => {
    const mockFetch: typeof fetch = async () => Response.json({
      id: "response", object: "response", created_at: 1, model: "deepseek-flash", status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" }, output: [{ type: "message", id: "msg", role: "assistant", status: "incomplete",
        content: [{ type: "output_text", text: '{"ok":true}', annotations: [] }] }], usage: { input_tokens: 8, output_tokens: 5, total_tokens: 13 },
    });
    await expect(createDeepSeekExamModel({ apiKey: "test", fetch: mockFetch }).generate({
      schema: z.object({ ok: z.boolean() }), name: "test", system: "JSON only", content: "Read an exam",
    })).rejects.toMatchObject({ cause: expect.objectContaining({ message: expect.stringContaining("incomplete") }), usage: { calls: 1, inputTokens: 8, outputTokens: 5 } });
  });
});
