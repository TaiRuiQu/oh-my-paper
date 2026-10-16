import { beforeEach, expect, it, vi } from "vitest";
import type { PracticeAiContext } from "@/contracts/practice";
import { MockLanguageModelV4 } from "ai/test";
import { RequestError } from "@/server/http/errors";

const mock = vi.hoisted(() => ({
  context: vi.fn(),
  asset: vi.fn(),
  commit: vi.fn(),
  sandbox: vi.fn(),
  model: vi.fn(),
}));
vi.mock("@/server/platform/practice/service", () => ({
  loadPracticeAiContext: mock.context,
  readPracticeAiAsset: mock.asset,
  commitPracticeAiFeedback: mock.commit,
}));
vi.mock("@/server/platform/ai/sandbox-tools", () => ({ createTaskSandbox: mock.sandbox }));
vi.mock("@/server/platform/ai/model", () => ({ loadAiModel: mock.model }));
vi.mock("@/server/platform/ai/cost", () => ({
  createTaskCostTracker: async () => ({
    add: vi.fn(),
    snapshot: () => ({ status: "unavailable", reason: "price_unavailable", cny: null }),
  }),
}));
import { runAiTask } from "@/server/platform/ai/runner";
import {
  createPracticeGradingFeatures,
  practiceGradingContext,
} from "@/server/platform/ai/practice-grade";
const image = "/api/platform/assets/11111111-1111-4111-8111-111111111111";
const input = {
  attemptId: "attempt",
  expectedEvaluationVersion: 0,
  attemptFingerprint: "a".repeat(64),
  contentFingerprint: "b".repeat(64),
};
const context = () =>
  ({
    actor: { id: "student", role: "STUDENT" },
    sessionId: "session",
    setId: "set",
    subject: "数学",
    attemptId: "attempt",
    evaluationVersion: 0,
    attemptFingerprint: input.attemptFingerprint,
    contentFingerprint: input.contentFingerprint,
    paper: {
      instructions: "计算",
      layout: { textBlocks: [] },
      items: [
        {
          id: "item",
          snapshot: {
            type: "MIXED",
            content: {
              stem: "计算1+1",
              images: [],
              options: [],
              answers: ["2"],
              parts: [{ id: "part", stem: "小问", images: [], options: [], answers: ["2"] }],
            },
          },
        },
      ],
    },
    answers: [{ itemId: "item", text: "2", images: [] }],
    eligibility: [],
  }) as unknown as PracticeAiContext;
