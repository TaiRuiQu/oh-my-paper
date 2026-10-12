import { z } from "zod";
import {
  answerTargetSchema,
  examInventorySchema,
  findingSchema,
  questionFragmentSchema,
  sourceRegionSchema,
} from "./exams";

const figures = z.array(
  z.object({
    id: z.string().min(1),
    caption: z.string(),
    region: sourceRegionSchema,
    contaminated: z.boolean(),
  }),
);
const annotationKind = z.enum([
  "student_answer",
  "reference_answer",
  "teacher_annotation",
  "rubric",
]);
export const recognitionQuestionSchema = z.object({
  order: z.number().int().positive(),
  number: z.string().min(1),
  section: z.string(),
  type: questionFragmentSchema.shape.type,
  markdown: z.string(),
  options: z.array(z.object({ label: z.string(), markdown: z.string() })).default([]),
  parts: z
    .array(
      z.object({
        label: z.string(),
        parentLabel: z.string().nullable().default(null),
        markdown: z.string(),
        points: z.number().nonnegative().nullable().default(null),
      }),
    )
    .default([]),
  points: z.number().nonnegative().nullable(),
  regions: z.array(sourceRegionSchema).min(1),
  materialRefs: z.array(z.string()).default([]),
  figures: figures.default([]),
  pointsOrigin: z.enum(["printed", "inferred", "unknown"]),
  pointsReason: z.string(),
  answerTargets: z.array(answerTargetSchema).min(1),
});
export const recognitionMetadataSchema = examInventorySchema
  .pick({ title: true, subject: true, grade: true, instructions: true, sections: true })
  .extend({
    pages: z
      .array(
        examInventorySchema.shape.pages.element.extend({
          hasQuestionStems: z.boolean(),
          annotationKinds: z
            .array(annotationKind)
            .describe(
              "Kinds of answer or annotation evidence present on this page, including blank or unreadable student responses. Empty for clean question pages.",
            ),
        }),
      )
      .min(1),
    materials: z
      .array(
        z.object({
          key: z.string(),
          title: z.string(),
          section: z.string(),
          markdown: z.string(),
          regions: z.array(sourceRegionSchema).min(1),
          figures: figures.default([]),
        }),
      )
      .default([]),
    findings: z.array(findingSchema).default([]),
  });
export type AgentEvent = {
  sequence: number;
  at: string;
  type:
    | "started"
    | "step"
    | "message"
    | "tool_call"
    | "tool_result"
    | "tool_error"
    | "completed"
    | "failed";
  step?: number;
  callId?: string;
  tool?: string;
  text?: string;
  data?: unknown;
  durationMs?: number;
};
export type AgentEventInput = Omit<AgentEvent, "sequence" | "at">;
export type RecognitionActivity = {
  attempt: string | null;
  events: AgentEvent[];
  cursor: number;
  active: boolean;
};
export const recognitionAnnotationSchema = z.object({
  id: z.string().min(1),
  questionNumber: z
    .string()
    .nullable()
    .describe(
      "Printed main question number. Save each numbered answer separately; null only when its number is absent or unreadable.",
    ),
  section: z.string(),
  partLabel: z.string().nullable(),
  kind: annotationKind,
  markdown: z.string(),
  regions: z.array(sourceRegionSchema).min(1),
  figures: figures.default([]),
});
export const recognitionAnnotationsSchema = z.object({
  annotations: z.array(recognitionAnnotationSchema).min(1).max(4),
});
export const recognitionDraftSchema = z.object({
  format: z.literal("markdown-latex"),
  metadata: recognitionMetadataSchema.optional(),
  questions: z.array(recognitionQuestionSchema).max(300),
  annotations: z.array(recognitionAnnotationSchema),
});
