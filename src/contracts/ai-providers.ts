import { z } from "zod";
import { promptPresetSchema } from "./prompt-presets";

export const API_TYPES = {
  openai_responses: "OpenAI Responses",
  openai_chat: "Chat Completions（OpenAI 兼容）",
  anthropic: "Anthropic Messages",
  google: "Google Generative AI",
} as const;

export const DEFAULT_AI_CONCURRENCY = 3;
export const MAX_AI_CONCURRENCY = 32;
export const aiConcurrencySchema = z
  .number()
  .int("并发数必须是整数。")
  .min(1, "并发数不能小于 1。")
  .max(MAX_AI_CONCURRENCY, `并发数不能超过 ${MAX_AI_CONCURRENCY}。`);

export const providerSchema = z.object({
  name: z.string().trim().min(1, "请输入提供商名称。").max(80),
  apiType: z.enum(["openai_responses", "openai_chat", "anthropic", "google"]),
  baseURL: z
    .url("请输入有效的 API base URL。")
    .max(500)
    .refine((value) => {
      const url = new URL(value);
      return (
        ["https:", "http:"].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      );
    }, "URL 仅支持 HTTP/HTTPS，不能包含账号、查询参数或片段。")
    .transform((value) => value.replace(/\/+$/, "")),
  model: z
    .string()
    .trim()
    .min(1, "请输入模型名称。")
    .max(160)
    .regex(/^[a-zA-Z0-9_.:/-]+$/, "模型名称包含不支持的字符。"),
  promptPreset: promptPresetSchema.default("openai"),
  structuredOutputs: z.boolean().default(false),
  maxOutputTokens: z.number().int().min(1024).max(64000).default(16000),
  maxConcurrency: aiConcurrencySchema.default(DEFAULT_AI_CONCURRENCY),
  timeoutSeconds: z.number().int().min(15).max(600).default(240),
});
export const providerInputSchema = providerSchema.extend({
  apiKey: z.string().trim().max(4096).default(""),
});
export type ProviderConfig = z.infer<typeof providerSchema>;
export type ProviderInput = z.infer<typeof providerInputSchema>;
export type ProviderSummary = ProviderConfig & {
  id: string;
  hasApiKey: boolean;
  active: boolean;
  gradingActive: boolean;
  stages?: AiStage[];
};
export const providerSnapshotSchema = providerSchema.extend({
  encryptedApiKey: z.string().min(1),
  providerId: z.uuid().optional(),
});
export type ProviderSnapshot = z.infer<typeof providerSnapshotSchema>;

export const AI_STAGES = {
  inventory: "题目识别",
  localization: "精细定位",
  transcription: "题目文本化",
  solution: "标准答案",
  answer_extraction: "作答解析",
  grading: "逐题批改",
} as const;
export const aiStageSchema = z.enum(["inventory", "localization", "transcription", "solution", "answer_extraction", "grading"]);
export type AiStage = z.infer<typeof aiStageSchema>;
export const pipelineSnapshotSchema = providerSnapshotSchema.extend({
  stages: z.partialRecord(aiStageSchema, providerSnapshotSchema).default({}),
  workflow: z.object({
    generateAnswers: z.boolean().default(true),
    template: z.object({ taskId: z.uuid(), outputKey: z.uuid() }).optional(),
    solveOnly: z.boolean().default(false), sourceOutputKey: z.uuid().optional(),
  }).default({ generateAnswers: true, solveOnly: false }),
});
export type PipelineSnapshot = z.infer<typeof pipelineSnapshotSchema>;
