import type { DigitalExam } from "./exams";

export const EXAM_PARSE_QUEUE = "exam.parse.v1";
export const UPLOAD_LIMITS = { fileBytes: 40 * 1024 * 1024, totalBytes: 100 * 1024 * 1024, files: 20, pages: 50 } as const;
export type ExamTaskSummary = {
  id: string; name: string; status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
  page: number; totalPages: number; phase: string; error: string | null;
  model: string; createdAt: string; outputKey?: string | null;
};
export type ExamTaskDetail = { task: ExamTaskSummary; exam: DigitalExam | null; mathImages?: Record<string, string> };
