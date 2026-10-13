import { z } from "zod";
import type { ExamTaskSummary } from "./exam-tasks";
import type { ExamAgentTask } from "./exam-agents";
import type { Exam } from "./exams";
export const adminListSchema = z.object({
  search: z.string().trim().max(200).default(""),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
});
export const adminUserUpdateSchema = z.strictObject({
  name: z.string().trim().min(1, "请输入姓名。").max(80),
  role: z.enum(["USER", "ADMIN"]),
});
export const resetPasswordSchema = z.strictObject({
  password: z.string().min(10, "密码至少需要 10 个字符。").max(128, "密码最多 128 个字符。"),
});
export type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  credits: string;
  createdAt: string;
  examCount: number;
};
export type AdminExam = ExamTaskSummary & {
  owner: { id: string; name: string; email: string };
  source: "试卷上传" | "快速批改";
};
export type AdminList<T> = { items: T[]; total: number; page: number; pageSize: number };
export type AdminExamDetail = { task: AdminExam; exam: Exam | null; agents: ExamAgentTask[] };
