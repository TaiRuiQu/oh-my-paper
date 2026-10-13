export type QuestionProgress = { total: number | null; completed: number };
import type { Exam } from "./exams";
export const EXAM_PARSE_QUEUE = "exam.parse.v2";
export const UPLOAD_LIMITS = {
  fileBytes: 40 * 1024 * 1024,
  totalBytes: 100 * 1024 * 1024,
  files: 20,
  pages: 50,
} as const;
export type ExamTaskSummary = {
  id: string;
  name: string;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
  error: string | null;
  errorCode?: string | null;
  createdAt: string;
  deletedAt?: string | null;
  creditsSpent?: string;
  progress?: QuestionProgress;
  answerStatus?: "MISSING" | "PROCESSING" | "READY";
};
export type ExamTaskDetail = {
  task: ExamTaskSummary;
  exam: Exam | null;
};
