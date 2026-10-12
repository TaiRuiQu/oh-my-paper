import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { z } from "zod";
import type { DigitalExam, ParsedPage, QuestionFragment } from "@/contracts/exams";
import { parsedPageSchema } from "@/contracts/exams";
import { createDeepSeekExamModel, type ExamModel } from "@/server/ai/deepseek";
import { parseExam } from "@/server/exams/parser";
import { appendParsedPage, finalizeExam } from "@/server/exams/assemble";
import { anchorGeometryRegion } from "@/server/exams/geometry";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
const region = { page: 1, x: 0.1, y: 0.1, width: 0.3, height: 0.2 };
const question = (overrides: Partial<QuestionFragment> = {}): QuestionFragment => ({
  number: "1",
  section: "一、选择题",
  type: "single_choice",
  continuation: false,
  continuesNextPage: false,
  points: 3,
  blocks: [{ type: "text", text: "如图，下列说法正确的是____。" }],
  options: [{ label: "A", blocks: [{ type: "math", latex: "\\frac{1}{2}" }] }],
  parts: [],
  materialRefs: [],
  regions: [region],
  ...overrides,
});
const parsedPage = (overrides: Partial<ParsedPage> = {}): ParsedPage => ({
  documentType: "question_paper",
  title: "测试",
  subject: "数学",
  grade: null,
  instructions: [],
  questions: [question()],
  materials: [],
  annotations: [],
  findings: [],
  ...overrides,
});
function exam(): DigitalExam {
  return {
    schemaVersion: "1.0",
    id: "test",
    title: null,
    subject: null,
    grade: null,
    sourceFiles: [],
    pages: [1, 2].map((page) => ({
      page,
      key: `${page}.jpg`,
      width: 100,
      height: 100,
      rotation: 0,
      documentType: "question_paper",
      status: "verified",
    })),
    instructions: [],
    questions: [],
    materials: [],
    annotations: [],
    assets: [],
    verification: {
      status: "partial",
      model: "test",
      promptVersion: "test",
      findings: [],
      corrections: [],
      usage: { inputTokens: 0, outputTokens: 0, calls: 0 },
    },
  };
}
async function imageInput() {
  const directory = await mkdtemp(join(tmpdir(), "exam-parser-test-"));
  directories.push(directory);
  const input = join(directory, "paper.png");
  await sharp({
    create: { width: 300, height: 200, channels: 3, background: "white" },
  })
    .png()
    .toFile(input);
  return { input, outputDir: join(directory, "output"), directory };
}
function scriptedModel(values: unknown[]): ExamModel {
  return {
    name: "test",
    async generate<T>(request: { schema: z.ZodType<T>; name: string }) {
      const value = values.shift();
      if (value instanceof Error) throw value;
      return {
        output: request.schema.parse(value),
        inputTokens: 10,
        outputTokens: 10,
      };
    },
  };
}
describe("exam parsing", () => {
  it("merges cross-page options and subparts, but preserves section number resets", () => {
    const result = exam();
    appendParsedPage(
      result,
      parsedPage({
        questions: [
          question({
            continuesNextPage: true,
            parts: [
              {
                label: "(1)",
                parentLabel: null,
                points: null,
                blocks: [{ type: "text", text: "第一部分" }],
              },
            ],
          }),
        ],
      }),
      1,
    );
    appendParsedPage(
      result,
      parsedPage({
        questions: [
          question({
            continuation: true,
            blocks: [{ type: "text", text: "续接条件" }],
            regions: [{ ...region, page: 2 }],
            options: [{ label: "B", blocks: [{ type: "text", text: "另一个选项" }] }],
            parts: [
              {
                label: "(1)",
                parentLabel: null,
                points: null,
                blocks: [{ type: "text", text: "剩余条件" }],
              },
            ],
          }),
          question({
            section: "二、解答题",
            regions: [{ ...region, page: 2 }],
          }),
        ],
      }),
      2,
    );
    expect(result.questions).toHaveLength(2);
    expect(result.questions[0].regions.map((r) => r.page)).toEqual([1, 2]);
    expect(result.questions[0].options.map((o) => o.label)).toEqual(["A", "B"]);
    expect(result.questions[0].parts[0].blocks).toHaveLength(2);
  });

  it("preserves duplicate questions for review and flags missing materials", () => {
    const result = exam();
    appendParsedPage(
      result,
      parsedPage({
        questions: [question({ materialRefs: ["absent"] }), question()],
      }),
      1,
    );
    finalizeExam(result, []);
    expect(result.questions).toHaveLength(2);
    expect(result.verification.findings.map((f) => f.code)).toEqual(
      expect.arrayContaining(["duplicate_question", "missing_material"]),
    );
    expect(result.verification.status).toBe("needs_review");
  });

  it("merges shared cross-page materials once and preserves question references", () => {
    const result = exam();
    const first = {
      key: "reading-I",
      title: "阅读材料",
      section: "阅读",
      blocks: [{ type: "text" as const, text: "第一段" }],
      regions: [region],
      continuation: false,
      continuesNextPage: true,
    };
    appendParsedPage(
      result,
      parsedPage({
        questions: [question({ materialRefs: [first.key] })],
        materials: [first],
      }),
      1,
    );
    appendParsedPage(
      result,
      parsedPage({
        questions: [
          question({
            number: "2",
            materialRefs: [first.key],
            regions: [{ ...region, page: 2 }],
          }),
        ],
        materials: [
          {
            ...first,
            blocks: [{ type: "text", text: "续段" }],
            regions: [{ ...region, page: 2 }],
            continuation: true,
            continuesNextPage: false,
          },
        ],
      }),
      2,
    );
    expect(result.materials).toHaveLength(1);
    expect(result.materials[0].blocks).toHaveLength(2);
    expect(result.materials[0].continuesNextPage).toBe(false);
    expect(result.questions.every((q) => q.materialRefs[0] === "reading-I")).toBe(true);
  });

  it("preserves printed table rows as selectable choices without leaking selected answers", () => {
    const result = exam();
    appendParsedPage(
      result,
      parsedPage({
        questions: [
          question({
            options: [],
            blocks: [
              { type: "text", text: "下列说法正确的是____。" },
              {
                type: "table",
                rows: [
                  ["选项", "陈述I", "陈述II"],
                  ["A", "陈述A", "原因A"],
                  ["B", "陈述B", "原因B"],
                ],
              },
            ],
          }),
        ],
      }),
      1,
    );
    expect(result.questions[0].options.map((option) => option.label)).toEqual(["A", "B"]);
    expect(result.questions[0].blocks).toHaveLength(1);
    expect(result.questions[0].options[0].blocks).toEqual([
      {
        type: "table",
        rows: [
          ["陈述I", "陈述II"],
          ["陈述A", "原因A"],
        ],
      },
    ]);
  });

  it("rejects disguised unsupported files, page limits, and cancellation", async () => {
    const { input, directory, outputDir } = await imageInput();
    const invalid = join(directory, "fake.pdf");
    await writeFile(invalid, "not a PDF");
    await expect(
      parseExam({ files: [invalid], outputDir, model: scriptedModel([]) }),
    ).rejects.toThrow(/Supported exam formats/);
    await expect(
      parseExam({
        files: [input],
        outputDir: join(directory, "negative"),
        limits: { maxPages: 0 },
        model: scriptedModel([]),
      }),
    ).rejects.toThrow(/positive integers/);
    const signal = AbortSignal.abort();
    await expect(
      parseExam({
        files: [input],
        outputDir: join(directory, "canceled"),
        model: scriptedModel([]),
        signal,
      }),
    ).rejects.toThrow();
  });

  it("anchors a clipped geometry box to complete source strokes", async () => {
    const { input } = await imageInput();
    await sharp(
      Buffer.from(
        '<svg width="300" height="200"><rect width="300" height="200" fill="white"/><path d="M 90 70 L 220 70 L 160 115 Z" fill="none" stroke="black" stroke-width="2"/></svg>',
      ),
    )
      .png()
      .toFile(input);
    const anchored = await anchorGeometryRegion(
      {
        page: 1,
        key: "1.png",
        path: input,
        width: 300,
        height: 200,
        rotation: 0,
        text: "",
        isPhotograph: false,
      },
      { page: 1, x: 0.35, y: 0.3, width: 0.32, height: 0.25 },
    );
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
      return Response.json({
        id: "response-test",
        object: "response",
        created_at: 1,
        status: "completed",
        model: "deepseek-flash",
        output: [
          {
            type: "message",
            id: "msg-test",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: '{"ok":true}', annotations: [] }],
          },
        ],
        usage: {
          input_tokens: 8,
          output_tokens: 5,
          total_tokens: 13,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens_details: { reasoning_tokens: 0 },
        },
      });
    };
    const model = createDeepSeekExamModel({ apiKey: "test", fetch: mockFetch });
    const result = await model.generate({
      name: "test",
      schema: z.object({ ok: z.boolean() }),
      system: "Return JSON",
      content: [
        {
          type: "file",
          data: new Uint8Array([1, 2, 3]),
          mediaType: "image/jpeg",
        },
      ],
    });
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
    const mockFetch: typeof fetch = async () =>
      Response.json({
        id: "response",
        object: "response",
        created_at: 1,
        model: "deepseek-flash",
        status: "completed",
        output: [
          {
            type: "message",
            id: "msg",
            role: "assistant",
            status: "completed",
            content: [
              {
                type: "output_text",
                text: ++calls === 1 ? '{"ok",true}' : '{"ok":true}',
                annotations: [],
              },
            ],
          },
        ],
        usage: { input_tokens: 8, output_tokens: 5, total_tokens: 13 },
      });
    const result = await createDeepSeekExamModel({
      apiKey: "test",
      fetch: mockFetch,
    }).generate({
      schema: z.object({ ok: z.boolean() }),
      name: "test",
      system: "JSON only",
      content: "Read an exam",
    });
    expect(result).toMatchObject({
      output: { ok: true },
      calls: 2,
      inputTokens: 16,
      outputTokens: 10,
    });
  });
  it("rejects token-truncated results even if their JSON happens to validate", async () => {
    const mockFetch: typeof fetch = async () =>
      Response.json({
        id: "response",
        object: "response",
        created_at: 1,
        model: "deepseek-flash",
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        output: [
          {
            type: "message",
            id: "msg",
            role: "assistant",
            status: "incomplete",
            content: [{ type: "output_text", text: '{"ok":true}', annotations: [] }],
          },
        ],
        usage: { input_tokens: 8, output_tokens: 5, total_tokens: 13 },
      });
    await expect(
      createDeepSeekExamModel({ apiKey: "test", fetch: mockFetch }).generate({
        schema: z.object({ ok: z.boolean() }),
        name: "test",
        system: "JSON only",
        content: "Read an exam",
      }),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        message: expect.stringContaining("incomplete"),
      }),
      usage: { calls: 1, inputTokens: 8, outputTokens: 5 },
    });
  });
});
