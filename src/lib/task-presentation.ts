import type { ExamTaskSummary } from "@/contracts/exam-tasks";
import type { ExamAgentTask } from "@/contracts/exam-agents";
import type { GradingWorkflow } from "@/contracts/workflows";
const creditError = "Credit 余额为负，无法开始新的任务。已完成的结果保留，请联系管理员。";
export function presentExamTask(task: ExamTaskSummary, isAdmin: boolean): ExamTaskSummary {
  return isAdmin
    ? task
    : {
        ...task,
        errorCode: task.errorCode === "CREDITS_EXHAUSTED" ? task.errorCode : undefined,
        error:
          task.status === "FAILED"
            ? task.errorCode === "CREDITS_EXHAUSTED"
              ? creditError
              : "试卷未能处理完成，请重试。"
            : null,
      };
}
export function presentAgentTask(task: ExamAgentTask, isAdmin: boolean): ExamAgentTask {
  return isAdmin
    ? task
    : {
        ...task,
        errorCode: task.errorCode === "CREDITS_EXHAUSTED" ? task.errorCode : undefined,
        error:
          task.status === "FAILED"
            ? task.errorCode === "CREDITS_EXHAUSTED"
              ? creditError
              : "处理未能完成，请重试。"
            : null,
        result: task.status === "COMPLETED" ? task.result : { questions: [] },
      };
}
export function presentWorkflow(flow: GradingWorkflow, isAdmin: boolean): GradingWorkflow {
  return isAdmin
    ? flow
    : {
        ...flow,
        stage: undefined,
        errorCode: flow.errorCode === "CREDITS_EXHAUSTED" ? flow.errorCode : undefined,
        error:
          flow.status === "FAILED"
            ? flow.errorCode === "CREDITS_EXHAUSTED"
              ? creditError
              : "批改未能完成，请重试。"
            : null,
        source: presentExamTask(flow.source, false),
        answer: null,
        grading:
          flow.status === "COMPLETED" && flow.grading
            ? presentAgentTask(flow.grading, false)
            : null,
      };
}
