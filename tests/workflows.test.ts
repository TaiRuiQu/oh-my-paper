import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
const mocks = vi.hoisted(() => ({
  db: { gradingWorkflow: { findFirst: vi.fn(), updateMany: vi.fn() }, $transaction: vi.fn() },
  source: vi.fn(),
  agents: vi.fn(),
  create: vi.fn(),
  enqueue: vi.fn(),
  boss: vi.fn(),
  log: vi.fn(),
}));
vi.mock("@/server/db/client", () => ({ getDb: () => mocks.db }));
vi.mock("@/server/exams/tasks", () => ({
  ownedExamTask: mocks.source,
  taskSummary: (task: unknown) => task,
  taskDirectory: (id: string) => `/storage/exam-tasks/${id}`,
  retryExamTask: vi.fn(),
}));
vi.mock("@/server/exams/agent-tasks", () => ({
  listAgentTasks: mocks.agents,
  createAgentTask: mocks.create,
  retryAgentTask: vi.fn(),
  ownedAgentTask: vi.fn(),
  agentTaskSummary: (task: unknown) => task,
}));
vi.mock("@/server/jobs/client", () => ({ getJobProducer: mocks.boss }));
vi.mock("@/server/jobs/transaction", () => ({ enqueueInTransaction: mocks.enqueue }));
vi.mock("@/server/logger", () => ({ logError: mocks.log }));
import { processWorkflow } from "@/server/exams/workflows";
import { WORKFLOW_QUEUE } from "@/contracts/workflows";
import { RequestError } from "@/server/http/errors";
let flow: {
  id: string;
  jobId: string;
  userId: string;
  sourceId: string;
  kind: string;
  name: string;
  status: string;
  inputFiles: string[];
  referenceFiles: string[];
  answerTaskId: string | null;
  gradingTaskId: string | null;
  createdAt: Date;
  error: null;
};
beforeEach(() => {
  vi.clearAllMocks();
  flow = {
    id: randomUUID(),
    jobId: randomUUID(),
    userId: "u",
    sourceId: randomUUID(),
    kind: "GRADING",
    name: "student.png",
    status: "RUNNING",
    inputFiles: ["inputs/1.upload"],
    referenceFiles: [],
    answerTaskId: null,
    gradingTaskId: null,
    createdAt: new Date(),
    error: null,
  };
  mocks.db.gradingWorkflow.findFirst.mockResolvedValue(flow);
  mocks.db.gradingWorkflow.updateMany.mockResolvedValue({ count: 1 });
  mocks.db.$transaction.mockImplementation(async (fn) => fn(mocks.db));
  mocks.source.mockResolvedValue({
    id: flow.sourceId,
    status: "COMPLETED",
    examId: "exam",
    inputFiles: ["inputs/1.upload"],
  });
  mocks.agents.mockResolvedValue([]);
  mocks.boss.mockResolvedValue({});
  mocks.log.mockReturnValue({ message: "internal error" });
});
describe("durable grading coordinator", () => {
  it("stops after parsing the answer key for a paper upload", async () => {
    flow.kind = "ANSWER_UPLOAD";
    flow.answerTaskId = "uploaded-answer";
    mocks.agents.mockResolvedValue([
      { id: "uploaded-answer", kind: "ANSWER", status: "COMPLETED" },
    ]);
    await processWorkflow(flow.id, flow.jobId);
    expect(mocks.db.gradingWorkflow.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "COMPLETED", error: null } }),
    );
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it("uses supplied quick answers instead of an independently generated reference", async () => {
    flow.kind = "QUICK";
    flow.referenceFiles = ["inputs/answer-2.upload"];
    mocks.agents.mockResolvedValue([
      { id: "generated", kind: "ANSWER", status: "COMPLETED", answerSource: "GENERATED" },
    ]);
    await processWorkflow(flow.id, flow.jobId);
    expect(mocks.create).toHaveBeenCalledWith(expect.any(Request), "u", flow.sourceId, "ANSWER", {
      id: flow.id,
      jobId: flow.jobId,
      files: [`/storage/exam-tasks/${flow.sourceId}/inputs/answer-2.upload`],
    });
  });
  it("generates missing answers then schedules a durable successor", async () => {
    await processWorkflow(flow.id, flow.jobId);
    expect(mocks.create).toHaveBeenCalledWith(expect.any(Request), "u", flow.sourceId, "ANSWER", {
      id: flow.id,
      jobId: flow.jobId,
    });
    expect(mocks.enqueue).toHaveBeenCalledWith(
      mocks.db,
      {},
      WORKFLOW_QUEUE,
      { workflowId: flow.id },
      expect.any(String),
      5,
    );
  });
  it("waits for recognition without prematurely generating or grading", async () => {
    mocks.source.mockResolvedValue({ id: flow.sourceId, status: "RUNNING" });
    await processWorkflow(flow.id, flow.jobId);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.enqueue).toHaveBeenCalledOnce();
  });
  it("uses an existing reference or attaches to a running generation", async () => {
    for (const status of ["COMPLETED", "RUNNING"]) {
      mocks.agents.mockResolvedValue([{ id: "answer", kind: "ANSWER", status }]);
      await processWorkflow(flow.id, flow.jobId);
      expect(mocks.db.gradingWorkflow.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { answerTaskId: "answer" } }),
      );
    }
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("grades original quick-upload files only after complete reference", async () => {
    flow.kind = "QUICK";
    flow.answerTaskId = "answer";
    mocks.agents.mockResolvedValue([{ id: "answer", kind: "ANSWER", status: "COMPLETED" }]);
    await processWorkflow(flow.id, flow.jobId);
    expect(mocks.create).toHaveBeenCalledWith(expect.any(Request), "u", flow.sourceId, "GRADING", {
      id: flow.id,
      jobId: flow.jobId,
      files: [`/storage/exam-tasks/${flow.sourceId}/inputs/1.upload`],
      name: "student.png",
    });
  });
  it("publishes completion without enqueuing or duplicating a grade", async () => {
    flow.answerTaskId = "a";
    flow.gradingTaskId = "g";
    mocks.agents.mockResolvedValue([
      { id: "a", kind: "ANSWER", status: "COMPLETED" },
      { id: "g", kind: "GRADING", status: "COMPLETED" },
    ]);
    await processWorkflow(flow.id, flow.jobId);
    expect(mocks.db.gradingWorkflow.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "COMPLETED", error: null } }),
    );
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it("stops on a failed child and preserves the linked draft", async () => {
    flow.answerTaskId = "a";
    mocks.agents.mockResolvedValue([
      { id: "a", kind: "ANSWER", status: "FAILED", error: "model error" },
    ]);
    await processWorkflow(flow.id, flow.jobId);
    expect(mocks.db.gradingWorkflow.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "FAILED", error: "internal error" } }),
    );
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it("reschedules transient concurrency conflicts", async () => {
    mocks.create.mockRejectedValueOnce(new RequestError(429, "busy"));
    await processWorkflow(flow.id, flow.jobId);
    expect(mocks.enqueue).toHaveBeenCalledOnce();
    expect(mocks.log).not.toHaveBeenCalled();
  });
  it("ignores obsolete coordinator jobs and lost successor claims", async () => {
    mocks.db.gradingWorkflow.findFirst.mockResolvedValueOnce(null);
    await processWorkflow(flow.id, "old-job");
    expect(mocks.source).not.toHaveBeenCalled();
    mocks.db.gradingWorkflow.updateMany.mockResolvedValue({ count: 0 });
    await processWorkflow(flow.id, flow.jobId);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});
