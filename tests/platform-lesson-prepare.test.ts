import { beforeEach, expect, it, vi } from "vitest";
import type { TeachingPlan, TeachingSession } from "@/contracts/teaching";
import type { ToolSet } from "ai";

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  session: vi.fn(),
  command: vi.fn(),
  question: vi.fn(),
  search: vi.fn(),
  asset: vi.fn(),
  accessible: vi.fn(),
  jobUpdate: vi.fn(),
  query: vi.fn(),
  sandboxOptions: undefined as unknown,
  dispose: vi.fn(),
}));
vi.mock("@/server/platform/access", () => ({
  getActor: mocks.actor,
  json: (value: unknown) => JSON.parse(JSON.stringify(value)),
}));
vi.mock("@/server/platform/teaching/service", () => ({
  loadTeachingSession: mocks.session,
  executeTeachingCommand: mocks.command,
}));
vi.mock("@/server/platform/question-bank", () => ({ queryQuestionBank: mocks.search }));
vi.mock("@/server/platform/assets", () => ({
  accessibleAsset: mocks.accessible,
  assetId: (url: string) => url.split("/").at(-1),
}));
vi.mock("@/server/platform/ai/sandbox-tools", () => ({
  createTaskSandbox: (options: unknown) => {
    mocks.sandboxOptions = options;
    return { tools: {}, dispose: mocks.dispose };
  },
}));
vi.mock("@/server/db/client", () => ({ getDb: () => db }));
const db = {
  question: { findFirst: mocks.question },
  platformAsset: { findUnique: mocks.asset },
  aiJob: { update: mocks.jobUpdate },
  $queryRaw: mocks.query,
  $transaction: async (work: (tx: object) => Promise<unknown>) => work(db),
};
import {
  createLessonPreparationFeatures,
  lessonPreparationContext,
} from "@/server/platform/ai/lesson-prepare";
import { aiRequestSchema } from "@/contracts/platform-ai";
import { AI_JOB_NAMES, aiJobResultLink } from "@/lib/ai-job-display";
import type { AiJobDTO } from "@/contracts/platform-ai";

const input = {
  sessionId: "session",
  publicationId: "published",
  expectedVersion: 2,
  expectedPlanVersion: 0,
  expectedBindingVersion: 1,
  requirements: "讲清等差数列，保留课堂讨论。",
};
const url = "/api/platform/assets/00000000-0000-4000-8000-000000000001";
function session() {
  return {
    id: "session",
    canPrepare: true,
    version: 2,
    planVersion: 0,
    bindingVersion: 1,
    scheduleChanged: false,
    plan: null,
    binding: {
      publicationId: "published",
      lessons: [{ startTime: "09:00", endTime: "09:40", courseName: "数学" }],
    },
    participants: [{ name: "不得注入模型的学生", attendanceReason: "出勤私密" }],
    summary: "另一个私有历史字段",
  } as unknown as TeachingSession;
}
function plan(): TeachingPlan {
  return {
    title: "数列的规律",
    objectives: "通过自主观察找规律",
    keyPoints: "公差",
    difficulties: "抽象表达",
    activities: [
      {
        id: "discuss",
        title: "讨论",
        minutes: 30,
        teacherActions: "引导比较",
        studentActions: "表达规律",
        assessment: "解释公差",
      },
    ],
    materials: [],
    boardPlan: "递推式",
    assessmentPlan: "退出条",
    notes: "留10分钟总结",
  };
}
function question() {
  return {
    id: "q",
    ownerId: "teacher",
    type: "SUBJECTIVE",
    subject: "数学",
    grade: "高中一年级",
    knowledgeTags: ["数列"],
    difficulty: 0.5,
    createdAt: new Date("2026-10-01"),
    updatedAt: new Date("2026-10-02"),
    content: {
      stem: "求$a_3$",
      options: [],
      answers: ["$3$"],
      explanation: "逐项求解",
      rubric: "方法正确",
      parts: [],
      images: [],
    },
  };
}
async function call(tools: ToolSet, name: string, value: unknown) {
  return tools[name].execute!(value, { toolCallId: name, messages: [], context: {} });
}
const create = () => createLessonPreparationFeatures({ userId: "teacher", input, jobId: "job" });
type SandboxOptions = {
  context: unknown;
  allowedAssets: Set<string>;
  readAsset: (url: string) => Promise<Buffer>;
  onImages: (images: { url: string }[], sources: string[]) => Promise<void>;
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.actor.mockResolvedValue({ id: "teacher", name: "任课教师", role: "TEACHER" });
  mocks.session.mockResolvedValue(session());
  mocks.command.mockResolvedValue({ id: "session", version: 3, planVersion: 1 });
  mocks.question.mockResolvedValue(question());
  mocks.search.mockResolvedValue({ questions: [], total: 0, page: 1 });
  mocks.asset.mockResolvedValue({ ownerId: "teacher", name: "导入材料" });
  mocks.accessible.mockResolvedValue({ buffer: Buffer.from("pixels") });
});

