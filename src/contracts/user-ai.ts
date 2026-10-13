import { z } from "zod";
import {
  aiPurposeSchema,
  reasoningEffortSchema,
  type ReasoningEffort,
  type AiPurpose,
} from "./ai-providers";

export const userModelSelectionSchema = z.strictObject({
  purpose: aiPurposeSchema,
  modelId: z.uuid().nullable(),
  reasoningEffort: reasoningEffortSchema.nullable().optional(),
});
export const taskModelSelectionSchema = z.strictObject({
  exam: z.uuid().optional(),
  answer: z.uuid().optional(),
  grading: z.uuid().optional(),
  reasoningEfforts: z
    .strictObject({
      exam: reasoningEffortSchema.optional(),
      answer: reasoningEffortSchema.optional(),
      grading: reasoningEffortSchema.optional(),
    })
    .optional(),
});
export type TaskModelSelection = z.infer<typeof taskModelSelectionSchema>;
export const answerTaskModelSchema = z.strictObject({
  modelId: z.uuid().optional(),
  reasoningEffort: reasoningEffortSchema.optional(),
});
export const modelChoiceHint =
  "低倍率模型通常更快、费用更低，但准确率可能下降；高倍率模型通常更准确，但处理较慢、费用更高。";
export type UserAiSettings = {
  credits: string;
  unlimited?: boolean;
  models: {
    id: string;
    name: string;
    creditMultiplier: number;
    reasoningEfforts?: ReasoningEffort[];
  }[];
  selections: Record<AiPurpose, string | null>;
  defaults: Record<AiPurpose, string | null>;
  reasoningSelections?: Record<AiPurpose, ReasoningEffort | null>;
  defaultReasoningEfforts?: Record<AiPurpose, ReasoningEffort>;
  adminDefaults?: Record<
    AiPurpose,
    { name: string; creditMultiplier: number; reasoningEfforts?: ReasoningEffort[] } | null
  >;
};
