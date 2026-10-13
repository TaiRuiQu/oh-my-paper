import { describe, expect, it } from "vitest";
import { presentAgentTask, presentWorkflow } from "@/lib/task-presentation";
import type { ExamAgentTask } from "@/contracts/exam-agents";
import type { GradingWorkflow } from "@/contracts/workflows";
const task: ExamAgentTask = {
  id: "task",
  kind: "ANSWER",
  name: "标准答案",
  status: "FAILED",
  error: "SDK internal exception",
  createdAt: "2026-10-12T00:00:00Z",
  submissionId: null,
  progress: { total: 10, completed: 1 },
  result: {
    questions: [
      { questionId: "q", solution: "unfinished solution", gradingCriteria: "unfinished criteria" },
    ],
  },
};
const flow: GradingWorkflow = {
  id: "flow",
  kind: "QUICK",
  name: "答卷",
  status: "RUNNING",
  sourceId: "source",
  createdAt: task.createdAt,
  error: "internal",
  stage: "ANSWER",
  progress: {
    recognition: { total: 10, completed: 10 },
    answer: { total: 10, completed: 1 },
    grading: { total: 10, completed: 0 },
  },
  source: {
    id: "source",
    name: "试卷",
    status: "COMPLETED",
    error: "internal source",
    createdAt: task.createdAt,
  },
  answer: task,
  grading: task,
};
describe("role-scoped task payloads", () => {
  it("removes draft answers and exception details from ordinary payloads", () => {
    const result = presentAgentTask(task, false);
    expect(result.result.questions).toEqual([]);
    expect(result.progress).toEqual({ total: 10, completed: 1 });
    expect(result.error).not.toContain("SDK");
    expect(presentAgentTask(task, true)).toBe(task);
  });
  it("publishes completed answers without altering the result", () => {
    expect(presentAgentTask({ ...task, status: "COMPLETED" }, false).result).toEqual(task.result);
  });
  it("omits workflow stages and intermediate tasks for ordinary users", () => {
    const result = presentWorkflow(flow, false);
    expect(result.stage).toBeUndefined();
    expect(result.progress).toEqual(flow.progress);
    expect(result.answer).toBeNull();
    expect(result.grading).toBeNull();
    expect(result.source.error).toBeNull();
    expect(JSON.stringify(result)).not.toContain("unfinished");
    expect(presentWorkflow(flow, true)).toBe(flow);
  });
  it("keeps completed reports available to the owner", () => {
    const completed = {
      ...flow,
      status: "COMPLETED" as const,
      grading: { ...task, kind: "GRADING" as const, status: "COMPLETED" as const },
    };
    expect(presentWorkflow(completed, false).grading?.result).toEqual(task.result);
  });
});