const evaluation = () => ({
  summary: "候选",
  items: [
    {
      itemId: "item",
      judgment: "CORRECT",
      feedback: "计算正确",
      parts: [{ partId: "part", judgment: "CORRECT", feedback: "小问正确" }],
    },
  ],
});
let inspect: (sources: string[]) => Promise<void>;
beforeEach(() => {
  vi.clearAllMocks();
  mock.context.mockResolvedValue(context());
  mock.asset.mockResolvedValue({ name: "image", buffer: Buffer.from("private-image") });
  mock.commit.mockResolvedValue({
    sessionId: "session",
    attemptId: "attempt",
    evaluationId: "evaluation",
    version: 1,
    counts: { CORRECT: 1 },
  });
  mock.sandbox.mockImplementation((options) => {
    inspect = (sources) => options.onImages([], sources);
    return { tools: {}, dispose: vi.fn() };
  });
});
async function call(
  features: Awaited<ReturnType<typeof createPracticeGradingFeatures>>,
  name: string,
  input: unknown,
) {
  return features.tools[name].execute!(input, { toolCallId: name, messages: [], context: {} });
}
async function read(features: Awaited<ReturnType<typeof createPracticeGradingFeatures>>) {
  await call(features, "read_attempt", {});
  return call(features, "read_question", { items: [{ itemId: "item" }] });
}
it("derives the session ID from the domain and rejects a forged session", async () => {
  expect((await practiceGradingContext("student", input)).input.sessionId).toBe("session");
  await expect(practiceGradingContext("student", { ...input, sessionId: "other" })).rejects.toThrow(
    "会话不一致",
  );
});
it("requires actual attempt and question reads and complete subquestion feedback", async () => {
  const features = await createPracticeGradingFeatures({ userId: "student", input, jobId: "job" });
  await expect(call(features, "propose_feedback", evaluation())).rejects.toThrow("先读取");
  await call(features, "read_attempt", {});
  await expect(call(features, "propose_feedback", evaluation())).rejects.toThrow("先读取");
  await read(features);
  await expect(
    call(features, "propose_feedback", {
      ...evaluation(),
      items: [{ ...evaluation().items[0], parts: [] }],
    }),
  ).rejects.toThrow("每个小问");
  await expect(call(features, "propose_feedback", { summary: "", items: [] })).rejects.toThrow(
    "至少提供",
  );
  expect(mock.commit).not.toHaveBeenCalled();
});
it("persists only a complete AI candidate through the domain's fixed job/version commit", async () => {
  const features = await createPracticeGradingFeatures({ userId: "student", input, jobId: "job" });
  await read(features);
  await call(features, "propose_feedback", evaluation());
  expect(mock.commit).not.toHaveBeenCalled();
  await call(features, "finish", { summary: "所有题待核验" });
  expect(features.isComplete()).toBe(true);
  await features.commit();
  expect(mock.commit).toHaveBeenCalledWith(
    { id: "student" },
    { ...input, sessionId: "session" },
    { ...evaluation(), summary: "所有题待核验" },
    { jobId: "job" },
  );
  await expect(call(features, "read_attempt", {})).rejects.toThrow("已完成");
});
it("requires actual images for confident judgments and never persists private scratch", async () => {
  const value = context();
  value.paper.items[0].snapshot.content.images = [image];
  value.answers[0].images = [image];
  mock.context.mockResolvedValue(value);
  const features = await createPracticeGradingFeatures({ userId: "student", input, jobId: "job" });
  await read(features);
  expect(mock.sandbox.mock.calls[0][0]).toMatchObject({ persistImages: false });
  await call(features, "read_material", { url: image });
  await expect(call(features, "propose_feedback", evaluation())).rejects.toThrow("实际查看");
  await inspect([image]);
  await call(features, "propose_feedback", evaluation());
  await call(features, "finish", { summary: "实际读图后的候选" });
  expect(mock.asset).toHaveBeenCalledWith(
    { id: "student" },
    { ...input, sessionId: "session" },
    image,
  );
});
it("unreadable images can be explicitly skipped including all parts, never scored zero", async () => {
  const value = context();
  value.answers[0].images = [image];
  mock.context.mockResolvedValue(value);
  const features = await createPracticeGradingFeatures({ userId: "student", input, jobId: "job" });
  await read(features);
  await call(features, "skip", { itemId: "item", judgment: "UNSURE", reason: "作答照片无法辨认" });
  await call(features, "finish", { summary: "请人工核对图片" });
  await features.commit();
  expect(mock.commit.mock.calls[0][2].items[0]).toEqual({
    itemId: "item",
    judgment: "UNSURE",
    feedback: "作答照片无法辨认",
    parts: [{ partId: "part", judgment: "UNSURE", feedback: "作答照片无法辨认" }],
  });
});
it("rechecks the fixed baseline on tools and surfaces stale commit without adopting a new baseline", async () => {
  const features = await createPracticeGradingFeatures({ userId: "student", input, jobId: "job" });
  await read(features);
  await call(features, "propose_feedback", evaluation());
  await call(features, "finish", { summary: "候选" });
  mock.commit.mockRejectedValue(new RequestError(409, "评阅版本已更新"));
  await expect(features.commit()).rejects.toThrow("版本已更新");
  expect(mock.context.mock.calls.every(([, fixed]) => fixed.expectedEvaluationVersion === 0)).toBe(
    true,
  );
  expect(mock.commit.mock.calls[0][1].expectedEvaluationVersion).toBe(0);
});
it("does not allow arbitrary material URLs or finish with missing items", async () => {
  const features = await createPracticeGradingFeatures({ userId: "student", input });
  await expect(call(features, "read_material", { url: image })).rejects.toThrow("先读取");
  await expect(call(features, "finish", { summary: "无依据" })).rejects.toThrow("缺少");
  expect(mock.asset).not.toHaveBeenCalled();
});
it("does not let a parallel tool overwrite the candidate after finish", async () => {
  const features = await createPracticeGradingFeatures({ userId: "student", input, jobId: "job" });
  await read(features);
  await call(features, "propose_feedback", evaluation());
  let release!: (value: PracticeAiContext) => void;
  mock.context.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const concurrent = call(features, "propose_feedback", { ...evaluation(), summary: "迟到的覆盖" });
  await call(features, "finish", { summary: "已经完成" });
  const rejected = expect(concurrent).rejects.toThrow("已完成");
  release(context());
  await rejected;
  await features.commit();
  expect(mock.commit.mock.calls[0][2].summary).toBe("已经完成");
});
it("accumulates bounded feedback batches and finishes only after all questions are covered", async () => {
  const value = context();
  value.paper.items.push({ ...structuredClone(value.paper.items[0]), id: "second" });
  mock.context.mockResolvedValue(value);
  const features = await createPracticeGradingFeatures({ userId: "student", input, jobId: "job" });
  await read(features);
  await call(features, "read_question", { items: [{ itemId: "second" }] });
  await call(features, "propose_feedback", evaluation());
  await expect(call(features, "finish", { summary: "未完成" })).rejects.toThrow("缺少");
  await call(features, "propose_feedback", {
    summary: "第二批",
    items: [{ ...evaluation().items[0], itemId: "second" }],
  });
  await call(features, "finish", { summary: "两批均核对" });
  await features.commit();
  expect(mock.commit.mock.calls[0][2].items.map((item: { itemId: string }) => item.itemId)).toEqual(
    ["item", "second"],
  );
});
it("uses the real ToolLoopAgent runner for autonomous practice reads, proposal and finish", async () => {
  const steps = [
    { name: "read_attempt", args: {} },
    { name: "read_question", args: { items: [{ itemId: "item" }] } },
    { name: "propose_feedback", args: evaluation() },
    { name: "finish", args: { summary: "候选反馈" } },
  ];
  let index = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      const step = steps[index++];
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
  mock.model.mockResolvedValue({
    createSession: () => ({ model, close: vi.fn() }),
    reasoning: "high",
    identity: {
      providerId: "provider",
      providerName: "test",
      modelId: "model",
      model: "test",
      apiType: "openai_chat",
    },
    maxOutputTokens: 16000,
    timeoutMs: 30000,
    maxConcurrency: 1,
  });
  const output = await runAiTask({
    userId: "student",
    kind: "PRACTICE_GRADE",
    input,
    jobId: "job",
    modelId: "model",
  });
  expect(index).toBe(4);
  expect(mock.commit).toHaveBeenCalledOnce();
  expect(output.result).toMatchObject({ attemptId: "attempt", evaluationId: "evaluation" });
  expect(mock.sandbox.mock.calls[0][0].persistImages).toBe(false);
});
