import "server-only";
import type { AiStage } from "@/contracts/ai-providers";
import type { DigitalExam } from "@/contracts/exams";
import { ExamModelCallError, type ExamModel, type StructuredRequest } from "@/server/ai/deepseek";
import type { PromptPresetId } from "@/contracts/prompt-presets";
import { applyPromptPreset } from "./prompt-presets";

export type PipelineModels = Partial<Record<AiStage, ExamModel>>;
export type Generate = <T>(stage: AiStage, request: StructuredRequest<T>) => Promise<T>;
export class PipelineValidationError extends Error {
  readonly name = "PipelineValidationError";
}
export function pipelineRuntime(
  exam: DigitalExam,
  model: ExamModel,
  models: PipelineModels = {},
  signal?: AbortSignal,
  presets: Partial<Record<AiStage, PromptPresetId>> = {},
  fallbackPreset?: PromptPresetId,
) {
  const pick = (stage: AiStage) => models[stage] ?? model;
  const generate: Generate = async (stage, request) => {
    signal?.throwIfAborted();
    const preset = presets[stage] ?? fallbackPreset;
    const prepared =
      preset && stage !== "solution" && stage !== "grading"
        ? applyPromptPreset(preset, request)
        : request;
    exam.verification.usage.calls++;
    try {
      const response = await pick(stage).generate({ ...prepared, signal });
      addUsage(response, response.calls ?? 1);
      return request.schema.parse(response.output);
    } catch (error) {
      if (error instanceof ExamModelCallError) addUsage(error.usage, error.usage.calls);
      throw error;
    }
  };
  function addUsage(
    value: {
      inputTokens: number;
      outputTokens: number;
      cachedInputTokens?: number;
      cacheWriteTokens?: number;
    },
    calls: number,
  ) {
    const usage = exam.verification.usage;
    usage.calls += calls - 1;
    usage.inputTokens += value.inputTokens;
    usage.outputTokens += value.outputTokens;
    usage.cachedInputTokens = (usage.cachedInputTokens ?? 0) + (value.cachedInputTokens ?? 0);
    usage.cacheWriteTokens = (usage.cacheWriteTokens ?? 0) + (value.cacheWriteTokens ?? 0);
  }
  return { generate, pick };
}

export function failureReason(error: unknown) {
  // SDK errors can contain credentials, request images and source text.
  if (!(error instanceof Error)) return "Unknown failure.";
  const cause =
    error.cause instanceof Error
      ? ` (${error.cause.name.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 80)})`
      : "";
  // Our own validation errors contain no provider/request data.
  const validation =
    error instanceof PipelineValidationError ? ` ${error.message.slice(0, 180)}` : "";
  return `Failure type: ${error.name.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 80)}${cause}.${validation}`;
}
