import "server-only";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import { providerSchema, type ProviderConfig } from "@/contracts/ai-providers";
import { createStructuredExamModel } from "./deepseek";

export function createProviderExamModel(config: ProviderConfig, apiKey: string, fetch?: typeof globalThis.fetch) {
  const settings = providerSchema.parse(config);
  const common = { apiKey, baseURL: settings.baseURL, ...(fetch ? { fetch } : {}) };
  // Never forward a credential to a redirect target, including cross-origin proxies.
  const transport: typeof globalThis.fetch = (input, init) => (fetch ?? globalThis.fetch)(input, { ...init, redirect: "error" });
  common.fetch = transport;
  const model = settings.apiType === "openai_responses" ? createOpenAI(common).responses(settings.model)
    : settings.apiType === "openai_chat" ? createOpenAICompatible({ ...common, name: "exam", supportsStructuredOutputs: settings.structuredOutputs })(settings.model)
    : settings.apiType === "anthropic" ? createAnthropic(common)(settings.model)
    : createGoogle(common)(settings.model);
  return createStructuredExamModel(model, settings.model, settings.timeoutSeconds * 1000, {
    maxOutputTokens: settings.maxOutputTokens,
    jsonSchemaInPrompt: settings.apiType === "openai_chat" && !settings.structuredOutputs,
    cacheSystemPrefix: settings.apiType === "anthropic",
    // Provider-specific DeepSeek reasoning flags must not leak into other APIs.
    providerOptions: settings.apiType === "openai_responses" ? { openai: { store: false, strictJsonSchema: false } } : undefined,
  });
}
