import { DEFAULT_AI_CONCURRENCY, type ProviderInput } from "@/contracts/ai-providers";

export const emptyProviderForm: ProviderInput = {
  name: "",
  apiType: "openai_responses",
  baseURL: "",
  apiKey: "",
  model: "",
  promptPreset: "openai",
  structuredOutputs: false,
  maxConcurrency: DEFAULT_AI_CONCURRENCY,
  maxOutputTokens: 16000,
  timeoutSeconds: 240,
};
export const providerBaseURLs = {
  openai_responses: "https://api.openai.com/v1",
  openai_chat: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta",
};
