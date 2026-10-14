import type { QuestionProgress } from "./exam-tasks";
import { z } from "zod";
import { scoreSchema } from "./exams";

export const EXAM_AGENT_QUEUE = "exam.agent.v1";
export const agentKindSchema = z.enum(["ANSWER", "GRADING"]);
export type ExamAgentKind = z.infer<typeof agentKindSchema>;
export const generatedAnswerSchema = z.strictObject({
  questionId: z.uuid(),
  solution: z.string().trim().min(1).max(60_000),
  gradingCriteria: z
    .string()
    .trim()
    .max(30_000)
    .optional()
    .describe("Only for subjective questions or subjective parts; omit for objective questions."),
});
export const gradedAnswerSchema = z.strictObject({
  questionId: z.uuid(),
  answer: z.string().max(60_000),
  correct: z.boolean().nullable().describe("Use null when unreadable or uncertain; never guess."),
  score: scoreSchema,
  feedback: z.string().trim().min(1).max(30_000),
});
export const answerBatchSchema = z.strictObject({
  questions: z
    .array(generatedAnswerSchema)
    .min(1)
    .max(50)
    .describe(
      "Save 1–50 completed answers per call. Batch independent ready questions, include every subquestion, and persist promptly without waiting for the whole document.",
    ),
});
export const gradingBatchSchema = z.strictObject({
  questions: z
    .array(gradedAnswerSchema)
    .min(1)
    .max(1)
    .describe(
      "Exactly one question per call. Save promptly; multiple independent calls can share a response.",
    ),
});
export type GeneratedAnswer = z.infer<typeof generatedAnswerSchema>;
export type GradedAnswer = z.infer<typeof gradedAnswerSchema>;
export type AgentResult = { questions: (GeneratedAnswer | GradedAnswer)[] };
export type ExamAgentTask = {
  id: string;
  examRevision?: number;
  kind: ExamAgentKind;
  answerSource?: "UPLOAD" | "GENERATED";
  name: string;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
  error: string | null;
  errorCode?: string | null;
  createdAt: string;
  creditsSpent?: string;
  result: AgentResult;
  progress?: QuestionProgress;
  submissionId: string | null;
};
export type ExamAgentsDetail = {
  tasks: ExamAgentTask[];
  upload?: { status: "QUEUED" | "RUNNING" | "FAILED"; createdAt: string } | null;
};
