import "server-only";
import { join } from "node:path";
import { tool } from "ai";
import { z } from "zod";
import {
  recognitionAnnotationsSchema,
  recognitionDraftSchema,
  recognitionMetadataSchema,
  recognitionQuestionSchema,
} from "@/contracts/recognition";
import type { AgentEventInput } from "@/contracts/recognition";
import type { DigitalExam } from "@/contracts/exams";
import type { ExamModel } from "@/server/ai/deepseek";
import { allQuestionBlocks } from "./assemble";
import { saveJSON } from "./evidence";
import type { PageImage } from "./documents";

import type {
  RecognitionQuestion,
  RecognitionAnnotation,
  RecognitionMetadata,
} from "./recognition/types";
import { RECOGNITION_INSTRUCTIONS } from "./recognition/instructions";
import { createRecognitionValidation } from "./recognition/validation";
import { assembleRecognition } from "./recognition/assemble";
import { createRecognitionImages } from "./recognition/images";
import { createInspectionTools } from "./recognition/inspection-tools";

export { RECOGNITION_VERSION, RECOGNITION_INSTRUCTIONS } from "./recognition/instructions";

export async function recognizeDocument(options: {
  exam: DigitalExam;
  pages: PageImage[];
  outputDir: string;
  model: ExamModel;
  signal?: AbortSignal;
  template?: DigitalExam;
  extractStudentAnswers?: boolean;
  onEvent: (event: AgentEventInput) => Promise<void>;
  draft?: { result: unknown; feedback?: string };
}) {
  const { exam, pages, outputDir, model, signal } = options;
  if (!model.runRecognitionAgent)
    throw new Error("The configured model adapter does not support recognition agents.");
  let metadata: RecognitionMetadata | undefined;
  const questions = new Map<string, RecognitionQuestion>(),
    annotations = new Map<string, RecognitionAnnotation>();
  if (options.draft) {
    const draft = recognitionDraftSchema.parse(options.draft.result);
    metadata = draft.metadata;
    for (const question of draft.questions)
      questions.set(JSON.stringify([question.section, question.number]), question);
    for (const annotation of draft.annotations) annotations.set(annotation.id, annotation);
  }
  const inspected = new Set<number>();
  let complete = false;
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(action: () => Promise<T> | T): Promise<T> => {
    const next = queue.then(() => {
      signal?.throwIfAborted();
      if (complete) throw new Error("Document already submitted.");
      return action();
    });
    queue = next.catch(() => {});
    return next;
  };
  const snapshot = () => ({
    format: "markdown-latex",
    sourceFiles: exam.sourceFiles,
    pageRotations: pages.map(({ page, rotation }) => ({ page, rotation })),
    metadata,
    questions: [...questions.values()].sort((a, b) => a.order - b.order),
    annotations: [...annotations.values()],
  });
  const checkpoint = () => saveJSON(join(outputDir, "recognition.json"), snapshot());
  const { regionErrors, evidenceErrors, questionErrors, markdownErrors, submissionErrors } =
    createRecognitionValidation(pages);
  const { imageOutput, reviewEvidence } = createRecognitionImages(pages, outputDir);
  const tools = {
    read_saved: tool({
      description:
        "Read saved document metadata, question identities and annotations, plus selected full question records. Useful when resuming or revising recognition. Saved content is a draft to compare with source evidence.",
      inputSchema: z.object({ orders: z.array(z.number().int().positive()).max(4) }),
      execute: ({ orders }) =>
        serial(() => ({
          metadata,
          identities: [...questions.values()].map(({ order, number, section }) => ({
            order,
            number,
            section,
          })),
          questions: [...questions.values()].filter((q) => orders.includes(q.order)),
          annotations: [...annotations.values()],
        })),
    }),
    ...createInspectionTools({
      exam,
      pages,
      outputDir,
      signal,
      inspected,
      serial,
      regionErrors,
      imageOutput,
      savedRecords: () => [
        ...questions.values(),
        ...annotations.values(),
        ...(metadata?.materials ?? []),
      ],
    }),
    save_document: tool({
      description:
        "Save or revise document metadata, page classifications and shared materials. Include every page. All text fields are Markdown with LaTeX.",
      inputSchema: recognitionMetadataSchema,
      execute: (input) =>
        serial(async () => {
          const errors = [
            ...input.materials.flatMap(evidenceErrors),
            ...input.materials.flatMap((m) => markdownErrors(m.markdown, m.figures)),
          ];
          if (
            input.pages.length !== pages.length ||
            new Set(input.pages.map((p) => p.page)).size !== pages.length ||
            pages.some((p) => !input.pages.some((i) => i.page === p.page))
          )
            errors.push("Classify every uploaded page exactly once.");
          if (errors.length) return { accepted: false, errors };
          metadata = input;
          await checkpoint();
          return { accepted: true, pages: input.pages.length, materials: input.materials.length };
        }),
    }),
    save_questions: tool({
      description:
        "Save complete questions in any batch size. Reusing section + number replaces that question. order is global reading order, including section number resets. Markdown uses ![caption](figure-id) for supplied figure regions.",
      inputSchema: z.object({ questions: z.array(recognitionQuestionSchema).min(1).max(4) }),
      execute: (input) =>
        serial(async () => {
          if (options.template)
            return {
              accepted: false,
              errors: [
                "A fixed paper template is supplied; save student annotations instead of replacing questions.",
              ],
            };
          const errors = input.questions.flatMap(questionErrors);
          if (errors.length) return { accepted: false, errors };
          for (const q of input.questions) questions.set(JSON.stringify([q.section, q.number]), q);
          await checkpoint();
          return {
            accepted: true,
            saved: input.questions.map((q) => q.number),
            totalQuestions: questions.size,
          };
        }),
    }),
    revise_question: tool({
      description:
        "Correct selected fields of one saved question without rewriting its other content. Useful for fixing source regions or individual Markdown subquestions after source review. order identifies the saved question; include only fields that need correction.",
      inputSchema: recognitionQuestionSchema.partial().extend({
        order: z.number().int().positive(),
        options: recognitionQuestionSchema.shape.options.removeDefault().optional(),
        parts: recognitionQuestionSchema.shape.parts.removeDefault().optional(),
        materialRefs: recognitionQuestionSchema.shape.materialRefs.removeDefault().optional(),
        figures: recognitionQuestionSchema.shape.figures.removeDefault().optional(),
      }),
      execute: (patch) =>
        serial(async () => {
          const prior = [...questions.values()].find((q) => q.order === patch.order);
          if (!prior || options.template)
            return { accepted: false, errors: ["No editable question at this order."] };
          const next = recognitionQuestionSchema.parse({ ...prior, ...patch });
          const errors = questionErrors(next);
          if (errors.length) return { accepted: false, errors };
          const identity = JSON.stringify([next.section, next.number]),
            oldIdentity = JSON.stringify([prior.section, prior.number]);
          if (identity !== oldIdentity && questions.has(identity))
            return { accepted: false, errors: ["Duplicate question identity."] };
          questions.delete(oldIdentity);
          questions.set(identity, next);
          await checkpoint();
          return {
            accepted: true,
            order: next.order,
            number: next.number,
            changed: Object.keys(patch).filter((k) => k !== "order"),
          };
        }),
    }),
    save_annotations: tool({
      description:
        "Save student work, printed reference answers, rubrics or teacher marks separately, including unmatched/blank/unreadable evidence. Reusing id replaces an annotation. Never solve questions.",
      inputSchema: recognitionAnnotationsSchema,
      execute: (input) =>
        serial(async () => {
          const errors = input.annotations.flatMap((a) => [
            ...evidenceErrors(a),
            ...markdownErrors(a.markdown, a.figures),
          ]);
          if (errors.length) return { accepted: false, errors };
          for (const annotation of input.annotations) annotations.set(annotation.id, annotation);
          await checkpoint();
          return {
            accepted: true,
            saved: input.annotations.map((a) => a.id),
            totalAnnotations: annotations.size,
          };
        }),
    }),
    review_questions: tool({
      description:
        "Compare saved questions with original source crops and surrounding full-page context. Check wording, blanks, diagrams, every subpart and page/column continuations, including evidence outside saved crops. You choose which orders to review and how to correct them.",
      inputSchema: z.object({ orders: z.array(z.number().int().positive()).min(1).max(4) }),
      execute: ({ orders }) =>
        serial(async () => {
          const selected = [...questions.values()].filter((q) => orders.includes(q.order));
          if (selected.length !== new Set(orders).size) throw new Error("Unknown question order.");
          return { questions: selected, ...(await reviewEvidence(selected)) };
        }),
      toModelOutput: ({ output }) => imageOutput(output),
    }),
    review_annotations: tool({
      description:
        "Compare saved student/reference/teacher records with original source crops and surrounding page context. Check actual writing, crossed-out responses, question association and separation of student work from teacher corrections. Revise by reusing the annotation id in save_annotations.",
      inputSchema: z.object({ ids: z.array(z.string().min(1)).min(1).max(4) }),
      execute: ({ ids }) =>
        serial(async () => {
          const selected = [...annotations.values()].filter((a) => ids.includes(a.id));
          if (selected.length !== new Set(ids).size) throw new Error("Unknown annotation id.");
          return { annotations: selected, ...(await reviewEvidence(selected)) };
        }),
      toModelOutput: ({ output }) => imageOutput(output),
    }),
    finish: tool({
      description:
        "Submit the recognized document. Validates inspected-page coverage, question identities, regions, materials and answer separation. Correct returned errors using any tools and submit again.",
      inputSchema: z.object({ questionCount: z.number().int().nonnegative(), summary: z.string() }),
      execute: ({ questionCount, summary }) =>
        serial(async () => {
          const errors = submissionErrors({
            metadata,
            questions,
            annotations,
            inspected,
            questionCount,
            template: options.template,
          });
          if (errors.length) return { accepted: false, errors };
          const before = structuredClone(exam);
          try {
            await assembleRecognition({
              exam,
              pages,
              outputDir,
              metadata: metadata!,
              questions,
              annotations,
              template: options.template,
              extractStudentAnswers: options.extractStudentAnswers,
            });
            await checkpoint();
          } catch (error) {
            Object.assign(exam, before);
            throw error;
          }
          complete = true;
          return {
            accepted: true,
            questions: exam.questions.length,
            annotations: exam.annotations.length,
            figures: exam.assets.length,
            summary,
          };
        }),
    }),
  };

  await checkpoint();
  const usage = await model.runRecognitionAgent({
    instructions: RECOGNITION_INSTRUCTIONS,
    tools,
    signal,
    isComplete: () => complete,
    onEvent: options.onEvent,
    content: [
      {
        type: "text",
        text: JSON.stringify({
          task: options.template
            ? "Recognize all student evidence against this fixed template; do not transcribe new question stems."
            : "Recognize the uploaded documents.",
          files: exam.sourceFiles.map((f) => ({ name: f.name, mimeType: f.mimeType })),
          studentAnswers:
            options.extractStudentAnswers || !!options.template
              ? "Extract every student response separately, including blank and unreadable responses; preserve all question blanks."
              : "Separate any student work present in the source from clean question text.",
          pages: pages.map(({ page, width, height, isPhotograph }) => ({
            page,
            width,
            height,
            isPhotograph,
          })),
          ...(options.draft
            ? {
                resume: {
                  questions: questions.size,
                  annotations: annotations.size,
                  feedback:
                    options.draft.feedback ??
                    "Continue from the saved draft. Inspect source evidence, correct mistakes and submit a complete result.",
                },
              }
            : {}),
          ...(options.template
            ? {
                template: options.template.questions.map((q) => ({
                  number: q.number,
                  section: q.section,
                })),
              }
            : {}),
        }),
      },
    ],
  });
  Object.assign(exam.verification.usage, usage);
  // Validate that the assembled document also retains every non-text asset.
  if (exam.questions.some((q) => allQuestionBlocks(q).some((b) => !b)))
    throw new Error("Invalid Markdown figure reference.");
  return exam;
}
