import "server-only";
import { pipelineSnapshotSchema, type AiStage } from "@/contracts/ai-providers";
import type { PromptPresetId } from "@/contracts/prompt-presets";
import { createProviderExamModel } from "./providers";
import { decryptApiKey } from "./credentials";
import type { PipelineModels } from "@/server/exams/runtime";

export function modelsFromSnapshot(value: unknown) {
  const snapshot = pipelineSnapshotSchema.parse(value);
  const model = createProviderExamModel(snapshot, decryptApiKey(snapshot.encryptedApiKey));
  const models: PipelineModels = {};
  const stagePresets: Partial<Record<AiStage, PromptPresetId>> = {};
  for (const stage of Object.keys(snapshot.stages) as AiStage[]) {
    const provider = snapshot.stages[stage]!;
    models[stage] = createProviderExamModel(provider, decryptApiKey(provider.encryptedApiKey));
    stagePresets[stage] = provider.promptPreset;
  }
  return { snapshot, model, models, stagePresets };
}
