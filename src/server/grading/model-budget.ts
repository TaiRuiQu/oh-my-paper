import "server-only";
import type { GradeResult } from "@/contracts/grading";
import type { PromptPresetId } from "@/contracts/prompt-presets";
import { ExamModelCallError, type ExamModel, type StructuredRequest } from "@/server/ai/deepseek";
import { gradingRequest } from "./prompts";

export class GradingBudgetError extends Error {}

export function createGradingModel({
  model,
  promptPreset,
  maxCalls,
  usage: totalUsage,
  signal,
}: {
  model: ExamModel;
  promptPreset: PromptPresetId;
  maxCalls: number;
  usage: GradeResult["usage"];
  signal?: AbortSignal;
}) {
  // Reserve the entire bounded agent allowance before any concurrent model call.
  let reserved = 0;
  const generate = async <T>(request: StructuredRequest<T>) => {
    const allowance = Math.min(request.maxSteps ?? 2, maxCalls - totalUsage.calls - reserved);
    if (allowance < 1) throw new GradingBudgetError();
    signal?.throwIfAborted();
    totalUsage.calls++;
    reserved += allowance - 1;
    const add = (usage: {
      calls?: number;
      inputTokens: number;
      outputTokens: number;
      cachedInputTokens?: number;
      cacheWriteTokens?: number;
    }) => {
      totalUsage.calls += (usage.calls ?? 1) - 1;
      totalUsage.inputTokens += usage.inputTokens;
      totalUsage.outputTokens += usage.outputTokens;
      totalUsage.cachedInputTokens += usage.cachedInputTokens ?? 0;
      totalUsage.cacheWriteTokens += usage.cacheWriteTokens ?? 0;
    };
    try {
      const response = await model.generate({
        ...gradingRequest(promptPreset, request),
        signal,
        maxCalls: allowance,
        agent: true,
      });
      add(response);
      return request.schema.parse(response.output);
    } catch (error) {
      if (error instanceof ExamModelCallError) add(error.usage);
      throw error;
    } finally {
      reserved -= allowance - 1;
    }
  };
  return generate;
}
