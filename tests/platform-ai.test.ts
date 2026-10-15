import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockLanguageModelV4 } from "ai/test";
import { aiInputSchemas } from "@/contracts/platform-ai";
import { questionInputSchema } from "@/server/platform/schemas";
import type { BankQuestion, PlatformState } from "@/contracts/platform";
const mocked = vi.hoisted(() => ({
  loadState: vi.fn(),
  executeCommand: vi.fn(),
  transaction: vi.fn(),
  query: vi.fn(),
  jobFind: vi.fn(),
  jobUpdate: vi.fn(),
  questionFind: vi.fn(),
  submissionFind: vi.fn(),
  reviewCount: vi.fn(),
  accessibleAsset: vi.fn(),
  readOwnedAsset: vi.fn(),
  loadAiModel: vi.fn(),
  createSandboxSession: vi.fn(),
  sandboxRun: vi.fn(),
  sandboxDispose: vi.fn(),
  storagePaths: { temp: "", storage: "" },
}));
vi.mock("@/server/platform/service", () => ({
  loadState: mocked.loadState,
  executeCommand: mocked.executeCommand,
}));
vi.mock("@/server/db/client", () => ({
  getDb: () => ({ $transaction: mocked.transaction, question: { findMany: mocked.questionFind } }),
}));
vi.mock("@/server/platform/assets", () => ({
  accessibleAsset: mocked.accessibleAsset,
  readOwnedAsset: mocked.readOwnedAsset,
  assetId: (u: string) => u.split("/").at(-1),
}));
vi.mock("@/server/platform/ai/model", () => ({ loadAiModel: mocked.loadAiModel }));
vi.mock("@/server/ai/sandbox", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/ai/sandbox")>()),
  createSandboxSession: mocked.createSandboxSession,
}));
vi.mock("@/server/config/env", () => ({ getStoragePaths: () => mocked.storagePaths }));
import {
  createTaskFeatures as createFeatures,
  validateAssembly,
} from "@/server/platform/ai/features";
import { runAiTask, chatToolImages } from "@/server/platform/ai/runner";
const tasks: Awaited<ReturnType<typeof createFeatures>>[] = [];
const sandboxImages = new Map<string, Buffer>();
async function createTaskFeatures(options: Parameters<typeof createFeatures>[0]) {
  const features = await createFeatures(options);
  tasks.push(features);
  return features;
}
function imageCode(url: string, name: string, crop?: [number, number, number, number]) {
  return [
    "import json",
    "from PIL import Image",
    "with open('/inputs/context.json') as file: manifest = json.load(file)",
    `source = next(asset['path'] for asset in manifest['assets'] if asset['url'] == ${JSON.stringify(url)})`,
    "image = Image.open(source)",
    ...(crop ? [`image = image.crop((${crop.join(", ")}))`] : []),
    `image.save('/workspace/output/${name}')`,
  ].join("\n");
}
async function viewImage(features: Awaited<ReturnType<typeof createFeatures>>, url: string) {
  return call(features, "python", {
    code: imageCode(url, "source.png"),
    assets: [url],
    images: ["source.png"],
  });
}
const question: BankQuestion = {
  id: "q",
  ownerId: "teacher",
  type: "BLANK",
  subject: "数学",
  grade: "高一",
  difficulty: 0.5,
  knowledgeTags: ["代数"],
  content: {
    stem: "1+1=___",
    options: [],
    answers: ["2"],
    explanation: "加法",
    rubric: "答案2得满分",
    parts: [],
    images: [],
  },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
function state(): PlatformState {
  return {
    actor: { id: "teacher", name: "教师", role: "TEACHER" },
    questions: [question],
    papers: [
      {
        id: "paper",
        ownerId: "teacher",
        name: "测验",
        subject: "数学",
        grade: "高一",
        kind: "EXAM",
        instructions: "",
        layout: { paperSize: "A4", columns: 1 },
        items: [
          {
            id: "item",
            questionId: "q",
            position: 0,
            score: 10,
            section: "填空",
            snapshot: question,
          },
        ],
        createdAt: "",
        updatedAt: "",
      },
    ],
    classrooms: [
      {
        id: "class",
        ownerId: "teacher",
        name: "班级",
        grade: "高一",
        reviewerIds: [],
        students: [
          {
            id: "student",
            classroomId: "class",
            userId: "account",
            studentNumber: "000001",
            name: "学生",
          },
        ],
      },
    ],
    assessments: [
      {
        id: "exam",
        ownerId: "teacher",
        name: "测验",
        kind: "EXAM",
        classroomIds: ["class"],
        studentIds: ["student"],
        papers: [
          {
            paperId: "paper",
            subject: "数学",
            gradingMode: "DOUBLE",
            arbitrationThreshold: 2,
            conversion: { enabled: false, bands: [] },
          },
        ],
        published: false,
        createdAt: "",
      },
    ],
    templates: [],
    submissions: [
      {
        id: "submission",
        ownerId: "teacher",
        assessmentId: "exam",
        paperId: "paper",
        studentId: "student",
        templateId: null,
        kind: "WORKBOOK",
        status: "PENDING",
        sourceFiles: [],
        answers: [{ itemId: "item", text: "2", images: [] }],
        alignment: null,
        createdAt: "",
      },
    ],
    reviews: [],
    analytics: {
      results: [],
      knowledge: [],
      classrooms: [],
      students: [
        {
          studentId: "student",
          subjects: [],
          knowledge: [{ tag: "代数", earned: 0, maximum: 10, accuracy: 0, attempts: 1 }],
          wrongQuestions: [
            {
              assessmentId: "exam",
              paperId: "paper",
              itemId: "item",
              question,
              score: 0,
              maximum: 10,
              answer: { itemId: "item", text: "3", images: [] },
              feedback: "加法错误",
            },
          ],
          recommendations: [],
        },
      ],
    },
    users: [],
  };
}
async function call(
  features: Awaited<ReturnType<typeof createTaskFeatures>>,
  name: string,
  input: unknown,
) {
  const t = features.tools[name];
  if (!t?.execute) throw new Error(`Missing tool ${name}`);
  return t.execute(input, { toolCallId: "call", messages: [], context: undefined });
}
beforeEach(async () => {
  vi.clearAllMocks();
  mocked.storagePaths.temp = await mkdtemp(join(tmpdir(), "omp-ai-unit-"));
  mocked.storagePaths.storage = mocked.storagePaths.temp;
  sandboxImages.clear();
  mocked.createSandboxSession.mockImplementation(({ directory }: { directory: string }) => ({
    run: (request: { code?: string; command?: string; images: string[] }) =>
      mocked.sandboxRun(directory, request),
    dispose: mocked.sandboxDispose,
  }));
  mocked.sandboxRun.mockImplementation(
    async (directory: string, request: { code?: string; command?: string; images: string[] }) => {
      const manifest = JSON.parse(
        await readFile(join(directory, "inputs", "context.json"), "utf8"),
      ) as {
        task: unknown;
        assets: { url: string; path: string }[];
      };
      expect(manifest.task).toBeDefined();
      const source =
        manifest.assets.find((asset) => request.code?.includes(JSON.stringify(asset.url))) ??
        manifest.assets[0];
      return {
        exitCode: 0,
        stdout: "",
        stderr: "",
        images: await Promise.all(
          request.images.map(async (name) => ({
            name,
            data: (
              sandboxImages.get(name) ?? (await readFile(join(directory, source.path)))
            ).toString("base64"),
          })),
        ),
      };
    },
  );
  mocked.loadState.mockResolvedValue(state());
  mocked.executeCommand.mockResolvedValue({ id: "saved" });
  const tx = {
    $queryRaw: mocked.query,
    aiJob: { findUnique: mocked.jobFind, update: mocked.jobUpdate },
    question: { findUnique: mocked.questionFind, findMany: mocked.questionFind },
    scanSubmission: { findUnique: mocked.submissionFind },
    review: { count: mocked.reviewCount },
  };
  mocked.transaction.mockImplementation(async (action: (db: typeof tx) => Promise<unknown>) =>
    action(tx),
  );
  mocked.jobFind.mockResolvedValue({
    id: "job",
    userId: "teacher",
    kind: "ASSEMBLE",
    status: "RUNNING",
  });
  mocked.questionFind.mockResolvedValue({ ...question, updatedAt: new Date(question.updatedAt) });
  mocked.submissionFind.mockResolvedValue(state().submissions[0]);
  mocked.reviewCount.mockResolvedValue(0);
  mocked.jobUpdate.mockResolvedValue({});
});
afterEach(async () => {
  try {
    await Promise.all(tasks.splice(0).map((features) => features.dispose()));
  } finally {
    await rm(mocked.storagePaths.temp, { recursive: true, force: true });
  }
});
const assemble = () =>
  aiInputSchemas.ASSEMBLE.parse({
    name: "AI卷",
    subject: "数学",
    grade: "高一",
    difficulty: 0.5,
    counts: [{ type: "BLANK", count: 1, score: 10 }],
    knowledgeDistribution: [{ tag: "代数", percent: 100 }],
  });
describe("AI autonomous tools and constraints", () => {
  it("imports complete image evidence directly into an editable homework without manual assembly", async () => {
    const sharp = (await import("sharp")).default;
    const buffer = await sharp({
      create: { width: 120, height: 160, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();
    mocked.readOwnedAsset.mockResolvedValue({ buffer });
    mocked.accessibleAsset.mockResolvedValue({ buffer });
    mocked.jobFind.mockResolvedValue({
      id: "job",
      userId: "teacher",
      kind: "IMPORT",
      status: "RUNNING",
    });
    const f = await createTaskFeatures({
      userId: "teacher",
      kind: "IMPORT",
      input: {
        assetUrls: ["/api/platform/assets/source"],
        kind: "HOMEWORK",
        name: "图片作业",
        subject: "数学",
        grade: "高一",
      },
      jobId: "job",
    });
    await expect(call(f, "finish", { summary: "完成" })).rejects.toThrow(/全部导入/);
    const fullPage = (await viewImage(f, "/api/platform/assets/source")) as {
      images: { image: string; url?: string }[];
      previews: { url: string; image: string }[];
    };
    expect(fullPage.images[0]).not.toHaveProperty("url");
    expect(fullPage.previews).toEqual([
      expect.objectContaining({ url: "/api/platform/assets/source", image: expect.any(String) }),
    ]);
    const draft = questionInputSchema.parse({ ...question, id: undefined });
    await call(f, "propose_question", { sourceKey: "p1-q1", score: 7, question: draft });
    await call(f, "record_source_inventory", {
      sources: [{ url: "/api/platform/assets/source", totalQuestions: 2 }],
    });
    await expect(call(f, "finish", { summary: "完成" })).rejects.toThrow(/完整覆盖/);
    await call(f, "propose_question", {
      sourceKey: "p1-q2",
      score: 3,
      question: { ...draft, content: { ...draft.content, stem: "2+2=___", answers: ["4"] } },
    });
    await call(f, "finish", { summary: "已识别两题" });
    const output = await f.commit();
    expect(mocked.executeCommand).toHaveBeenCalledTimes(1);
    expect(mocked.executeCommand.mock.calls[0][1]).toMatchObject({
      type: "paper.save",
      paper: {
        kind: "HOMEWORK",
        name: "图片作业",
        layout: { paperSize: "A4", columns: 1 },
        items: [
          { score: 7, question: { content: { answers: ["2"] } } },
          { score: 3, question: { content: { answers: ["4"] } } },
        ],
      },
    });
    expect(output.result).toMatchObject({ paperId: "saved", paperKind: "HOMEWORK" });
  });
  it("preserves an established one-answer-per-blank count during enrichment", async () => {
    const s = state();
    s.questions[0] = { ...question, content: { ...question.content, answers: ["2", "4"] } };
    mocked.loadState.mockResolvedValue(s);
    const f = await createTaskFeatures({
      userId: "teacher",
      kind: "ENRICH",
      input: { questionIds: ["q"] },
      jobId: "job",
    });
    await call(f, "read_question", { questionId: "q" });
    await expect(
      call(f, "propose_enrichment", {
        questionId: "q",
        knowledgeTags: ["代数"],
        answers: ["2、4"],
        explanation: "两空",
        rubric: "每空给分",
        parts: [],
      }),
    ).rejects.toThrow(/答案数量/);
    await call(f, "propose_enrichment", {
      questionId: "q",
      knowledgeTags: ["代数"],
      answers: ["2", "4"],
      explanation: "两空分别对应答案",
      rubric: "每空给分",
      parts: [],
    });
  });
  it("revalidates recommendation permissions at commit after a teacher's shared class access is revoked", async () => {
    const s = state();
    s.questions.push({ ...question, id: "candidate" });
    mocked.loadState.mockResolvedValue(s);
    mocked.jobFind.mockResolvedValue({
      id: "job",
      userId: "teacher",
      kind: "RECOMMEND",
      status: "RUNNING",
    });
    const f = await createTaskFeatures({
      userId: "teacher",
      kind: "RECOMMEND",
      input: { studentId: "student", count: 1 },
      jobId: "job",
    });
    await call(f, "read_learning", { offset: 0, limit: 10 });
    await call(f, "read_candidate", { questionId: "candidate" });
    await call(f, "propose_recommendations", {
      recommendations: [{ questionId: "candidate", reason: "练习代数" }],
    });
    await call(f, "finish", { summary: "候选完成" });
    mocked.loadState.mockResolvedValue({
      ...state(),
      classrooms: [],
      submissions: [],
      analytics: { results: [], students: [], classrooms: [], knowledge: [] },
    });
    await expect(f.commit()).rejects.toThrow(/权限已改变/);
    expect(mocked.jobUpdate).not.toHaveBeenCalled();
  });

  it("stages sandbox-produced illustration pixels and rejects full-page source references", async () => {
    const sharp = (await import("sharp")).default;
    const buffer = await sharp({
      create: { width: 200, height: 300, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();
    mocked.accessibleAsset.mockResolvedValue({ buffer });
    mocked.readOwnedAsset.mockResolvedValue({ buffer });
    const f = await createTaskFeatures({
      userId: "teacher",
      kind: "IMPORT",
      input: { assetUrls: ["/api/platform/assets/source"] },
      jobId: "job",
    });
    await viewImage(f, "/api/platform/assets/source");
    await expect(
      call(f, "propose_question", {
        sourceKey: "q1",
        question: {
          ...question,
          content: { ...question.content, images: ["/api/platform/assets/source"] },
        },
      }),
    ).rejects.toThrow(/裁切/);
    sandboxImages.set(
      "diagram.png",
      await sharp(buffer).extract({ left: 20, top: 60, width: 60, height: 60 }).png().toBuffer(),
    );
    const output = (await call(f, "python", {
      code: imageCode("/api/platform/assets/source", "diagram.png", [20, 60, 80, 120]),
      assets: ["/api/platform/assets/source"],
      images: ["diagram.png"],
    })) as { images: { url: string; image: string }[] };
    const crop = output.images[0];
    expect(crop.url).toMatch(/^\/api\/platform\/assets\//);
    const meta = await sharp(Buffer.from(crop.image, "base64")).metadata();
    expect(meta.width).toBe(60);
    expect(meta.height).toBe(60);
    await viewImage(f, crop.url);
    const directory = mocked.createSandboxSession.mock.calls[0][0].directory;
    const manifest = JSON.parse(await readFile(join(directory, "inputs", "context.json"), "utf8"));
    expect(manifest.assets).toContainEqual(expect.objectContaining({ url: crop.url }));
    await call(f, "propose_question", {
      sourceKey: "q1",
      question: { ...question, content: { ...question.content, images: [crop.url] } },
    });
    expect(mocked.executeCommand).not.toHaveBeenCalled();
  });
  it("does not treat a previously mounted failed source as viewed when another source succeeds", async () => {
    const sharp = (await import("sharp")).default;
    const buffer = await sharp({
      create: { width: 60, height: 90, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();
    const source1 = "/api/platform/assets/source1",
      source2 = "/api/platform/assets/source2";
    mocked.readOwnedAsset.mockResolvedValue({ buffer });
    mocked.accessibleAsset.mockResolvedValue({ buffer });
    const features = await createTaskFeatures({
      userId: "teacher",
      kind: "IMPORT",
      input: { assetUrls: [source1, source2] },
      jobId: "job",
    });
    mocked.sandboxRun.mockResolvedValueOnce({
      exitCode: 1,
      stdout: "",
      stderr: "cannot process this page",
      images: [],
    });
    await call(features, "python", { code: "print('first page')", assets: [source1], images: [] });
    const output = (await call(features, "python", {
      code: "print('second page')",
      assets: [source2],
      images: [],
    })) as { previews: { url: string }[] };
    expect(output.previews.map((preview) => preview.url)).toEqual([source2]);
    await expect(
      call(features, "propose_question", { sourceKey: "p1:q1", sourceUrl: source1, question }),
    ).rejects.toThrow(/已查看/);
    await call(features, "propose_question", { sourceKey: "p2:q1", sourceUrl: source2, question });
    await expect(
      call(features, "record_source_inventory", {
        sources: [
          { url: source1, totalQuestions: 0 },
          { url: source2, totalQuestions: 1 },
        ],
      }),
    ).rejects.toThrow(/先查看每页/);
    await call(features, "python", {
      code: "print('retry first page')",
      assets: [source1],
      images: [],
    });
    await call(features, "record_source_inventory", {
      sources: [
        { url: source1, totalQuestions: 0 },
        { url: source2, totalQuestions: 1 },
      ],
    });
  });
  it("requires meaningful answers, explanations and scoring rubrics when enriching", async () => {
    const f = await createTaskFeatures({
      userId: "teacher",
      kind: "ENRICH",
      input: { questionIds: ["q"] },
      jobId: "job",
    });
    await call(f, "read_question", { questionId: "q" });
    await expect(
      call(f, "propose_enrichment", {
        questionId: "q",
        knowledgeTags: [],
        answers: [],
        explanation: "",
        rubric: "",
        parts: [],
      }),
    ).rejects.toThrow(/知识点/);
    await expect(
      call(f, "propose_enrichment", {
        questionId: "q",
        knowledgeTags: ["代数"],
        answers: [],
        explanation: "解析",
        rubric: "",
        parts: [],
      }),
    ).rejects.toThrow(/标准答案/);
  });
  it("mixed grading requires every subpart score, correct weighted maxima and matching total", async () => {
    const s = state();
    s.papers[0].items[0].snapshot = {
      ...question,
      type: "MIXED",
      content: {
        ...question.content,
        parts: [
          {
            id: "1",
            type: "BLANK",
            stem: "填空",
            options: [],
            answers: ["2"],
            explanation: "",
            rubric: "",
            knowledgeTags: ["代数"],
            score: 4,
          },
          {
            id: "2",
            type: "SUBJECTIVE",
            stem: "证明",
            options: [],
            answers: ["证明"],
            explanation: "",
            rubric: "步骤给分",
            knowledgeTags: ["几何"],
            score: 6,
          },
        ],
      },
    };
    mocked.loadState.mockResolvedValue(s);
    const f = await createTaskFeatures({
      userId: "teacher",
      kind: "GRADE",
      input: { submissionId: "submission" },
      jobId: "job",
    });
    await call(f, "read_answer", { itemId: "item" });
    await expect(
      call(f, "propose_grade", { itemId: "item", score: 8, feedback: "部分正确" }),
    ).rejects.toThrow(/逐小问/);
    await expect(
      call(f, "propose_grade", {
        itemId: "item",
        score: 8,
        feedback: "部分正确",
        parts: [
          { partId: "1", score: 5, feedback: "正确" },
          { partId: "2", score: 3, feedback: "部分" },
        ],
      }),
    ).rejects.toThrow(/权重/);
    await call(f, "propose_grade", {
      itemId: "item",
      score: 8,
      feedback: "部分正确",
      parts: [
        { partId: "1", score: 4, feedback: "正确" },
        { partId: "2", score: 4, feedback: "证明缺少一步" },
      ],
    });
    await call(f, "finish", { summary: "混合题完成" });
  });
  it("recommendations include unused paper questions and mixed-part tags but reject a different subject's shared tag", async () => {
    const s = state();
    s.analytics.students[0].wrongQuestions[0].question = {
      ...question,
      type: "MIXED",
      knowledgeTags: [],
      content: {
        ...question.content,
        parts: [
          {
            id: "1",
            type: "BLANK",
            stem: "",
            options: [],
            answers: ["2"],
            explanation: "",
            rubric: "",
            knowledgeTags: ["函数"],
            score: 10,
          },
        ],
      },
    };
    s.questions.push(
      { ...question, id: "candidate", knowledgeTags: ["函数"] },
      { ...question, id: "wrong-subject", subject: "物理", knowledgeTags: ["函数"] },
    );
    s.papers.push({
      ...s.papers[0],
      id: "unused",
      items: [{ ...s.papers[0].items[0], id: "unused-item", questionId: "candidate" }],
    });
    mocked.loadState.mockResolvedValue(s);
    const f = await createTaskFeatures({
      userId: "teacher",
      kind: "RECOMMEND",
      input: { studentId: "student", count: 1 },
      jobId: "job",
    });
    expect(await call(f, "search_candidates", { offset: 0, limit: 50 })).toEqual([
      expect.objectContaining({ id: "candidate" }),
    ]);
    await expect(call(f, "read_candidate", { questionId: "wrong-subject" })).rejects.toThrow(
      /候选/,
    );
  });

  it("imports multiple independently identified questions only after seeing every source image", async () => {
    const sharp = (await import("sharp")).default;
    const buffer = await sharp({
      create: { width: 200, height: 300, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();
    mocked.accessibleAsset.mockResolvedValue({ buffer });
    mocked.readOwnedAsset.mockResolvedValue({ buffer });
    mocked.jobFind.mockResolvedValue({
      id: "job",
      userId: "teacher",
      kind: "IMPORT",
      status: "RUNNING",
    });
    const f = await createTaskFeatures({
      userId: "teacher",
      kind: "IMPORT",
      input: { assetUrls: ["/api/platform/assets/source"], subject: "数学", grade: "高一" },
      jobId: "job",
    });
    expect(f.tools).not.toHaveProperty("propose_paper");
    await expect(call(f, "propose_question", { sourceKey: "page1:q1", question })).rejects.toThrow(
      /查看/,
    );
    await viewImage(f, "/api/platform/assets/source");
    await call(f, "propose_question", { sourceKey: "page1:q1", question });
    await call(f, "propose_question", {
      sourceKey: "page1:q2",
      question: { ...question, content: { ...question.content, stem: "2+2=___", answers: ["4"] } },
    });
    await expect(call(f, "finish", { summary: "过早完成" })).rejects.toThrow(/题数/);
    await call(f, "record_source_inventory", {
      sources: [{ url: "/api/platform/assets/source", totalQuestions: 2 }],
    });
    await call(f, "finish", { summary: "识别导入2题" });
    await f.commit();
    expect(mocked.executeCommand).toHaveBeenCalledTimes(2);
  });
  it("autonomously reads the paper, generates and saves a validated editable answer-card draft", async () => {
    mocked.jobFind.mockResolvedValue({
      id: "job",
      userId: "teacher",
      kind: "TEMPLATE",
      status: "RUNNING",
    });
    const f = await createTaskFeatures({
      userId: "teacher",
      kind: "TEMPLATE",
      input: { paperId: "paper" },
      jobId: "job",
    });
    await expect(call(f, "generate_layout", {})).rejects.toThrow(/读取试卷/);
    await call(f, "read_paper", {});
    const template = await call(f, "generate_layout", {});
    await call(f, "propose_template", { layout: (template as { layout: unknown }).layout });
    await call(f, "finish", { summary: "卡片完成" });
    await f.commit();
    expect(mocked.executeCommand.mock.calls[0][1]).toMatchObject({
      type: "template.save",
      template: { paperId: "paper", layout: { pageCount: 1 } },
    });
  });
  it("turns tool images into actual chat user image messages without repeating base64 text", () => {
    const messages = chatToolImages([
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call",
            toolName: "python",
            output: {
              type: "content",
              value: [
                { type: "text", text: "source" },
                { type: "file", mediaType: "image/png", data: { type: "data", data: "BASE64" } },
              ],
            },
          },
        ],
      },
    ]);
    expect(messages).toHaveLength(2);
    expect(JSON.stringify(messages[0])).not.toContain("BASE64");
    expect(messages[1]).toMatchObject({
      role: "user",
      content: [
        { type: "text" },
        { type: "file", mediaType: "image/png", data: { data: "BASE64" } },
      ],
    });
    expect(chatToolImages(messages)).toEqual(messages);
  });

  it("validates real selection counts, difficulty and apportioned overlapping knowledge tags", () => {
    expect(validateAssembly(assemble(), [question])).toMatchObject({
      total: 1,
      averageDifficulty: 0.5,
      knowledgeCounts: [{ tag: "代数", count: 1 }],
    });
    expect(() => validateAssembly(assemble(), [])).toThrow(/题数不足/);
    expect(() => validateAssembly(assemble(), [{ ...question, difficulty: 1 }])).toThrow(/难度/);
    expect(() => validateAssembly(assemble(), [{ ...question, knowledgeTags: ["几何"] }])).toThrow(
      /占比/,
    );
    const input = aiInputSchemas.ASSEMBLE.parse({
      ...assemble(),
      counts: [{ type: "BLANK", count: 2, score: 10 }],
      knowledgeDistribution: [
        { tag: "代数", percent: 50 },
        { tag: "几何", percent: 50 },
      ],
    });
    expect(
      validateAssembly(input, [
        { ...question, id: "a", knowledgeTags: ["代数", "几何"] },
        { ...question, id: "b", knowledgeTags: ["代数"] },
      ]).total,
    ).toBe(2);
  });
  it("rejects premature finish and unread selections then atomically commits a valid paper and completion", async () => {
    const f = await createTaskFeatures({
      userId: "teacher",
      kind: "ASSEMBLE",
      input: assemble(),
      jobId: "job",
    });
    expect(f.tools).not.toHaveProperty("propose_grade");
    await expect(call(f, "finish", { summary: "done" })).rejects.toThrow(/有效候选/);
    await expect(call(f, "propose_paper", { questionIds: ["q"] })).rejects.toThrow(/读取/);
    await call(f, "read_question", { questionId: "q" });
    await call(f, "propose_paper", { questionIds: ["q"] });
    await call(f, "finish", { summary: "已组卷" });
    expect(mocked.executeCommand).not.toHaveBeenCalled();
    expect(await f.commit()).toMatchObject({ summary: "已组卷", result: { ids: ["saved"] } });
    expect(mocked.executeCommand).toHaveBeenCalledWith(
      { id: "teacher" },
      expect.objectContaining({ type: "paper.save" }),
      expect.objectContaining({ source: "AI", jobId: "job" }),
    );
    expect(mocked.jobUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "COMPLETED" }) }),
    );
  });
  it("limits enrichment scope, preserves stems and requires all requested questions", async () => {
    mocked.jobFind.mockResolvedValue({
      id: "job",
      userId: "teacher",
      kind: "ENRICH",
      status: "RUNNING",
    });
    const f = await createTaskFeatures({
      userId: "teacher",
      kind: "ENRICH",
      input: { questionIds: ["q"] },
      jobId: "job",
    });
    await call(f, "read_question", { questionId: "q" });
    await call(f, "propose_enrichment", {
      questionId: "q",
      knowledgeTags: ["整数加法"],
      answers: ["2"],
      explanation: "1+1=2",
      rubric: "答案正确10分",
      parts: [],
    });
    await call(f, "finish", { summary: "已补答案" });
    await f.commit();
    expect(mocked.executeCommand.mock.calls[0][1].question.content.stem).toBe(
      question.content.stem,
    );
    expect(mocked.executeCommand.mock.calls[0][1].question.knowledgeTags).toEqual(["整数加法"]);
  });
  it("requires full grading evidence and rejects over-scoring; AI commits only first reviews", async () => {
    mocked.jobFind.mockResolvedValue({
      id: "job",
      userId: "teacher",
      kind: "GRADE",
      status: "RUNNING",
    });
    const s = state();
    s.submissions[0].answers[0].images = ["/api/platform/assets/image"];
    mocked.loadState.mockResolvedValue(s);
    const f = await createTaskFeatures({
      userId: "teacher",
      kind: "GRADE",
      input: { submissionId: "submission" },
      jobId: "job",
    });
    expect(f.tools).not.toHaveProperty("propose_question");
    await call(f, "read_answer", { itemId: "item" });
    await expect(
      call(f, "propose_grade", { itemId: "item", score: 11, feedback: "wrong" }),
    ).rejects.toThrow(/满分/);
    await expect(
      call(f, "propose_grade", { itemId: "item", score: 10, feedback: "correct" }),
    ).rejects.toThrow(/截图/);
    s.submissions[0].answers[0].images = [];
    mocked.loadState.mockResolvedValue(s);
    const next = await createTaskFeatures({
      userId: "teacher",
      kind: "GRADE",
      input: { submissionId: "submission" },
      jobId: "job",
    });
    await call(next, "read_answer", { itemId: "item" });
    await call(next, "propose_grade", { itemId: "item", score: 10, feedback: "依据标准答案正确" });
    await call(next, "finish", { summary: "首评完成" });
    await next.commit();
    expect(mocked.executeCommand.mock.calls[0][1].review.round).toBe("FIRST");
  });
  it("requires the question diagram as grading evidence and allows mounting the original answer page", async () => {
    const sharp = (await import("sharp")).default;
    const buffer = await sharp({
      create: { width: 100, height: 140, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();
    const diagram = "/api/platform/assets/question-diagram";
    const handwriting = "/api/platform/assets/handwriting";
    const page = "/api/platform/assets/answer-page";
    const gradingState = state();
    gradingState.papers[0].items[0].snapshot = {
      ...question,
      content: { ...question.content, images: [diagram] },
    };
    gradingState.submissions[0].answers[0].images = [handwriting];
    gradingState.submissions[0].sourceFiles = [page];
    mocked.loadState.mockResolvedValue(gradingState);
    mocked.accessibleAsset.mockResolvedValue({ buffer });
    const features = await createTaskFeatures({
      userId: "teacher",
      kind: "GRADE",
      input: { submissionId: "submission" },
      jobId: "job",
    });
    await call(features, "read_answer", { itemId: "item" });
    await viewImage(features, handwriting);
    const original = (await call(features, "python", {
      code: "print('inspect original answer page')",
      assets: [page],
      images: [],
    })) as { previews: { url: string }[] };
    expect(original.previews.map((preview) => preview.url)).toEqual([page]);
    await expect(
      call(features, "propose_grade", { itemId: "item", score: 8, feedback: "作答已查看" }),
    ).rejects.toThrow(/先查看全部/);
    await viewImage(features, diagram);
    await call(features, "propose_grade", {
      itemId: "item",
      score: 8,
      feedback: "结合题干图像和作答给分",
    });
    await call(features, "finish", { summary: "图像证据完整" });
    expect(mocked.accessibleAsset).toHaveBeenCalledWith("teacher", "answer-page");
    expect(mocked.executeCommand).not.toHaveBeenCalled();
  });
  it("refuses student mutations and another student's recommendations", async () => {
    const s = state();
    s.actor = { id: "account", name: "学生", role: "STUDENT" };
    mocked.loadState.mockResolvedValue(s);
    await expect(
      createTaskFeatures({ userId: "account", kind: "ENRICH", input: { questionIds: ["q"] } }),
    ).rejects.toThrow(/学生只可/);
    await expect(
      createTaskFeatures({
        userId: "account",
        kind: "RECOMMEND",
        input: { studentId: "someone", count: 1 },
      }),
    ).rejects.toThrow(/本人/);
  });
  it("lets a student inspect a newly discovered matching candidate image before any recommendation is saved", async () => {
    const sharp = (await import("sharp")).default;
    const buffer = await sharp({
      create: { width: 80, height: 60, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();
    const candidateUrl = "/api/platform/assets/candidate-image";
    const candidate = {
      ...question,
      id: "candidate",
      content: { ...question.content, images: [candidateUrl] },
    };
    const studentState = state();
    studentState.actor = { id: "account", name: "学生", role: "STUDENT" };
    studentState.questions = [];
    mocked.loadState.mockResolvedValue(studentState);
    mocked.questionFind.mockResolvedValue([
      {
        ...candidate,
        createdAt: new Date(candidate.createdAt),
        updatedAt: new Date(candidate.updatedAt),
      },
    ]);
    mocked.accessibleAsset.mockImplementation(async (userId: string, id: string) => {
      if (userId !== "teacher" || id !== "candidate-image")
        throw new Error("Student cannot ordinarily read this asset");
      return { buffer };
    });
    const features = await createTaskFeatures({
      userId: "account",
      kind: "RECOMMEND",
      input: { studentId: "student", count: 1 },
      jobId: "job",
    });
    expect(studentState.analytics.students[0].recommendations).toEqual([]);
    expect(features.getResult().result).toBeNull();
    const output = (await viewImage(features, candidateUrl)) as {
      exitCode: number;
      previews: { url: string; image: string }[];
    };
    expect(output.exitCode).toBe(0);
    expect(output.previews).toEqual([
      expect.objectContaining({ url: candidateUrl, image: expect.any(String) }),
    ]);
    expect(mocked.accessibleAsset).toHaveBeenCalledWith("teacher", "candidate-image");
    expect(mocked.questionFind).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { id: "candidate", ownerId: "teacher" } }),
    );
    await expect(
      call(features, "python", {
        code: "print('foreign')",
        assets: ["/api/platform/assets/foreign"],
        images: [],
      }),
    ).rejects.toThrow(/不属于/);
    expect(features.getResult().result).toBeNull();
    expect(mocked.executeCommand).not.toHaveBeenCalled();
  });
  it("recommends only real unused matching questions with reasons, never a repeated or invented ID", async () => {
    const s = state();
    s.questions.push({
      ...question,
      id: "candidate",
      content: { ...question.content, stem: "2+2=___" },
    });
    mocked.loadState.mockResolvedValue(s);
    mocked.jobFind.mockResolvedValue({
      id: "job",
      userId: "teacher",
      kind: "RECOMMEND",
      status: "RUNNING",
    });
    const f = await createTaskFeatures({
      userId: "teacher",
      kind: "RECOMMEND",
      input: { studentId: "student", count: 1 },
      jobId: "job",
    });
    await call(f, "read_learning", {});
    await expect(
      call(f, "propose_recommendations", {
        recommendations: [{ questionId: "q", reason: "same" }],
      }),
    ).rejects.toThrow(/真实候选/);
    await call(f, "read_candidate", { questionId: "candidate" });
    await call(f, "propose_recommendations", {
      recommendations: [{ questionId: "candidate", reason: "练习代数加法" }],
    });
    await call(f, "finish", { summary: "推荐已准备" });
    mocked.questionFind.mockResolvedValue([
      {
        ...s.questions.find((q) => q.id === "candidate")!,
        createdAt: new Date(question.createdAt),
        updatedAt: new Date(question.updatedAt),
      },
    ]);
    const output = await f.commit();
    expect(output.result).toMatchObject({
      studentId: "student",
      recommendations: [{ questionId: "candidate", reason: "练习代数加法" }],
    });
    expect(mocked.executeCommand).not.toHaveBeenCalled();
  });
  it("keeps failed or stale tasks from committing any draft", async () => {
    const f = await createTaskFeatures({
      userId: "teacher",
      kind: "ASSEMBLE",
      input: assemble(),
      jobId: "job",
    });
    await call(f, "report_failure", { reason: "题库只有一题，无法满足条件" });
    await expect(f.commit()).rejects.toThrow(/题库只有/);
    expect(mocked.executeCommand).not.toHaveBeenCalled();
    const next = await createTaskFeatures({
      userId: "teacher",
      kind: "ASSEMBLE",
      input: assemble(),
      jobId: "job",
    });
    await call(next, "read_question", { questionId: "q" });
    await call(next, "propose_paper", { questionIds: ["q"] });
    await call(next, "finish", { summary: "done" });
    mocked.jobFind.mockResolvedValue({
      id: "job",
      userId: "teacher",
      kind: "ASSEMBLE",
      status: "FAILED",
    });
    await expect(next.commit()).rejects.toThrow(/状态已改变/);
    expect(mocked.executeCommand).not.toHaveBeenCalled();
  });
});
describe("SDK 7 autonomous agent loop", () => {
  it("uses tool calls to read, propose and finish across separate model steps before committing", async () => {
    const sequence = [
      { name: "python", args: { code: "print(1 + 1)", assets: [], images: [] } },
      { name: "read_question", args: { questionId: "q" } },
      { name: "propose_paper", args: { questionIds: ["q"] } },
      { name: "finish", args: { summary: "自主组卷完成" } },
    ];
    let index = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        const step = sequence[index++];
        return {
          content: [
            {
              type: "tool-call",
              toolCallId: `call-${index}`,
              toolName: step.name,
              input: JSON.stringify(step.args),
            },
          ],
          finishReason: { unified: "tool-calls", raw: undefined },
          usage: {
            inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 20, text: 20, reasoning: undefined },
          },
          warnings: [],
        };
      },
    });
    mocked.loadAiModel.mockResolvedValue({
      model,
      identity: {
        providerId: "provider",
        providerName: "fixture",
        modelId: "model",
        model: "fixture",
        apiType: "openai_chat",
      },
      maxOutputTokens: 16000,
      timeoutMs: 30000,
      maxConcurrency: 3,
    });
    const events: unknown[] = [];
    const result = await runAiTask({
      userId: "teacher",
      kind: "ASSEMBLE",
      input: assemble(),
      modelId: "model",
      jobId: "job",
      onEvent: async (e) => {
        events.push(e);
      },
    });
    expect(result.summary).toBe("自主组卷完成");
    expect(model.doGenerateCalls).toHaveLength(4);
    expect(events.filter((e) => (e as { type: string }).type === "step")).toHaveLength(4);
    expect(events).toContainEqual(
      expect.objectContaining({ type: "tool", name: "python", status: "ended" }),
    );
    expect(mocked.sandboxRun).toHaveBeenCalledOnce();
    expect(mocked.sandboxDispose).toHaveBeenCalledOnce();
    expect(JSON.stringify(events)).not.toContain("apiKey");
    expect(mocked.executeCommand).toHaveBeenCalledTimes(1);
  });
});
