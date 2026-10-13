import "server-only";
import { tool } from "ai";
import { z } from "zod";
import {
  parsedExamSchema,
  examQuestionCount,
  examLayoutSchema,
  resolveExamLayout,
  type ParsedExam,
} from "@/contracts/exams";
import type { QuestionProgress } from "@/contracts/exam-tasks";
import { AppError } from "@/server/errors";

export function createResultTools(
  onProgress?: (exam: ParsedExam) => Promise<void>,
  onQuestionProgress?: (progress: QuestionProgress) => Promise<void>,
) {
  const metaSchema = examLayoutSchema.extend({
    total: z
      .number()
      .int()
      .positive()
      .max(10000)
      .nullable()
      .describe(
        "Number of independent parent questions visible in uploaded pages, excluding subquestions. Use null when a reliable count is unavailable; never use the entire workbook's count or the highest printed question number.",
      ),
  });
  let meta: z.infer<typeof metaSchema> | undefined;
  let saved: ParsedExam | undefined;
  let completed = false;
  let pending = Promise.resolve();
  // The SDK may execute several tool calls from one response concurrently.
  const serialize = <T>(action: () => Promise<T>): Promise<T> => {
    const result = pending.then(action);
    pending = result.then(
      () => {},
      () => {},
    );
    return result;
  };
  const persist = async (exam: ParsedExam) => {
    const count = examQuestionCount(exam);
    if (!meta)
      throw new AppError(
        "Report paper size, columns and the visible question count first with report_exam_meta.",
        "EXAM_META_REQUIRED",
        422,
      );
    if (meta.total !== null && count > meta.total)
      throw new AppError(
        "Saved questions exceed the reported total. Correct report_exam_meta first.",
        "EXAM_COUNT_INVALID",
        422,
      );
    await onProgress?.(structuredClone(exam));
    await onQuestionProgress?.({ total: meta.total, completed: count });
    saved = exam;
    return {
      sections: exam.sections.length,
      questions: examQuestionCount(exam),
      recorded: exam.sections.map((section) => ({
        section: section.number,
        questions: section.questions.map((question) => question.number),
      })),
    };
  };
  return {
    isComplete: () => completed,
    result: () => (saved ? structuredClone(saved) : undefined),
    tools: {
      report_exam_meta: tool({
        description:
          "In your first response, report the uploaded document's A3/A4 paper size, 1–4 text columns, orientation and count of visible independent parent questions. Workbook excerpts are valid; use total=null if the count is not yet reliable. Paper size cannot be proved from photo aspect ratio alone: estimate from the source layout, default A4 when uncertain. Call again to correct metadata. Count parent questions, not subquestions, sections or the highest printed number.",
        inputSchema: metaSchema,
        execute: (input) =>
          serialize(async () => {
            if (completed)
              throw new AppError("The paper is already submitted.", "EXAM_ALREADY_SUBMITTED", 422);
            const parsed = metaSchema.parse(input);
            const done = saved ? examQuestionCount(saved) : 0;
            if (parsed.total !== null && parsed.total < done)
              throw new AppError(
                "The total cannot be smaller than saved questions.",
                "EXAM_COUNT_INVALID",
                422,
              );
            const { total, ...layout } = parsed;
            const next = saved ? { ...saved, layout: resolveExamLayout(layout) } : undefined;
            if (next) await onProgress?.(structuredClone(next));
            await onQuestionProgress?.({ total, completed: done });
            meta = parsed;
            saved = next;
            return {
              ...parsed,
              orientation: resolveExamLayout(layout).orientation,
              completed: done,
            };
          }),
      }),
      append_questions: tool({
        description:
          "Save completed questions promptly. Batch independent save calls with reading or zooming the next question; do not wait for a whole section. Supply name, totalScore and only this batch's sections/questions, with full stems, all parts, materials and scores. Sections merge by their original number; questions merge by number within the section. Resending updates a question without duplication. Empty instructions and null scores keep previous values. Earlier questions remain saved.",
        inputSchema: parsedExamSchema,
        execute: async (input) =>
          serialize(async () => {
            if (completed)
              throw new AppError("The paper is already submitted.", "EXAM_ALREADY_SUBMITTED", 422);
            const batch = parsedExamSchema.parse(input);
            const merged: ParsedExam = saved ? structuredClone(saved) : { ...batch, sections: [] };
            if (meta) merged.layout = resolveExamLayout(meta);
            merged.name = batch.name;
            merged.totalScore = batch.totalScore ?? merged.totalScore;
            for (const section of batch.sections) {
              const existing = merged.sections.find((item) => item.number === section.number);
              if (!existing) {
                merged.sections.push(section);
                continue;
              }
              existing.title = section.title;
              existing.description = section.description || existing.description;
              existing.score = section.score ?? existing.score;
              for (const question of section.questions) {
                const index = existing.questions.findIndex(
                  (item) => item.number === question.number,
                );
                if (index === -1) existing.questions.push(question);
                else existing.questions[index] = question;
              }
            }
            return persist(parsedExamSchema.parse(merged));
          }),
      }),
      submit_exam: tool({
        description:
          "Finish after inspecting every uploaded page and saving all visible questions with append_questions. Workbook excerpts do not require missing pages, a complete exam or known scores. If total is known, saved question count must match it; if total=null, submit all observed questions without inventing a total. Supply final name and explicit totalScore or null. Saved layout and questions are retained automatically. Cannot finish an empty document.",
        inputSchema: z.strictObject({
          name: parsedExamSchema.shape.name,
          totalScore: parsedExamSchema.shape.totalScore,
        }),
        execute: async (input) =>
          serialize(async () => {
            if (!saved)
              throw new AppError("Save questions with append_questions first.", "EXAM_EMPTY", 422);
            if (!meta || (meta.total !== null && examQuestionCount(saved) !== meta.total))
              throw new AppError(
                "Save all reported questions before submitting; correct the total if the count was wrong.",
                "EXAM_MISSING_QUESTIONS",
                422,
              );
            const result = await persist(parsedExamSchema.parse({ ...saved, ...input }));
            completed = true;
            return result;
          }),
      }),
    },
  };
}