it.each([
  { version: 3 },
  { planVersion: 1 },
  { bindingVersion: 2 },
  { binding: { publicationId: "new-publication" } },
  { scheduleChanged: true },
])("refuses an outdated immutable baseline %j", async (changed) => {
  mocks.session.mockResolvedValue({ ...session(), ...changed });
  await expect(lessonPreparationContext("teacher", input)).rejects.toMatchObject({ status: 409 });
});
it("denies a reader who has no current preparation permission", async () => {
  mocks.session.mockResolvedValue({ ...session(), canPrepare: false });
  await expect(create()).rejects.toMatchObject({ status: 403 });
});
it("lets the agent search or read context in its chosen order without exporting roster or assessment data", async () => {
  const features = await create();
  expect(Object.keys(features.tools)).toEqual(
    expect.arrayContaining([
      "read_context",
      "search_questions",
      "read_question",
      "read_material",
      "propose_plan",
      "finish",
    ]),
  );
  await call(features.tools, "search_questions", { query: "数列", page: 1 });
  const context = await call(features.tools, "read_context", {});
  expect(JSON.stringify(context)).toContain("09:40");
  expect(JSON.stringify(context)).not.toMatch(/不得注入|出勤私密|历史字段/);
  expect(JSON.stringify((mocks.sandboxOptions as SandboxOptions).context)).not.toContain(
    "不得注入",
  );
  expect(mocks.search.mock.calls[0][1]).toMatchObject({ id: "teacher", role: "TEACHER" });
  await call(features.tools, "propose_plan", plan());
  await call(features.tools, "finish", { summary: "已生成待核对教案，尚未确认。" });
  await features.commit();
  expect(mocks.command).toHaveBeenCalledWith(
    { id: "teacher" },
    expect.objectContaining({
      type: "teaching.plan.save",
      expectedVersion: 2,
      expectedPlanVersion: 0,
      expectedBindingVersion: 1,
    }),
    { source: "AI", jobId: "job", db },
  );
  expect(mocks.jobUpdate).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        status: "COMPLETED",
        result: expect.objectContaining({
          result: { sessionId: "session", planVersion: 1, confirmed: false },
        }),
      }),
    }),
  );
});
it("requires full real question reads and freezes actual source content instead of generated claims", async () => {
  const features = await create();
  await call(features.tools, "read_context", {});
  const candidate = plan();
  candidate.materials = [
    {
      id: "example",
      title: "例题",
      kind: "QUESTION",
      questionId: "q",
      content: "模型编造的错误原题",
    },
  ];
  await expect(call(features.tools, "propose_plan", candidate)).rejects.toThrow("先读取");
  await call(features.tools, "read_question", { items: [{ questionId: "q" }] });
  expect(mocks.question).toHaveBeenCalledWith({ where: { id: "q", ownerId: "teacher" } });
  await call(features.tools, "propose_plan", candidate);
  await call(features.tools, "finish", { summary: "已生成" });
  await features.commit();
  const material = mocks.command.mock.calls[0][1].plan.materials[0];
  expect(material.content).toContain("求$a_3$");
  expect(material.content).toContain("2026-10-02");
  expect(material.content).not.toContain("模型编造");
});
it("requires actual visual evidence for question images and inline plan images", async () => {
  mocks.question.mockResolvedValue({
    ...question(),
    content: { ...question().content, images: [url] },
  });
  const features = await create();
  await call(features.tools, "read_context", {});
  await call(features.tools, "read_question", { items: [{ questionId: "q" }] });
  const candidate = plan();
  candidate.materials = [
    { id: "q", title: "例题", kind: "QUESTION", questionId: "q", content: "" },
  ];
  await expect(call(features.tools, "propose_plan", candidate)).rejects.toThrow("实际查看");
  const sandbox = mocks.sandboxOptions as SandboxOptions;
  expect(sandbox.allowedAssets.has(url)).toBe(true);
  await sandbox.onImages([], [url]);
  await call(features.tools, "propose_plan", candidate);
  const forged = plan();
  forged.notes = "![未知图](/api/platform/assets/00000000-0000-4000-8000-000000000099)";
  await expect(call(features.tools, "propose_plan", forged)).rejects.toThrow("图片引用");
});
it("accepts an explicitly read owned material only after viewing it and rechecks authority before fetching pixels", async () => {
  const features = await create();
  await call(features.tools, "read_context", {});
  await call(features.tools, "read_material", { url });
  const candidate = plan();
  candidate.materials = [{ id: "image", title: "材料", kind: "ASSET", url, content: "读图讨论" }];
  await expect(call(features.tools, "propose_plan", candidate)).rejects.toThrow("实际查看");
  const sandbox = mocks.sandboxOptions as SandboxOptions;
  await sandbox.onImages([], [url]);
  await call(features.tools, "propose_plan", candidate);
  mocks.session.mockResolvedValue({ ...session(), canPrepare: false });
  await expect(sandbox.readAsset(url)).rejects.toMatchObject({ status: 403 });
  expect(mocks.accessible).not.toHaveBeenCalled();
});
it("does not infer another teacher's image permission from the teaching assignment", async () => {
  mocks.asset.mockResolvedValue({ ownerId: "other", name: "别人的材料" });
  const features = await create();
  await expect(call(features.tools, "read_material", { url })).rejects.toThrow("无权引用");
  expect((mocks.sandboxOptions as SandboxOptions).allowedAssets.has(url)).toBe(false);
});
it("refuses a finish without a complete proposal and activities that exceed the real lesson", async () => {
  const features = await create();
  await expect(call(features.tools, "finish", { summary: "完成" })).rejects.toThrow("完整候选");
  await expect(call(features.tools, "propose_plan", plan())).rejects.toThrow("真实课次");
  await call(features.tools, "read_context", {});
  const candidate = plan();
  candidate.activities[0].minutes = 41;
  await expect(call(features.tools, "propose_plan", candidate)).rejects.toThrow("实际授课时长");
  await expect(call(features.tools, "finish", { summary: "完成" })).rejects.toThrow("完整候选");
});
it("rejects an old running job when a human changes the draft after generation", async () => {
  const features = await create();
  await call(features.tools, "read_context", {});
  await call(features.tools, "propose_plan", plan());
  await call(features.tools, "finish", { summary: "完成" });
  mocks.session.mockResolvedValue({ ...session(), version: 3, planVersion: 1 });
  await expect(features.commit()).rejects.toMatchObject({ status: 409 });
  expect(mocks.command).not.toHaveBeenCalled();
  expect(mocks.jobUpdate).not.toHaveBeenCalled();
});
it("rejects a cited question edit between proposal and commit without persisting a candidate", async () => {
  const features = await create();
  await call(features.tools, "read_context", {});
  await call(features.tools, "read_question", { items: [{ questionId: "q" }] });
  const candidate = plan();
  candidate.materials = [
    { id: "q", title: "例题", kind: "QUESTION", questionId: "q", content: "" },
  ];
  await call(features.tools, "propose_plan", candidate);
  await call(features.tools, "finish", { summary: "完成" });
  mocks.question.mockResolvedValue({ ...question(), updatedAt: new Date("2026-10-03") });
  await expect(features.commit()).rejects.toThrow("题目已更新");
  expect(mocks.command).not.toHaveBeenCalled();
});
it("reuses an explicitly read immutable plan source after the original question disappears, viewing every historical image", async () => {
  const original: TeachingPlan["materials"][number] = {
    id: "old-question",
    kind: "QUESTION",
    title: "原例题",
    questionId: "deleted-q",
    content: JSON.stringify({
      source: "QUESTION_SNAPSHOT",
      content: { stem: "原始题目", images: [url] },
    }),
  };
  const existing = session();
  existing.planVersion = 1;
  existing.plan = {
    id: "plan1",
    version: 1,
    source: "HUMAN",
    aiJobId: null,
    actorName: "原教师",
    createdAt: "",
    bindingVersion: 1,
    plan: { ...plan(), materials: [original] },
  };
  mocks.session.mockResolvedValue(existing);
  mocks.question.mockResolvedValue(null);
  const features = await createLessonPreparationFeatures({
    userId: "teacher",
    input: { ...input, expectedPlanVersion: 1 },
    jobId: "job",
  });
  await call(features.tools, "read_context", {});
  const candidate = {
    ...plan(),
    materials: [{ ...original, id: "new-name", title: "换一种讨论方式" }],
  };
  await expect(call(features.tools, "propose_plan", candidate)).rejects.toThrow("先读取");
  await call(features.tools, "read_plan_material", { materialId: "old-question" });
  await expect(call(features.tools, "propose_plan", candidate)).rejects.toThrow("全部图片");
  const sandbox = mocks.sandboxOptions as SandboxOptions;
  expect(sandbox.allowedAssets.has(url)).toBe(true);
  await sandbox.onImages([], [url]);
  await call(features.tools, "propose_plan", candidate);
  await call(features.tools, "finish", { summary: "沿用原例题，调整讨论活动。" });
  await features.commit();
  expect(mocks.question).not.toHaveBeenCalled();
  expect(mocks.command.mock.calls[0][1].plan.materials[0].content).toBe(original.content);
});
it("does not let a changed historical source impersonate an authorized frozen material", async () => {
  const original: TeachingPlan["materials"][number] = {
    id: "old",
    title: "原例题",
    kind: "QUESTION",
    questionId: "other-teacher-q",
    content: "已冻结的原题",
  };
  const existing = session();
  existing.planVersion = 1;
  existing.plan = {
    id: "plan1",
    version: 1,
    source: "HUMAN",
    aiJobId: null,
    actorName: "原教师",
    createdAt: "",
    bindingVersion: 1,
    plan: { ...plan(), materials: [original] },
  };
  mocks.session.mockResolvedValue(existing);
  const features = await createLessonPreparationFeatures({
    userId: "teacher",
    input: { ...input, expectedPlanVersion: 1 },
    jobId: "job",
  });
  await call(features.tools, "read_context", {});
  await call(features.tools, "read_plan_material", { materialId: "old" });
  await expect(
    call(features.tools, "propose_plan", {
      ...plan(),
      materials: [{ ...original, content: "伪造的新题" }],
    }),
  ).rejects.toThrow("先读取");
  await expect(
    call(features.tools, "read_plan_material", { materialId: "unrelated-plan-material" }),
  ).rejects.toThrow("没有这份材料");
});
it("exposes the exact versioned AI contract and a candidate-review result link", () => {
  expect(
    aiRequestSchema.safeParse({ kind: "LESSON_PREPARE", modelId: "model", input }).success,
  ).toBe(true);
  const { expectedPlanVersion: _missing, ...incomplete } = input;
  void _missing;
  expect(
    aiRequestSchema.safeParse({ kind: "LESSON_PREPARE", modelId: "model", input: incomplete })
      .success,
  ).toBe(false);
  expect(AI_JOB_NAMES.LESSON_PREPARE).toBe("生成候选教案");
  expect(
    aiJobResultLink({ kind: "LESSON_PREPARE", input, status: "COMPLETED" } as AiJobDTO),
  ).toEqual({ href: "/school/teaching/session", label: "核对候选教案" });
});
