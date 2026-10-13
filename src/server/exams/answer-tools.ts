import "server-only";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { Exam } from "@/contracts/exams";
import {
  answerBatchSchema,
  gradingBatchSchema,
  type AgentResult,
  type ExamAgentKind,
  type GeneratedAnswer,
  type GradedAnswer,
} from "@/contracts/exam-agents";
import { AppError } from "@/server/errors";

// SDK tools can execute concurrently. Serialize validation, persistence and commit.
export function createAnswerResultTools(options: {
  exam: Exam;
  kind: ExamAgentKind;
  initial?: AgentResult;
  onProgress: (result: AgentResult) => Promise<void>;
}) {
  const questions = options.exam.sections.flatMap((section) => section.questions);
  let saved = structuredClone(options.initial ?? { questions: [] });
  let complete = false,
    pending = Promise.resolve();
  const serialize = <T>(fn: () => Promise<T>) => {
    const next = pending.then(fn);
    pending = next.then(
      () => {},
      () => {},
    );
    return next;
  };
  const append = (batch: (GeneratedAnswer | GradedAnswer)[]) =>
    serialize(async () => {
      if (complete)
        throw new AppError("The task is already submitted.", "AGENT_ALREADY_COMPLETE", 422);
      if (new Set(batch.map((item) => item.questionId)).size !== batch.length)
        throw new AppError("Duplicate question IDs in the same call.", "ANSWER_DUPLICATE", 422);
      if (!batch.length || (options.kind === "ANSWER" ? batch.length > 50 : batch.length !== 1))
        throw new AppError(
          options.kind === "ANSWER"
            ? "Save 1–50 completed answers per call."
            : "Save exactly one graded question per call.",
          options.kind === "ANSWER" ? "ANSWER_BATCH_INVALID" : "ANSWER_SINGLE_QUESTION",
          422,
        );
      const merged = new Map(saved.questions.map((item) => [item.questionId, item]));
      for (const item of batch) {
        const question = questions.find((question) => question.id === item.questionId);
        if (!question)
          throw new AppError(
            "The question does not belong to this paper.",
            "ANSWER_QUESTION_INVALID",
            422,
          );
        if ("score" in item) {
          const max = questionMaximum(question);
          if (item.score !== null && (max === null || item.score > max))
            throw new AppError(
              "Score must not exceed the stated maximum; use null when the maximum is unknown.",
              "GRADE_SCORE_INVALID",
              422,
            );
          if (item.correct === null && item.score !== null)
            throw new AppError(
              "Uncertain work requires a null score and an explanation.",
              "GRADE_UNCERTAIN",
              422,
            );
        }
        merged.set(item.questionId, structuredClone(item));
      }
      const next = {
        questions: questions.flatMap((question) =>
          merged.has(question.id) ? [merged.get(question.id)!] : [],
        ),
      };
      await options.onProgress(structuredClone(next));
      saved = next;
      return {
        questions: saved.questions.length,
        remaining: questions.filter((q) => !merged.has(q.id)).map((q) => q.id),
      };
    });
  const finish = tool({
    description:
      "Finish only after saving every question, including every subquestion. Missing questions are rejected; saved work is retained.",
    inputSchema: z.strictObject({}),
    execute: () =>
      serialize(async () => {
        const missing = questions.filter(
          (q) => !saved.questions.some((item) => item.questionId === q.id),
        );
        if (missing.length || !questions.length)
          throw new AppError(
            `Missing ${missing.length} questions: ${missing.map((q) => q.id).join(", ")}`,
            "AGENT_MISSING_QUESTIONS",
            422,
          );
        await options.onProgress(structuredClone(saved));
        complete = true;
        return { questions: saved.questions.length, complete: true };
      }),
  });
  const tools: ToolSet =
    options.kind === "ANSWER"
      ? {
          append_answers: tool({
            description:
              "Save 1–50 completed answers promptly in one call. Each answer includes its questionId, solution and grading criteria for all subquestions. Batch independent ready questions instead of making one call per question. Resend IDs to correct earlier answers; never wait for the whole document.",
            inputSchema: answerBatchSchema,
            execute: ({ questions }) => append(questions),
          }),
          submit_answers: finish,
        }
      : {
          append_grades: tool({
            description:
              "Save exactly one graded question promptly; several append calls may run alongside inspecting the next question: student transcription, correctness, score and feedback for all subquestions. Resend its ID to correct it.",
            inputSchema: gradingBatchSchema,
            execute: ({ questions }) => append(questions),
          }),
          submit_grading: finish,
        };
  return {
    tools,
    isComplete: () => complete,
    result: () => structuredClone(saved),
  };
}
export function questionMaximum(question: Exam["sections"][number]["questions"][number]) {
  if (question.score !== null) return question.score;
  return question.subquestions.length && question.subquestions.every((part) => part.score !== null)
    ? question.subquestions.reduce((sum, part) => sum + part.score!, 0)
    : null;
}
