import { z } from "zod";

export const classInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

export const studentInputSchema = z.object({
  classroomId: z.uuid(),
  name: z.string().trim().min(1).max(80),
  number: z.string().trim().min(1).max(40),
  email: z.union([z.email(), z.literal("")]).default(""),
});

export const batchInputSchema = z.object({
  classroomId: z.uuid(),
  name: z.string().trim().min(1).max(80),
  templateId: z.uuid(),
});

export type StudentInput = z.infer<typeof studentInputSchema>;
export type BatchInput = z.infer<typeof batchInputSchema>;

export type ClassroomSummary = {
  id: string;
  name: string;
  students: { id: string; name: string; number: string; linked: boolean }[];
  batches: {
    id: string;
    name: string;
    templateId: string | null;
    templateName: string | null;
    createdAt: string;
    exams: {
      id: string;
      student: string;
      number: string;
      status: "识别未完成" | "批改完成" | "批改未完成" | "等待批改" | "处理中";
      gradeId: string | null;
      score: number | null;
      maximum: number | null;
      pending: number | null;
    }[];
  }[];
};

export type ClassOverview = ClassroomSummary[];
