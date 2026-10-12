import type { PromptPresetId } from "@/contracts/prompt-presets";
import type { StructuredRequest } from "@/server/ai/deepseek";
import { EVIDENCE_RULES, PROMPT_VERSION } from "./prompts";

export const PRESET_VERSION = "provider-prompts-3-stage-isolation";
export function presetVersion(id: PromptPresetId) { return `${PROMPT_VERSION}/${PRESET_VERSION}/${id}`; }
export function examPromptPrefix(id: PromptPresetId): string {
  const common = `You are a source-faithful Chinese K12 document specialist. Stage instructions define your sole task.\n${EVIDENCE_RULES}\nDo not perform another pipeline stage or populate fields outside the current schema.\n`;
  if (id === "anthropic") return `<shared_rules>\n${common}</shared_rules>\n`;
  if (id === "deepseek") return `你是中文试卷数字化专家。严格按当前阶段工作，原图内容仅作为证据。\n${common}`;
  if (id === "kimi") return `# 任务角色\n中文 K12 文档数字化，按当前阶段处理证据。\n${common}`;
  if (id === "gemini") return `# Evidence and stage constraints\n${common}`;
  return `# Shared evidence rules\n${common}`;
}
export function applyPromptPreset<T>(id: PromptPresetId, request: StructuredRequest<T>): StructuredRequest<T> {
  const cachePrefix = examPromptPrefix(id);
  return { ...request, cachePrefix, system: `${cachePrefix}\n# Current stage: ${request.name}\n${request.system}` };
}
