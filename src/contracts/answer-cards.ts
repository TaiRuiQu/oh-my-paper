import { z } from "zod";
import { materialSchema, type Exam } from "./exams";
import type { GradedAnswer } from "./exam-agents";
import type { ExamTaskSummary } from "./exam-tasks";
export const CARD_TEMPLATE_QUEUE = "answer-card.template.v1";
export const CARD_BATCH_QUEUE = "answer-card.batch.v1";
export const cardRegionSchema = z.strictObject({
  questionId: z.uuid(),
  boxes: z.array(materialSchema).min(1).max(12),
});
export const cardRegionsSchema = z.array(cardRegionSchema).min(1).max(1000);
export type CardRegion = z.infer<typeof cardRegionSchema>;
export type CardTemplate = {
  id: string;
  sourceId: string;
  name: string;
  status: ExamTaskSummary["status"];
  pageCount: number;
  regions: CardRegion[];
  error: string | null;
  createdAt: string;
  creditsSpent: string;
};
export type CardStudent = {
  id: string;
  name: string;
  status: ExamTaskSummary["status"];
  completed: number;
  result: { questions: GradedAnswer[] };
  error: string | null;
};
export type CardBatch = {
  id: string;
  templateId: string;
  name: string;
  status: ExamTaskSummary["status"];
  createdAt: string;
  creditsSpent: string;
  error: string | null;
  total: number;
  completed: number;
  students: CardStudent[];
  exam?: Exam;
  sourceId?: string;
};
