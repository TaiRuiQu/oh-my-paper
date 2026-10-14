import type { ExamAgentTask } from "./exam-agents";
import type { ExamTaskSummary, QuestionProgress } from "./exam-tasks";
export const WORKFLOW_QUEUE = "exam.workflow.v1";
export const MAX_PENDING_HOMEWORK = 40;
export type GradingWorkflow = {
  id: string;
  kind: "GRADING" | "QUICK";
  name: string;
  status: ExamTaskSummary["status"];
  createdAt: string;
  creditsSpent?: string;
  sourceId: string;
  error: string | null;
  errorCode?: string | null;
  progress?: { recognition: QuestionProgress; answer: QuestionProgress; grading: QuestionProgress };
  stage?: "RECOGNITION" | "ANSWER" | "GRADING";
  source: ExamTaskSummary;
  answer: ExamAgentTask | null;
  grading: ExamAgentTask | null;
};

export type WorkflowSummary = Pick<
  GradingWorkflow,
  "id" | "kind" | "name" | "status" | "createdAt" | "sourceId" | "source"
>;
