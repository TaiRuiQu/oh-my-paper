import { z } from "zod";

// Coordinates refer to the upright, normalized page, never a detail tile.
export const sourceRegionSchema = z.object({
  page: z.number().int().positive(),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().positive().max(1),
  height: z.number().positive().max(1),
});
export type SourceRegion = z.infer<typeof sourceRegionSchema>;

export const contentBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("math"), latex: z.string() }),
  z.object({ type: z.literal("table"), rows: z.array(z.array(z.string())) }),
  z.object({
    type: z.literal("figure"), caption: z.string(), region: sourceRegionSchema,
    contaminated: z.boolean(),
  }),
]);
export type ContentBlock = z.infer<typeof contentBlockSchema>;

export const questionPartSchema = z.object({
  label: z.string(), parentLabel: z.string().nullable(),
  blocks: z.array(contentBlockSchema), points: z.number().nonnegative().nullable(),
});

export const questionFragmentSchema = z.object({
  number: z.string().min(1), section: z.string(),
  type: z.enum(["single_choice", "multiple_choice", "fill_blank", "short_answer", "essay", "unknown"]),
  continuation: z.boolean(), continuesNextPage: z.boolean(),
  points: z.number().nonnegative().nullable(),
  blocks: z.array(contentBlockSchema),
  options: z.array(z.object({ label: z.string(), blocks: z.array(contentBlockSchema) })),
  parts: z.array(questionPartSchema), materialRefs: z.array(z.string()),
  regions: z.array(sourceRegionSchema).min(1),
});
export type QuestionFragment = z.infer<typeof questionFragmentSchema>;

export const materialSchema = z.object({
  key: z.string().min(1), title: z.string(), section: z.string(),
  blocks: z.array(contentBlockSchema), regions: z.array(sourceRegionSchema).min(1),
  continuation: z.boolean(), continuesNextPage: z.boolean(),
});

export const annotationSchema = z.object({
  questionNumber: z.string().nullable(), section: z.string(), partLabel: z.string().nullable(),
  kind: z.enum(["student_answer", "reference_answer", "teacher_annotation", "rubric"]),
  blocks: z.array(contentBlockSchema), regions: z.array(sourceRegionSchema).min(1),
});

export const findingSchema = z.object({
  severity: z.enum(["warning", "error"]), code: z.string(), message: z.string(),
  questionNumber: z.string().nullable(),
});
export type Finding = z.infer<typeof findingSchema>;

export const parsedPageSchema = z.object({
  documentType: z.enum(["question_paper", "answer_key", "answer_sheet", "teacher_notes", "mixed", "unknown"]),
  title: z.string().nullable(), subject: z.string().nullable(), grade: z.string().nullable(),
  instructions: z.array(z.string()),
  questions: z.array(questionFragmentSchema), materials: z.array(materialSchema),
  annotations: z.array(annotationSchema), findings: z.array(findingSchema),
});
export type ParsedPage = z.infer<typeof parsedPageSchema>;

export const pageLayoutSchema = z.object({
  documentType: parsedPageSchema.shape.documentType,
  questions: z.array(z.object({ number: z.string(), section: z.string(), continuation: z.boolean() })),
  description: z.string(),
});

export const verifiedPageSchema = z.object({
  page: parsedPageSchema,
  corrections: z.array(z.string()),
  // Only unresolved problems remain in page.findings after correction.
});

export type FigureAsset = {
  id: string; region: SourceRegion; caption: string; contaminated: boolean;
  evidenceKey: string; cleanKey: string | null;
};

export type ExamQuestion = Omit<QuestionFragment, "continuation" | "continuesNextPage"> & {
  id: string; status: "ready" | "needs_review";
};

export type DigitalExam = {
  schemaVersion: "1.0";
  id: string; title: string | null; subject: string | null; grade: string | null;
  sourceFiles: { name: string; key: string; sha256: string; mimeType: string }[];
  pages: { page: number; key: string; width: number; height: number; rotation: number;
    documentType: ParsedPage["documentType"]; status: "verified" | "needs_review" | "failed" }[];
  instructions: string[]; questions: ExamQuestion[];
  materials: z.infer<typeof materialSchema>[];
  annotations: z.infer<typeof annotationSchema>[];
  assets: FigureAsset[];
  verification: {
    status: "verified" | "needs_review" | "partial";
    model: string; promptVersion: string;
    findings: (Finding & { page: number })[];
    corrections: { page: number; changes: string[] }[];
    usage: { inputTokens: number; outputTokens: number; cachedInputTokens?: number; cacheWriteTokens?: number; calls: number };
  };
};
