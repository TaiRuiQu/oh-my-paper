import { beforeEach, expect, it, vi } from "vitest";
import { AccessError, RequestError } from "@/server/http/errors";
const mock = vi.hoisted(() => ({
  actor: vi.fn(),
  context: vi.fn(),
  state: vi.fn(),
  internal: vi.fn(),
  create: vi.fn(),
  query: vi.fn(),
  db: vi.fn(),
  find: vi.fn(),
  list: vi.fn(),
}));
vi.mock("@/server/db/client", () => ({ getDb: mock.db }));
vi.mock("@/server/platform/service", () => ({ getActor: mock.actor, loadState: mock.state }));
vi.mock("@/server/platform/queries", () => ({ loadInternalState: mock.internal }));
vi.mock("@/server/platform/ai/practice-grade", () => ({ practiceGradingContext: mock.context }));
vi.mock("@/server/platform/ai/lesson-prepare", () => ({ lessonPreparationContext: vi.fn() }));
vi.mock("@/server/platform/revision-papers", () => ({ consolidationContext: vi.fn() }));
vi.mock("@/server/platform/ai/runner", () => ({ runAiTask: vi.fn() }));
import { enqueueAiJob, retryAiJob, getAiJob, listAiJobs } from "@/server/platform/ai-jobs";
const input = {
  attemptId: "attempt",
  expectedEvaluationVersion: 0,
  attemptFingerprint: "a".repeat(64),
  contentFingerprint: "b".repeat(64),
};
let tx: object;
beforeEach(() => {
  vi.clearAllMocks();
  mock.actor.mockResolvedValue({ id: "student", role: "STUDENT" });
  mock.context.mockResolvedValue({ input: { ...input, sessionId: "session" } });
  mock.create.mockResolvedValue({ id: "job" });
  tx = {
    $executeRaw: vi.fn(),
    $queryRaw: mock.query,
    aiJob: { count: vi.fn(async () => 0), create: mock.create },
  };
  mock.db.mockReturnValue({
    ...tx,
    aiModel: { findFirst: vi.fn(async () => ({ id: "model" })), findMany: vi.fn(async () => []) },
    aiJob: { findUnique: mock.find, findFirst: mock.find, findMany: mock.list },
    $transaction: async (work: (db: object) => Promise<unknown>) => work(tx),
  });
});
const enqueue = () => enqueueAiJob("student", { kind: "PRACTICE_GRADE", modelId: "model", input });
it("allows an authorized student's separate practice grader and captures the authoritative session under lock", async () => {
  await expect(enqueue()).resolves.toEqual({ id: "job" });
  expect(mock.context.mock.calls).toEqual([
    ["student", input],
    ["student", input, tx],
  ]);
  expect(mock.query).toHaveBeenCalled();
  expect(mock.create).toHaveBeenCalledWith({
    data: {
      userId: "student",
      modelId: "model",
      kind: "PRACTICE_GRADE",
      input: { ...input, sessionId: "session" },
    },
  });
  expect(mock.state).not.toHaveBeenCalled();
  expect(mock.internal).not.toHaveBeenCalled();
});
it("rejects revoked authority or changed evaluation under lock without queuing", async () => {
  mock.context
    .mockResolvedValueOnce({ input })
    .mockRejectedValueOnce(new RequestError(409, "练习已更新"));
  await expect(enqueue()).rejects.toMatchObject({ status: 409 });
  expect(mock.create).not.toHaveBeenCalled();
});
it("does not repurpose the formal grader for student practice", async () => {
  await expect(
    enqueueAiJob("student", {
      kind: "GRADE",
      modelId: "model",
      input: {
        assessmentId: "assessment",
        rosterRevision: 1,
        classroomId: "class",
        paperId: "paper",
      },
    }),
  ).rejects.toMatchObject({ status: 403 });
  expect(mock.context).not.toHaveBeenCalled();
});
it("retries the original private input, never the public projection or a fresh baseline", async () => {
  const fixed = { ...input, sessionId: "session" };
  mock.find.mockResolvedValue({
    id: "old",
    userId: "student",
    status: "FAILED",
    kind: "PRACTICE_GRADE",
    modelId: "model",
    input: fixed,
  });
  mock.context.mockRejectedValue(new RequestError(409, "旧候选版本过期"));
  await expect(retryAiJob("student", "old")).rejects.toMatchObject({ status: 409 });
  expect(mock.context).toHaveBeenCalledWith("student", fixed);
  expect(mock.create).not.toHaveBeenCalled();
});
it("projects real list/get service outputs while keeping ownership filtering", async () => {
  const secret = "PRIVATE_ANSWER_SENTINEL";
  const row = {
    id: "job",
    userId: "student",
    kind: "PRACTICE_GRADE",
    modelId: "model",
    status: "COMPLETED",
    input: { ...input, sessionId: "session" },
    result: { answer: secret, counts: { CORRECT: 1 } },
    events: [{ stdout: secret }],
    cost: null,
    error: null,
    attempts: 1,
    createdAt: new Date(),
    startedAt: null,
    finishedAt: new Date(),
  };
  mock.find.mockResolvedValue(row);
  mock.list.mockResolvedValue([row]);
  const detail = await getAiJob("student", "job");
  const list = await listAiJobs("student");
  expect(JSON.stringify({ detail, list })).not.toContain(secret);
  expect(detail).toMatchObject({
    input: null,
    result: null,
    events: [],
    practice: { attemptId: "attempt" },
  });
  expect(mock.find).toHaveBeenCalledWith({ where: { id: "job", userId: "student" } });
  expect(mock.list).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "student" } }));
  mock.find.mockResolvedValue(null);
  await expect(getAiJob("student", "foreign")).rejects.toBeInstanceOf(AccessError);
});
