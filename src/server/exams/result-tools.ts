import "server-only";
import { tool } from "ai";
import { z } from "zod";
import { parsedExamSchema, examQuestionCount, type ParsedExam } from "@/contracts/exams";
import type { QuestionProgress } from "@/contracts/exam-tasks";
import { AppError } from "@/server/errors";

export function createResultTools(
  onProgress?: (exam: ParsedExam) => Promise<void>,
  onQuestionProgress?: (progress: QuestionProgress) => Promise<void>,
) {
  let total: number | null = null;
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
    if (total === null)
      throw new AppError(
        "Report the total question count first with report_question_count.",
        "EXAM_COUNT_REQUIRED",
        422,
      );
    if (count > total)
      throw new AppError(
        "Saved questions exceed the reported total. Correct report_question_count first.",
        "EXAM_COUNT_INVALID",
        422,
      );
    await onProgress?.(structuredClone(exam));
    await onQuestionProgress?.({ total, completed: count });
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
      report_question_count: tool({
        description:
          "Before saving any questions, inspect the whole paper and report its total independent numbered questions. Count each parent question once, not its subquestions or sections. Call again only to correct the total.",
        inputSchema: z.strictObject({ total: z.number().int().positive().max(10000) }),
        execute: ({ total: count }) =>
          serialize(async () => {
            if (completed)
              throw new AppError("The paper is already submitted.", "EXAM_ALREADY_SUBMITTED", 422);
            const parsed = z.number().int().positive().max(10000).parse(count);
            const done = saved ? examQuestionCount(saved) : 0;
            if (parsed < done)
              throw new AppError(
                "The total cannot be smaller than saved questions.",
                "EXAM_COUNT_INVALID",
                422,
              );
            await onQuestionProgress?.({ total: parsed, completed: done });
            total = parsed;
            return { total, completed: done };
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
          "Finish recognition only after every page and question has been read and saved with append_questions. Supply the final name and totalScore; all previously saved sections/questions are kept automatically. Do not resend the entire exam. Cannot finish an empty exam.",
        inputSchema: z.strictObject({
          name: parsedExamSchema.shape.name,
          totalScore: parsedExamSchema.shape.totalScore,
        }),
        execute: async (input) =>
          serialize(async () => {
            if (!saved)
              throw new AppError("Save questions with append_questions first.", "EXAM_EMPTY", 422);
            if (total === null || examQuestionCount(saved) !== total)
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
