import { z } from "zod";
import { practiceGradeInputSchema } from "./practice";
import { lessonPrepareInputSchema } from "./teaching";
import { consolidationPaperSchema } from "./revision-papers";
import type { AiTaskCost } from "./ai-cost";
export const MAX_AI_IMPORT_PAGES = 20;
export const MAX_AI_BATCH_PAGES = 100;
export const aiKinds = [
  "IMPORT",
  "ENRICH",
  "ASSEMBLE",
  "TEMPLATE",
  "GRADE",
  "RECOMMEND",
  "CONSOLIDATE",
  "LESSON_PREPARE",
  "PRACTICE_GRADE",
] as const;
export type AiKind = (typeof aiKinds)[number];
export type GradingResult = {
  assessmentId: string;
  assessmentKind: "EXAM" | "HOMEWORK";
  classroomId: string;
  paperId: string;
  templateId?: string;
  students: {
    studentId: string;
    name: string;
    submissionId: string;
    gradedQuestions: number;
    skippedQuestions: number;
  }[];
  pendingPages: { sourceUrl: string; reason: string }[];
};
const id = z.string().min(1).max(128);
const questionType = z.enum(["SINGLE", "MULTIPLE", "BLANK", "SUBJECTIVE", "MIXED"]);
export const aiInputSchemas = {
  CONSOLIDATE: consolidationPaperSchema,
  LESSON_PREPARE: lessonPrepareInputSchema,
  PRACTICE_GRADE: practiceGradeInputSchema,
  IMPORT: z.strictObject({
    assetUrls: z
      .array(z.string().regex(/^\/api\/platform\/assets\/[\w-]+$/))
      .min(1)
      .max(MAX_AI_IMPORT_PAGES),
    subject: z.string().max(40).optional(),
    grade: z.string().max(40).optional(),
    name: z.string().max(200).optional(),
    kind: z.enum(["EXAM", "HOMEWORK"]).optional(),
  }),
  ENRICH: z.strictObject({ questionIds: z.array(id).min(1).max(100) }),
  ASSEMBLE: z
    .strictObject({
      name: z.string().trim().min(1).max(200),
      subject: z.string().min(1).max(40),
      grade: z.string().max(40),
      difficulty: z.number().min(0).max(1),
      difficultyTolerance: z.number().min(0).max(1).default(0.2),
      counts: z
        .array(
          z.strictObject({
            type: questionType,
            count: z.number().int().min(1).max(100),
            score: z.number().positive().max(10000),
            section: z.string().max(100).optional(),
          }),
        )
        .min(1)
        .max(5),
      knowledgeDistribution: z
        .array(
          z.strictObject({
            tag: z.string().trim().min(1).max(120),
            percent: z.number().positive().max(100),
          }),
        )
        .min(1)
        .max(30),
      kind: z.enum(["EXAM", "HOMEWORK"]).default("EXAM"),
    })
    .superRefine((v, c) => {
      if (Math.abs(v.knowledgeDistribution.reduce((n, t) => n + t.percent, 0) - 100) > 0.001)
        c.addIssue({ code: "custom", message: "知识点占比总和必须为100%。" });
      if (
        new Set(v.counts.map((c) => c.type)).size !== v.counts.length ||
        new Set(v.knowledgeDistribution.map((d) => d.tag)).size !== v.knowledgeDistribution.length
      )
        c.addIssue({ code: "custom", message: "题型与知识点不能重复。" });
    }),
  TEMPLATE: z.strictObject({ paperId: id, name: z.string().max(200).optional() }),
  GRADE: z
    .strictObject({
      assessmentId: id,
      rosterRevision: z.number().int().min(1),
      classroomId: id,
      paperId: id,
      templateId: id.optional(),
      assetUrls: z
        .array(z.string().regex(/^\/api\/platform\/assets\/[\w-]+$/))
        .max(MAX_AI_BATCH_PAGES)
        .default([]),
      pagesPerStudent: z.number().int().min(1).max(MAX_AI_BATCH_PAGES).optional(),
      studentIds: z.array(id).max(MAX_AI_BATCH_PAGES).default([]),
      submissionIds: z.array(id).min(1).max(500).optional(),
    })
    .superRefine((input, ctx) => {
      if (new Set(input.assetUrls).size !== input.assetUrls.length)
        ctx.addIssue({ code: "custom", message: "扫描页不能重复。" });
      if (new Set(input.studentIds).size !== input.studentIds.length)
        ctx.addIssue({ code: "custom", message: "学生不能重复。" });
      if (input.submissionIds && new Set(input.submissionIds).size !== input.submissionIds.length)
        ctx.addIssue({ code: "custom", message: "答卷不能重复。" });
      if (input.assetUrls.length && input.submissionIds)
        ctx.addIssue({ code: "custom", message: "上传材料与已录入答卷不能同时批改。" });
      if (input.assetUrls.length && !input.studentIds.length)
        ctx.addIssue({ code: "custom", message: "请按上传分组指定学生顺序。" });
      if (!input.assetUrls.length && (input.studentIds.length || input.pagesPerStudent))
        ctx.addIssue({ code: "custom", message: "学生顺序与每人页数仅用于上传材料。" });
    }),
  RECOMMEND: z.strictObject({
    studentId: id.optional(),
    count: z.number().int().min(1).max(20).default(5),
    subject: z.string().max(40).optional(),
  }),
};
export const aiRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("PRACTICE_GRADE"),
    input: aiInputSchemas.PRACTICE_GRADE,
    modelId: id,
  }),
  z.strictObject({
    kind: z.literal("LESSON_PREPARE"),
    input: aiInputSchemas.LESSON_PREPARE,
    modelId: id,
  }),
  z.strictObject({
    kind: z.literal("CONSOLIDATE"),
    input: aiInputSchemas.CONSOLIDATE,
    modelId: id,
  }),
  z.strictObject({ kind: z.literal("IMPORT"), input: aiInputSchemas.IMPORT, modelId: id }),
  z.strictObject({ kind: z.literal("ENRICH"), input: aiInputSchemas.ENRICH, modelId: id }),
  z.strictObject({ kind: z.literal("ASSEMBLE"), input: aiInputSchemas.ASSEMBLE, modelId: id }),
  z.strictObject({ kind: z.literal("TEMPLATE"), input: aiInputSchemas.TEMPLATE, modelId: id }),
  z.strictObject({ kind: z.literal("GRADE"), input: aiInputSchemas.GRADE, modelId: id }),
  z.strictObject({ kind: z.literal("RECOMMEND"), input: aiInputSchemas.RECOMMEND, modelId: id }),
]);
export type PracticeJobProgress = {
  sessionId: string;
  attemptId: string;
  counts: Record<string, number>;
  feedbackHref: string;
};
export type AiJobDTO = {
  id: string;
  userId: string;
  kind: AiKind;
  modelId: string;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
  input: unknown;
  result: unknown;
  cost: AiTaskCost | null;
  events: unknown[];
  practice?: PracticeJobProgress;
  error: string | null;
  attempts: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};
