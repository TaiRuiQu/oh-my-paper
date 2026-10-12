import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { parseExam } from "@/server/exams/parser";
import { readActivity } from "@/server/exams/activity";
import { agentFixture, metadata, question, region } from "./recognition-fixture";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function inputs(count = 1) {
  const dir = await mkdtemp(join(tmpdir(), "recognition-"));
  dirs.push(dir);
  const files = [];
  for (let i = 0; i < count; i++) {
    const path = join(dir, `${i}.png`);
    await sharp({ create: { width: 400, height: 300, channels: 3, background: "white" } })
      .png()
      .toFile(path);
    files.push(path);
  }
  return { files, outputDir: join(dir, "output") };
}
describe("autonomous recognition contract", () => {
  it("accepts agent-chosen tool order, revisions and section resets without per-question model calls", async () => {
    const input = await inputs(2);
    const markdown = "已知 $x^2+\\frac{1}{2}=0$。\n\n| 量 | 值 |\n| --- | --- |\n| $a$ | 2 |";
    const model = agentFixture(async (request, call) => {
      await call("save_questions", { questions: [{ ...question, markdown: "草稿" }] });
      expect(await call("finish", { questionCount: 1, summary: "" })).toMatchObject({
        accepted: false,
      });
      await call("read_pages", { pages: [2, 1] });
      await call("save_document", metadata(2));
      await call("save_questions", {
        questions: [
          { ...question, markdown },
          { ...question, order: 2, section: "选做题", regions: [{ ...region, page: 2 }] },
        ],
      });
      const patch = request.tools.revise_question.inputSchema;
      // The real SDK parses inputs before execute; optional defaults must not erase saved fields.
      const parsed = (patch as { parse: (value: unknown) => unknown }).parse({
        order: 1,
        regions: [region],
      });
      expect(parsed).toEqual({ order: 1, regions: [region] });
      await call("revise_question", parsed);
      expect(await call("finish", { questionCount: 2, summary: "已核对" })).toMatchObject({
        accepted: true,
      });
    });
    const exam = await parseExam({ ...input, model, generateAnswers: false });
    expect(exam.questions.map((q) => q.number)).toEqual(["1", "1"]);
    expect(exam.questions[0].blocks).toEqual([{ type: "text", text: markdown }]);
    expect(exam.questions.every((q) => q.crops?.length === 1 && !q.solution)).toBe(true);
    const raw = JSON.parse(await readFile(join(input.outputDir, "recognition.json"), "utf8"));
    expect(raw.questions[0].markdown).toBe(markdown);
    expect(JSON.stringify(raw)).not.toContain('"blocks"');
    const events = await readActivity(input.outputDir);
    expect(events.at(-1)?.type).toBe("completed");
    expect(events.filter((e) => e.type === "tool_call").map((e) => e.tool)).toEqual([
      "save_questions",
      "finish",
      "read_pages",
      "save_document",
      "save_questions",
      "revise_question",
      "finish",
    ]);
    expect(await readActivity(input.outputDir, events.at(-2)!.sequence)).toHaveLength(1);
  });
  it("preserves cross-page regions, Markdown figure order and contaminated evidence", async () => {
    const input = await inputs(2);
    const model = agentFixture(async (request, call) => {
      await call("read_pages", { pages: [1, 2] });
      await call("save_document", metadata(2));
      await call("save_questions", {
        questions: [
          {
            ...question,
            regions: [region, { ...region, page: 2 }],
            markdown: "条件\n![图](f1)\n表后条件",
            figures: [{ id: "f1", caption: "图", region, contaminated: true }],
          },
        ],
      });
      const reviewed = await call("review_questions", { orders: [1] });
      const content = await request.tools.review_questions.toModelOutput!({
        toolCallId: "review",
        input: { orders: [1] },
        output: reviewed,
      });
      expect(content.type).toBe("content");
      if (content.type === "content")
        expect(content.value.filter((v) => v.type === "file")).toHaveLength(4);
      expect(reviewed.contextPages).toEqual([1, 2]);
      expect(await call("finish", { questionCount: 1, summary: "" })).toMatchObject({
        accepted: true,
      });
    });
    const exam = await parseExam({ ...input, model, generateAnswers: false });
    expect(exam.questions[0].blocks.map((b) => b.type)).toEqual(["text", "figure", "text"]);
    expect(exam.questions[0].crops).toHaveLength(2);
    expect(exam.assets[0].cleanKey).toBeNull();
    expect(exam.questions[0].status).toBe("needs_review");
    expect((await sharp(join(input.outputDir, exam.assets[0].evidenceKey)).metadata()).width).toBe(
      240,
    );
  });
  it("rejects invalid regions and unknown figures and allows the agent to correct them", async () => {
    const input = await inputs();
    const model = agentFixture(async (_request, call) => {
      expect(
        await call("save_questions", {
          questions: [{ ...question, regions: [{ ...region, page: 2 }] }],
        }),
      ).toMatchObject({ accepted: false });
      expect(
        await call("save_questions", { questions: [{ ...question, markdown: "![x](invented)" }] }),
      ).toMatchObject({ accepted: false });
      expect(
        await call("save_questions", { questions: [{ ...question, markdown: "选项①\\u3000②" }] }),
      ).toMatchObject({ accepted: false });
      await call("read_pages", { pages: [1] });
      await call("save_document", metadata());
      await call("save_questions", { questions: [question] });
      await call("finish", { questionCount: 1, summary: "" });
    });
    expect((await parseExam({ ...input, model, generateAnswers: false })).assets).toHaveLength(0);
  });
  it("imports answer-only documents without inventing questions", async () => {
    const input = await inputs();
    const model = agentFixture(async (_request, call) => {
      await call("read_pages", { pages: [1] });
      await call("save_document", metadata(1, "answer_key"));
      expect(await call("finish", { questionCount: 0, summary: "" })).toMatchObject({
        accepted: false,
      });
      await call("save_annotations", {
        annotations: [
          {
            id: "r1",
            questionNumber: "1",
            section: "阅读",
            partLabel: null,
            kind: "reference_answer",
            markdown: "C，解析 $a=2$",
            regions: [region],
            figures: [],
          },
        ],
      });
      await call("finish", { questionCount: 0, summary: "" });
    });
    const exam = await parseExam({ ...input, model, generateAnswers: false });
    expect(exam.questions).toHaveLength(0);
    expect(exam.annotations[0].kind).toBe("reference_answer");
  });
  it("requires declared student evidence on every page before accepting completion", async () => {
    const input = await inputs(2);
    const model = agentFixture(async (request, call) => {
      expect(JSON.stringify(request.content)).toContain("Extract every student response");
      await call("read_pages", { pages: [1, 2] });
      const document = metadata(2, "answer_sheet");
      await call("save_document", document);
      const answer = {
        id: "a1",
        questionNumber: null,
        section: "",
        partLabel: null,
        kind: "student_answer",
        markdown: "[unreadable]",
        regions: [region],
        figures: [],
      };
      await call("save_annotations", { annotations: [answer] });
      const reviewed = await call("review_annotations", { ids: [answer.id] });
      expect(reviewed).toMatchObject({ annotations: [answer], contextPages: [1] });
      expect(reviewed.images).toHaveLength(2);
      expect(await call("finish", { questionCount: 0, summary: "" })).toMatchObject({
        accepted: false,
        errors: [expect.stringContaining("Page 2 has student_answer")],
      });
      await call("save_annotations", {
        annotations: [{ ...answer, id: "a2", markdown: "", regions: [{ ...region, page: 2 }] }],
      });
      expect(await call("finish", { questionCount: 0, summary: "" })).toMatchObject({
        accepted: true,
      });
    });
    const exam = await parseExam({
      ...input,
      model,
      generateAnswers: false,
      extractStudentAnswers: true,
    });
    expect(exam.answerDocument?.responses).toHaveLength(2);
    expect(exam.answerDocument?.responses[1].blank).toBe(true);
  });
  it("rejects evidence crops that exclude a question figure, including during revisions", async () => {
    const input = await inputs();
    const model = agentFixture(async (_request, call) => {
      await call("read_pages", { pages: [1] });
      await call("save_document", metadata());
      const illustrated = {
        ...question,
        figures: [
          {
            id: "f1",
            caption: "图",
            region: { ...region, x: 0.75, width: 0.2 },
            contaminated: false,
          },
        ],
      };
      expect(await call("save_questions", { questions: [illustrated] })).toMatchObject({
        accepted: false,
      });
      await call("save_questions", {
        questions: [{ ...illustrated, regions: [{ ...region, width: 0.85 }] }],
      });
      expect(await call("revise_question", { order: 1, regions: [region] })).toMatchObject({
        accepted: false,
      });
      expect(await call("finish", { questionCount: 1, summary: "" })).toMatchObject({
        accepted: true,
      });
    });
    expect((await parseExam({ ...input, model, generateAnswers: false })).assets).toHaveLength(1);
  });
  it("keeps fixed template references out of the agent context and preserves unmatched student work", async () => {
    const first = await inputs();
    const template = await parseExam({
      ...first,
      generateAnswers: false,
      model: agentFixture(async (_request, call) => {
        await call("read_pages", { pages: [1] });
        await call("save_document", metadata());
        await call("save_questions", { questions: [question] });
        await call("finish", { questionCount: 1, summary: "" });
      }),
    });
    template.questions[0].solution = {
      answer: "SECRET_REFERENCE",
      selectedOptions: [],
      explanation: "",
      rubric: "",
      sufficient: true,
      issues: [],
      model: "fixture",
      origin: "teacher",
    };
    const input = await inputs();
    const model = agentFixture(async (request, call) => {
      expect(JSON.stringify(request.content)).not.toContain("SECRET_REFERENCE");
      await call("read_pages", { pages: [1] });
      await call("save_document", metadata(1, "answer_sheet"));
      expect(await call("save_questions", { questions: [question] })).toMatchObject({
        accepted: false,
      });
      await call("save_annotations", {
        annotations: [
          {
            id: "a1",
            questionNumber: null,
            section: "",
            partLabel: null,
            kind: "student_answer",
            markdown: "[unreadable]",
            regions: [region],
            figures: [],
          },
        ],
      });
      await call("finish", { questionCount: 1, summary: "" });
    });
    const exam = await parseExam({ ...input, model, template });
    expect(exam.questions[0].solution?.answer).toBe("SECRET_REFERENCE");
    expect(exam.answerDocument?.responses[0]).toMatchObject({
      questionNumber: null,
      unreadable: true,
    });
    expect(exam.answerDocument?.crops).toHaveLength(1);
  });
  it("rotates only when the agent asks and preserves image previews", async () => {
    const input = await inputs();
    const model = agentFixture(async (_request, call) => {
      const rotated = await call("rotate_page", { page: 1, degrees: "270" });
      expect(rotated).toMatchObject({ width: 300, height: 400, rotation: 270 });
      await call("save_document", metadata());
      await call("save_questions", { questions: [question] });
      await call("finish", { questionCount: 1, summary: "" });
    });
    const exam = await parseExam({ ...input, model, generateAnswers: false });
    expect(exam.pages[0].rotation).toBe(270);
    const preview = (await readActivity(input.outputDir)).find(
      (e) => e.type === "tool_result" && e.tool === "rotate_page",
    )!.data as { images: string[] };
    expect((await sharp(join(input.outputDir, preview.images[0])).metadata()).height).toBe(400);
  });
  it("fails closed without a validated submission and retains checkpoints without raw provider errors", async () => {
    const input = await inputs();
    const model = agentFixture(async (_request, call) => {
      await call("save_questions", { questions: [question] });
      throw new Error("PRIVATE_PROVIDER_EXCEPTION");
    });
    await expect(parseExam({ ...input, model, generateAnswers: false })).rejects.toThrow();
    expect(
      JSON.parse(await readFile(join(input.outputDir, "recognition.json"), "utf8")).questions,
    ).toHaveLength(1);
    const events = await readActivity(input.outputDir);
    expect(events.at(-1)?.type).toBe("failed");
    expect(JSON.stringify(events)).not.toContain("PRIVATE_PROVIDER_EXCEPTION");
    await expect(readFile(join(input.outputDir, "exam.json"))).rejects.toThrow();
  });
  it("resumes a saved draft only for the same source and lets the agent revise it", async () => {
    const input = await inputs();
    await expect(
      parseExam({
        ...input,
        generateAnswers: false,
        model: agentFixture(async (_request, call) => {
          await call("read_pages", { pages: [1] });
          await call("save_document", metadata());
          await call("save_questions", { questions: [question] });
          throw new Error("provider interrupted");
        }),
      }),
    ).rejects.toThrow();
    const draft = JSON.parse(await readFile(join(input.outputDir, "recognition.json"), "utf8"));
    const recognitionDraft = {
      sourceFiles: draft.sourceFiles,
      rotations: draft.pageRotations,
      result: draft,
    };
    const outputDir = `${input.outputDir}-resumed`;
    const resumed = await parseExam({
      files: input.files,
      outputDir,
      recognitionDraft,
      generateAnswers: false,
      model: agentFixture(async (_request, call) => {
        const saved = await call("read_saved", { orders: [1] });
        expect(saved.questions).toHaveLength(1);
        await call("read_pages", { pages: [1] });
        await call("save_questions", {
          questions: [{ ...question, markdown: "修正后的 $2+3=$ ____。" }],
        });
        await call("finish", { questionCount: 1, summary: "已修正" });
      }),
    });
    expect(resumed.questions[0].blocks).toEqual([{ type: "text", text: "修正后的 $2+3=$ ____。" }]);
    await expect(
      parseExam({
        files: input.files,
        outputDir: `${input.outputDir}-wrong`,
        model: agentFixture(async () => {}),
        recognitionDraft: {
          ...recognitionDraft,
          sourceFiles: draft.sourceFiles.map((s: Record<string, unknown>) => ({
            ...s,
            sha256: "0".repeat(64),
          })),
        },
      }),
    ).rejects.toThrow("different source document");
  });
});
