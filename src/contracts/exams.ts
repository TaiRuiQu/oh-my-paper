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
    assetId: z.string().optional(),
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
export const referencePageSchema = z.object({
  annotations: z.array(annotationSchema.extend({ kind: z.enum(["reference_answer", "rubric"]) })),
  findings: z.array(findingSchema),
});

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
  role?: "question" | "student_answer";
};

export type ExamQuestion = Omit<QuestionFragment, "continuation" | "continuesNextPage"> & {
  id: string; status: "ready" | "needs_review";
  solution?: QuestionSolution;
  crops?: { region: SourceRegion; key: string }[];
  answerTargets?: AnswerTarget[];
  pointsOrigin?: "printed" | "inferred" | "unknown" | "teacher";
  pointsReason?: string;
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
  inventory?: ExamInventory;
  answerDocument?: AnswerDocument;
  pipeline?: { version: string; generateAnswers: boolean; models: Record<string, string> };
  template?: { taskId: string; outputKey: string };
  verification: {
    status: "verified" | "needs_review" | "partial";
    model: string; promptVersion: string;
    findings: (Finding & { page: number })[];
    corrections: { page: number; changes: string[] }[];
    usage: { inputTokens: number; outputTokens: number; cachedInputTokens?: number; cacheWriteTokens?: number; calls: number };
  };
};

// The first request sees the entire paper. Each subsequent request owns one
// complete numbered question, including all its subparts and page continuations.
export const examInventorySchema = z.object({
  title: z.string().nullable(), subject: z.string().nullable(), grade: z.string().nullable(),
  instructions: z.array(z.string()),
  totalQuestions: z.number().int().min(0).max(300), totalPoints: z.number().nonnegative().nullable(),
  pages: z.array(z.object({ page: z.number().int().positive(), documentType: parsedPageSchema.shape.documentType,
    hasQuestionStems: z.boolean().optional() })),
  sections: z.array(z.object({ title: z.string(), points: z.number().nonnegative().nullable() })),
  questions: z.array(z.object({
    number: z.string().min(1), section: z.string(), points: z.number().nonnegative().nullable(),
    pointsOrigin: z.enum(["printed", "inferred", "unknown"]), pointsReason: z.string(),
    pages: z.array(z.number().int().positive()).min(1),
  })).max(300),
  findings: z.array(findingSchema),
});
export type ExamInventory = z.infer<typeof examInventorySchema>;
export const questionSolutionSchema = z.object({
  answer: z.string().max(12000), selectedOptions: z.array(z.string()),
  explanation: z.string().max(16000), rubric: z.string().max(6000),
  sufficient: z.boolean(), issues: z.array(z.string()),
  units: z.array(z.object({ targetKey: z.string(), answer: z.string(), selectedOptions: z.array(z.string()), explanation: z.string() })).default([]),
});
// Optional on previously saved documents; newly generated answers always have units.
export type QuestionSolution = Omit<z.infer<typeof questionSolutionSchema>, "units"> & {
  units?: z.infer<typeof questionSolutionSchema>["units"]; model: string; origin: "ai" | "teacher";
};

export const questionBoundsSchema = z.object({
  regions: z.array(sourceRegionSchema).min(1),
  figures: z.array(z.object({
    id: z.string().min(1), kind: z.enum(["table", "diagram", "image"]),
    region: sourceRegionSchema, contaminated: z.boolean(),
  })),
  findings: z.array(findingSchema),
});
export type QuestionBounds = z.infer<typeof questionBoundsSchema>;
export const questionLocalizationSchema = questionBoundsSchema.extend({
  figures: z.array(questionBoundsSchema.shape.figures.element.omit({ id:true })),
});
export const answerTargetSchema = z.object({
  key: z.string().min(1), partLabel: z.string().nullable(), parentLabel: z.string().nullable(),
  blankIndex: z.number().int().positive().nullable(),
});
export type AnswerTarget = z.infer<typeof answerTargetSchema>;
export const transcriptionBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("math"), latex: z.string() }),
  z.object({ type: z.literal("figure"), figureId: z.string().min(1), caption: z.string() }),
]);
export const questionTranscriptionSchema = z.object({
  type: questionFragmentSchema.shape.type,
  blocks: z.array(transcriptionBlockSchema),
  options: z.array(z.object({ label: z.string(), blocks: z.array(transcriptionBlockSchema) })),
  parts: z.array(z.object({ label: z.string(), parentLabel: z.string().nullable(), blocks: z.array(transcriptionBlockSchema), points: z.number().nonnegative().nullable() })),
  answerTargets: z.array(answerTargetSchema).min(1), findings: z.array(findingSchema),
});
export type QuestionTranscription = z.infer<typeof questionTranscriptionSchema>;

// A complete, ordered account of the student's evidence. Question hints are
// advisory: each grading agent must identify its own answer from this document.
export const answerLayoutSchema = z.object({
  pages: examInventorySchema.shape.pages,
  responses: z.array(z.object({
    id: z.string().min(1), questionNumber: z.string().nullable(), section: z.string(),
    regions: z.array(sourceRegionSchema).min(1),
  })), findings: z.array(findingSchema),
});
export const answerTranscriptionSchema = z.object({
  responses: z.array(z.object({
    sourceId: z.string().min(1), questionNumber: z.string().nullable(), section: z.string(),
    partLabel: z.string().nullable(), blocks: z.array(contentBlockSchema),
    unreadable: z.boolean(), blank: z.boolean(),
  })), findings: z.array(findingSchema),
});
export type AnswerDocument = {
  complete: boolean;
  responses: (z.infer<typeof answerTranscriptionSchema>["responses"][number] & { regions: SourceRegion[] })[];
  findings: Finding[];
  crops: { sourceId: string; region: SourceRegion; key: string }[];
};
