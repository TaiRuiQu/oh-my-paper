import { z } from "zod";
import { contentBlockSchema } from "./exams";

export const GRADING_QUEUE = "exam.grade.v1";
export const MAX_GRADING_QUESTIONS = 300;
export const pointsSchema = z
  .number()
  .min(0, "分值不能小于 0。")
  .max(1000, "每题分值不能超过 1000。")
  .refine(
    (value) => Math.abs(value * 100 - Math.round(value * 100)) < 0.000001,
    "分值最多保留两位小数。",
  );
export const gradeSubmissionSchema = z.object({
  questionId: z.string().min(1).max(100),
  answer: z.string().max(12000),
  referenceAnswer: z.string().max(12000),
  rubric: z.string().max(6000),
  maxPoints: pointsSchema.nullable(),
  unreadable: z.boolean().default(false),
  questionConfirmed: z.boolean().default(false),
  answerEdited: z.boolean().optional(),
});
export const gradeRequestSchema = z.object({
  submissions: z
    .array(gradeSubmissionSchema)
    .min(1, "请选择至少一道题。")
    .max(MAX_GRADING_QUESTIONS, `每次最多批改 ${MAX_GRADING_QUESTIONS} 道题。`),
});
export type GradeSubmission = z.infer<typeof gradeSubmissionSchema>;
export const criterionSchema = z.object({
  description: z.string().min(1).max(1000),
  maxPoints: pointsSchema,
  awardedPoints: pointsSchema,
  explanation: z.string().max(2000),
  targetKey: z.string().min(1).optional(),
});
export const assessmentSchema = z.object({
  verdict: z.enum(["correct", "partial", "incorrect", "unanswered", "needs_review"]),
  score: pointsSchema.nullable(),
  feedback: z.string().min(1).max(8000),
  criteria: z.array(criterionSchema).max(40),
  needsReview: z.boolean(),
  issues: z.array(z.string().max(2000)).max(20),
});
export const matchedAssessmentSchema = assessmentSchema.extend({
  matchedSourceIds: z.array(z.string()),
  studentAnswer: z.string().max(12000),
  studentAnswerBlocks: z.array(contentBlockSchema),
  answerStatus: z.enum(["answered", "unanswered", "unreadable", "ambiguous", "missing_evidence"]),
});
export const referenceSchema = z.object({
  answer: z.string().min(1).max(12000),
  rubric: z.string().max(6000),
  sufficient: z.boolean(),
  issues: z.array(z.string().max(2000)).max(20),
});
export const referenceVerificationSchema = referenceSchema.extend({ valid: z.boolean() });
const reviewRecordSchema = z.object({
  score: pointsSchema,
  maxPoints: pointsSchema,
  note: z.string(),
  reviewedAt: z.string(),
  reviewerId: z.string(),
});
export const gradeQuestionResultSchema = z.object({
  questionId: z.string(),
  number: z.string(),
  section: z.string(),
  studentAnswer: z.string(),
  questionText: z.string().default(""),
  sourcePage: z.number().int().positive().default(1),
  expectedAnswer: z.string(),
  referenceOrigin: z.enum(["supplied", "model", "none"]),
  rubric: z.string(),
  maxPoints: pointsSchema.nullable(),
  score: pointsSchema.nullable(),
  suggestedScore: pointsSchema.nullable(),
  verdict: assessmentSchema.shape.verdict,
  feedback: z.string(),
  criteria: z.array(criterionSchema),
  needsReview: z.boolean(),
  reviewReasons: z.array(z.string()),
  failed: z.boolean(),
  review: reviewRecordSchema.nullable(),
  reviewHistory: z.array(reviewRecordSchema).default([]),
  matchedSourceIds: z.array(z.string()).optional(),
  studentAnswerBlocks: z.array(contentBlockSchema).optional(),
});
export type GradeQuestionResult = z.infer<typeof gradeQuestionResultSchema>;
export const gradeResultSchema = z.object({
  schemaVersion: z.literal("1.0"),
  examId: z.string(),
  model: z.string(),
  promptVersion: z.string(),
  questions: z.array(gradeQuestionResultSchema),
  totals: z.object({
    awardedPoints: z.number(),
    gradedMaxPoints: z.number(),
    totalMaxPoints: z.number().nullable(),
    totalQuestions: z.number().int(),
    scoredQuestions: z.number().int(),
    pendingQuestions: z.number().int(),
    failedQuestions: z.number().int(),
  }),
  usage: z.object({
    inputTokens: z.number(),
    outputTokens: z.number(),
    cachedInputTokens: z.number(),
    cacheWriteTokens: z.number(),
    calls: z.number(),
  }),
});
export type GradeResult = z.infer<typeof gradeResultSchema>;
export const gradeReviewSchema = z.object({
  questionId: z.string().min(1).max(100),
  score: pointsSchema,
  maxPoints: pointsSchema,
  note: z.string().trim().min(1, "请输入核对说明。").max(2000),
});
export type GradeReviewInput = z.infer<typeof gradeReviewSchema>;
export type GradeTaskSummary = {
  id: string;
  examTaskId: string;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
  progress: number;
  total: number;
  phase: string;
  error: string | null;
  model: string;
  createdAt: string;
  examOutputKey: string;
};
export type GradeTaskDetail = {
  task: GradeTaskSummary;
  result: GradeResult | null;
  mathImages?: Record<string, string>;
  canReview?: boolean;
};
