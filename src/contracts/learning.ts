import { pointsSchema } from "./grading";
import { z } from "zod";
export const PRACTICE_QUEUE = "learning.practice.v1";
export const TOPICS = [
  { id: "arithmetic", name: "数与运算", subject: "数学" }, { id: "fractions", name: "分数与百分数", subject: "数学" },
  { id: "equations", name: "方程与不等式", subject: "数学" }, { id: "functions", name: "函数", subject: "数学" },
  { id: "geometry", name: "图形与几何", subject: "数学" }, { id: "statistics", name: "统计与概率", subject: "数学" },
  { id: "reading", name: "阅读理解", subject: "语文" }, { id: "language", name: "语言基础", subject: "语文" },
  { id: "english", name: "词汇与语法", subject: "英语" }, { id: "other", name: "其他知识点", subject: "其他" },
] as const;
export const topicSchema = z.enum(TOPICS.map((t) => t.id));
export const practiceCreateSchema = z.object({ entryKey: z.string().min(1).max(240), mode: z.enum(["original", "similar"]), difficulty: z.enum(["基础", "巩固", "提高"]).default("巩固") });
export const practiceAnswerSchema = z.object({ answers: z.array(z.object({ id: z.string().max(100), answer: z.string().trim().min(1,"请填写作答。").max(12000) })).min(1).max(5) });
export const practiceItemSchema = z.object({ id: z.string().min(1), stem: z.string().min(1).max(12000), answer: z.string().min(1).max(12000), explanation: z.string().max(12000), rubric: z.string().max(6000), maxPoints: pointsSchema, topicId: topicSchema });
export const practiceContentSchema = z.object({ questions: z.array(practiceItemSchema).min(1).max(5) });
export type WrongEntry = { key: string; gradeTaskId: string; questionId: string; examTaskId: string; title: string; number: string; stem: string; subject: string; topicId: string | null; verdict: string; feedback: string; lastErrorAt: string; attempts: number; correctAttempts: number; mastered: boolean };
export type LearningOverview = { entries: WrongEntry[]; topics: { id: string; name: string; count: number; practiced: number }[]; pending: number; mathImages?: Record<string, string> };
export type PracticeView = { id: string; mode: string; status: string; error: string | null; submitted: boolean; questions: { id: string; stem: string; maxPoints: number; topicId: string; figures?: { url: string; caption: string }[] }[]; result: import("./grading").GradeResult | null; mathImages?: Record<string, string>; handwriting?: { status: string; answers: { id: string; answer: string }[]; message: string } };
