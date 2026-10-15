import { z } from "zod";
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
  "BATCH_GRADE",
  "RECOMMEND",
  "CONSOLIDATE",
] as const;
export type AiKind = (typeof aiKinds)[number];
export type BatchGradingResult = {
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
  GRADE: z.strictObject({ submissionId: id }),
  BATCH_GRADE: z
    .strictObject({
      assessmentId: id,
      classroomId: id,
      paperId: id,
      templateId: id.optional(),
      assetUrls: z
        .array(z.string().regex(/^\/api\/platform\/assets\/[\w-]+$/))
        .max(MAX_AI_BATCH_PAGES)
        .default([]),
      studentHints: z
        .array(z.strictObject({ sourceUrl: z.string(), studentId: id }))
        .max(MAX_AI_BATCH_PAGES)
        .default([]),
    })
    .superRefine((input, ctx) => {
      if (new Set(input.assetUrls).size !== input.assetUrls.length)
        ctx.addIssue({ code: "custom", message: "扫描页不能重复。" });
      if (
        new Set(input.studentHints.map((hint) => hint.sourceUrl)).size !==
          input.studentHints.length ||
        input.studentHints.some((hint) => !input.assetUrls.includes(hint.sourceUrl))
      )
        ctx.addIssue({ code: "custom", message: "学生确认信息必须唯一对应本批扫描页。" });
    }),
  RECOMMEND: z.strictObject({
    studentId: id.optional(),
    count: z.number().int().min(1).max(20).default(5),
    subject: z.string().max(40).optional(),
  }),
};
export const aiRequestSchema = z.discriminatedUnion("kind", [
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
  z.strictObject({
    kind: z.literal("BATCH_GRADE"),
    input: aiInputSchemas.BATCH_GRADE,
    modelId: id,
  }),
  z.strictObject({ kind: z.literal("RECOMMEND"), input: aiInputSchemas.RECOMMEND, modelId: id }),
]);
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
  error: string | null;
  attempts: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};
