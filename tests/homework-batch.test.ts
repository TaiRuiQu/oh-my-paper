import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  storage: "",
  source: vi.fn(),
  provider: vi.fn(),
  credits: vi.fn(),
  worker: vi.fn(),
  enqueue: vi.fn(),
  db: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    gradingWorkflow: { count: vi.fn(), create: vi.fn() },
    examTask: { create: vi.fn() },
    exam: { findUniqueOrThrow: vi.fn() },
    examAgentTask: { findFirst: vi.fn() },
  },
}));
vi.mock("@/server/config/env", () => ({ getStoragePaths: () => ({ storage: mocks.storage }) }));
vi.mock("@/server/db/client", () => ({ getDb: () => mocks.db }));
vi.mock("@/server/exams/tasks", () => ({
  ownedExamTask: mocks.source,
  taskDirectory: (id: string) => join(mocks.storage, "exam-tasks", id),
}));
vi.mock("@/server/ai/user-settings", () => ({ getUserProvider: mocks.provider }));
vi.mock("@/server/ai/credits", () => ({ requireCredits: mocks.credits }));
vi.mock("@/server/jobs/health", () => ({ requireWorker: mocks.worker }));
vi.mock("@/server/jobs/client", () => ({ getJobProducer: async () => ({}) }));
vi.mock("@/server/jobs/transaction", () => ({ enqueueInTransaction: mocks.enqueue }));
import { createHomeworkBatch } from "@/server/exams/homework";
import { EXAM_PARSE_QUEUE } from "@/contracts/exam-tasks";
import { WORKFLOW_QUEUE } from "@/contracts/workflows";
const pdf = new TextEncoder().encode("%PDF-1.4\nstudent-scan\n%%EOF");
const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6TfsAAAAASUVORK5CYII=",
  "base64",
);
function request(count = 2, exam?: string, answers = false) {
  const form = new FormData();
  for (let i = 0; i < count; i++)
    form.append("files", new File([pdf], `student-${i}.pdf`, { type: "application/pdf" }));
  if (answers) form.append("answerFiles", new File([image], "answer.png", { type: "image/png" }));
  return new Request(`http://localhost/api/homework${exam ? `?exam=${exam}` : ""}`, {
    method: "POST",
    body: form,
  });
}
beforeEach(async () => {
  vi.clearAllMocks();
  mocks.storage = await mkdtemp(join(tmpdir(), "paper-homework-"));
  mocks.db.$transaction.mockImplementation((fn) => fn(mocks.db));
  mocks.db.gradingWorkflow.count.mockResolvedValue(0);
  mocks.db.gradingWorkflow.create.mockImplementation(({ data }) => Promise.resolve(data));
  mocks.provider.mockResolvedValue({ model: "test" });
  mocks.db.exam.findUniqueOrThrow.mockResolvedValue({ revision: 2 });
  mocks.db.examAgentTask.findFirst.mockResolvedValue({ id: "current-reference" });
  mocks.source.mockResolvedValue({
    id: randomUUID(),
    examId: randomUUID(),
    status: "COMPLETED",
    deletedAt: null,
  });
});
afterEach(async () => {
  await rm(mocks.storage, { recursive: true, force: true });
});
describe("atomic homework upload and durable queueing", () => {
  it.each([
    [20, false],
    [19, true],
  ])(
    "accepts %i PDFs and gives every student their own source, workflow and optional reference files",
    async (count, answers) => {
      const results = await createHomeworkBatch(request(count, undefined, answers), "owner");
      expect(results).toHaveLength(count);
      expect(new Set(results.map((r) => r.id)).size).toBe(count);
      expect(mocks.db.$transaction).toHaveBeenCalledOnce();
      expect(mocks.db.examTask.create).toHaveBeenCalledTimes(count);
      expect(mocks.enqueue.mock.calls.filter((c) => c[2] === EXAM_PARSE_QUEUE)).toHaveLength(count);
      expect(mocks.enqueue.mock.calls.filter((c) => c[2] === WORKFLOW_QUEUE)).toHaveLength(count);
      for (const [{ data }] of mocks.db.examTask.create.mock.calls) {
        expect(data.userId).toBe("owner");
        expect(data.inputFiles).toEqual(["inputs/1.upload"]);
        expect(
          await readFile(join(mocks.storage, "exam-tasks", data.id, "inputs/1.upload")),
        ).toEqual(Buffer.from(pdf));
        if (answers)
          expect(
            await readFile(join(mocks.storage, "exam-tasks", data.id, "inputs/answer-1.upload")),
          ).toEqual(image);
      }
    },
  );
  it("links independent marked papers to the selected exam and its current reference", async () => {
    const source = await mocks.source();
    await createHomeworkBatch(request(2, source.id), "owner");
    expect(mocks.source).toHaveBeenCalledWith("owner", source.id);
    expect(mocks.db.examTask.create).not.toHaveBeenCalled();
    expect(mocks.provider.mock.calls.map((call) => call[1])).toEqual(["grading"]);
    expect(mocks.db.gradingWorkflow.create).toHaveBeenCalledTimes(2);
    for (const [{ data }] of mocks.db.gradingWorkflow.create.mock.calls) {
      expect(data).toMatchObject({
        sourceId: source.id,
        answerTaskId: "current-reference",
        kind: "GRADING",
        inputFiles: ["inputs/1.upload"],
      });
      expect(
        await readFile(join(mocks.storage, "grading-workflows", data.id, "inputs/1.upload")),
      ).toEqual(Buffer.from(pdf));
    }
  });
  it("cleans up every prepared file if transaction enqueueing fails", async () => {
    mocks.enqueue.mockRejectedValueOnce(new Error("queue unavailable"));
    await expect(createHomeworkBatch(request(), "owner")).rejects.toThrow("queue unavailable");
    expect(await readdir(join(mocks.storage, "exam-tasks"))).toEqual([]);
    expect(await readdir(join(mocks.storage, "homework-uploads"))).toEqual([]);
  });
  it("rejects a batch exceeding the queue limit without enqueuing any student", async () => {
    mocks.db.gradingWorkflow.count.mockResolvedValue(39);
    await expect(createHomeworkBatch(request(), "owner")).rejects.toMatchObject({ status: 429 });
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(await readdir(join(mocks.storage, "exam-tasks"))).toEqual([]);
  });
});
