import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  context: vi.fn(),
  state: vi.fn(),
  internal: vi.fn(),
  create: vi.fn(),
  query: vi.fn(),
  db: vi.fn(),
}));
vi.mock("@/server/db/client", () => ({ getDb: mocks.db }));
vi.mock("@/server/platform/service", () => ({ getActor: mocks.actor, loadState: mocks.state }));
vi.mock("@/server/platform/queries", () => ({ loadInternalState: mocks.internal }));
vi.mock("@/server/platform/ai/lesson-prepare", () => ({ lessonPreparationContext: mocks.context }));
vi.mock("@/server/platform/ai/runner", () => ({ runAiTask: vi.fn() }));
import { enqueueAiJob, retryAiJob } from "@/server/platform/ai-jobs";
const input = {
  sessionId: "session",
  publicationId: "pub",
  expectedVersion: 3,
  expectedPlanVersion: 2,
  expectedBindingVersion: 1,
  requirements: "自主准备一堂实验课",
};
let tx: object;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.actor.mockResolvedValue({ id: "teacher", role: "TEACHER" });
  mocks.context.mockResolvedValue({});
  mocks.create.mockResolvedValue({ id: "job" });
  tx = {
    $executeRaw: vi.fn(),
    $queryRaw: mocks.query,
    aiJob: { count: vi.fn(async () => 0), create: mocks.create },
  };
  mocks.db.mockReturnValue({
    ...tx,
    aiModel: { findFirst: vi.fn(async () => ({ id: "model" })) },
    aiJob: {
      findUnique: vi.fn(async () => ({
        id: "old",
        userId: "teacher",
        status: "FAILED",
        kind: "LESSON_PREPARE",
        modelId: "model",
        input,
      })),
    },
    $transaction: async (work: (db: object) => Promise<unknown>) => work(tx),
  });
});
const enqueue = () => enqueueAiJob("teacher", { kind: "LESSON_PREPARE", modelId: "model", input });
it("validates lesson authority both before enqueue and under the shared domain lock without loading marks", async () => {
  await expect(enqueue()).resolves.toEqual({ id: "job" });
  expect(mocks.context.mock.calls).toEqual([
    ["teacher", input],
    ["teacher", input, tx],
  ]);
  expect(mocks.query).toHaveBeenCalled();
  expect(mocks.state).not.toHaveBeenCalled();
  expect(mocks.internal).not.toHaveBeenCalled();
  expect(mocks.create).toHaveBeenCalledWith({
    data: { userId: "teacher", modelId: "model", kind: "LESSON_PREPARE", input },
  });
});
it("rejects a changed session or revoked teacher discovered after initial validation without creating a job", async () => {
  mocks.context.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("授课权限或版本已改变"));
  await expect(enqueue()).rejects.toThrow("权限或版本已改变");
  expect(mocks.create).not.toHaveBeenCalled();
});
it("refuses a student before any lesson or model data is read", async () => {
  mocks.actor.mockResolvedValue({ id: "student", role: "STUDENT" });
  await expect(enqueue()).rejects.toMatchObject({ status: 403 });
  expect(mocks.context).not.toHaveBeenCalled();
  expect(mocks.create).not.toHaveBeenCalled();
});
it("retains the original failed task baseline when retrying instead of adopting a new draft version", async () => {
  mocks.context.mockRejectedValue(new Error("教案已更新，请重新读取"));
  await expect(retryAiJob("teacher", "old")).rejects.toThrow("教案已更新");
  expect(mocks.context).toHaveBeenCalledWith("teacher", input);
  expect(mocks.create).not.toHaveBeenCalled();
});
