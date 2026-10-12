import { z } from "zod";
import { promptPresetSchema } from "./prompt-presets";

export const API_TYPES = {
  openai_responses: "OpenAI Responses",
  openai_chat: "Chat Completions（OpenAI 兼容）",
  anthropic: "Anthropic Messages",
  google: "Google Generative AI",
} as const;

export const providerSchema = z.object({
  name: z.string().trim().min(1, "请输入提供商名称。").max(80),
  apiType: z.enum(["openai_responses", "openai_chat", "anthropic", "google"]),
  baseURL: z.url("请输入有效的 API base URL。").max(500).refine((value) => {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
  }, "URL 仅支持 HTTP/HTTPS，不能包含账号、查询参数或片段。").transform((value) => value.replace(/\/+$/, "")),
  model: z.string().trim().min(1, "请输入模型名称。").max(160).regex(/^[a-zA-Z0-9_.:/-]+$/, "模型名称包含不支持的字符。"),
  promptPreset: promptPresetSchema.default("openai"),
  structuredOutputs: z.boolean().default(false),
  maxOutputTokens: z.number().int().min(1024).max(64000).default(16000),
  timeoutSeconds: z.number().int().min(15).max(600).default(240),
});
export const providerInputSchema = providerSchema.extend({ apiKey: z.string().trim().max(4096).default("") });
export type ProviderConfig = z.infer<typeof providerSchema>;
export type ProviderInput = z.infer<typeof providerInputSchema>;
export type ProviderSummary = ProviderConfig & { id: string; hasApiKey: boolean; active: boolean; gradingActive: boolean };
export type ProviderSnapshot = ProviderConfig & { encryptedApiKey: string };
