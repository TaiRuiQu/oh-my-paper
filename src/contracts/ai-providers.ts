import { z } from "zod";
export const AI_PURPOSES = {
  exam: "AI 解析",
  grading: "AI 批改",
  answer: "AI 生成答案",
} as const;
export type AiPurpose = keyof typeof AI_PURPOSES;
export const aiPurposeSchema = z.enum(["exam", "grading", "answer"]);
export const API_TYPES = {
  openai_responses: "OpenAI Responses",
  openai_chat: "Chat Completions（OpenAI 兼容）",
  anthropic: "Anthropic Messages",
  google: "Google Generative AI",
} as const;
export const REASONING_EFFORTS = [
  "default",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export const reasoningEffortSchema = z.enum(REASONING_EFFORTS);
export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>;
export const aiConcurrencySchema = z.number().int().min(1).max(32);
export const creditMultiplierSchema = z.number().min(0.0001).max(1000).multipleOf(0.0001);
const modelSchema = z.strictObject({
  displayName: z.string().trim().max(80, "显示名称不能超过 80 个字符。").optional(),
  isPublic: z.boolean().optional(),
  creditMultiplier: creditMultiplierSchema.optional(),
  id: z.uuid().optional(),
  name: z
    .string()
    .trim()
    .min(1, "请输入模型名称。")
    .max(160)
    .regex(/^[a-zA-Z0-9_.:/-]+$/),
  reasoningEfforts: z
    .array(reasoningEffortSchema)
    .min(1, "请至少选择一个推理选项。")
    .refine((items) => new Set(items).size === items.length, "推理选项不能重复。"),
});
export const providerSchema = z
  .strictObject({
    name: z.string().trim().min(1, "请输入提供商名称。").max(80),
    apiType: z.enum(["openai_responses", "openai_chat", "anthropic", "google"]),
    baseURL: z
      .url()
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
    structuredOutputs: z.boolean().default(true),
    maxOutputTokens: z.number().int().min(1024).max(64000).default(16000),
    timeoutSeconds: z.number().int().min(15).max(1800).default(240),
    maxConcurrency: aiConcurrencySchema.default(3),
    models: z.array(modelSchema).min(1, "请添加至少一个模型。").max(50),
  })
  .superRefine((value, ctx) => {
    if (new Set(value.models.map((model) => model.name)).size !== value.models.length)
      ctx.addIssue({ code: "custom", path: ["models"], message: "模型名称不能重复。" });
    const ids = value.models.flatMap((model) => (model.id ? [model.id] : []));
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: "custom", path: ["models"], message: "模型 ID 不能重复。" });
    value.models.forEach((model, index) => {
      const invalid = model.reasoningEfforts.some((effort) =>
        value.apiType === "google"
          ? ["xhigh", "max"].includes(effort)
          : value.apiType === "anthropic" && effort === "minimal",
      );
      if (invalid)
        ctx.addIssue({
          code: "custom",
          path: ["models", index, "reasoningEfforts"],
          message: "该接口不支持所选推理选项。",
        });
    });
  });
export const providerInputSchema = providerSchema.safeExtend({
  apiKey: z.string().trim().max(4096).default(""),
});
export const activateModelSchema = z.strictObject({
  purpose: aiPurposeSchema.default("exam"),
  modelId: z.uuid(),
  reasoningEffort: reasoningEffortSchema,
});
export const providerSnapshotSchema = z.strictObject({
  providerId: z.uuid(),
  name: z.string(),
  apiType: z.enum(["openai_responses", "openai_chat", "anthropic", "google"]),
  baseURL: z.url(),
  encryptedApiKey: z.string().min(1),
  structuredOutputs: z.boolean(),
  maxOutputTokens: z.number().int().positive(),
  timeoutSeconds: z.number().int().positive(),
  maxConcurrency: aiConcurrencySchema,
  displayName: z.string().max(80).optional(),
  modelId: z.uuid().optional(),
  creditMultiplier: creditMultiplierSchema.optional(),
  model: z.string().min(1),
  reasoningEffort: reasoningEffortSchema,
});
export type ProviderConfig = z.infer<typeof providerSchema>;
export type ProviderInput = z.infer<typeof providerInputSchema>;
export type ProviderSnapshot = z.infer<typeof providerSnapshotSchema>;
export type ProviderSummary = Omit<ProviderConfig, "models"> & {
  id: string;
  models: (ProviderConfig["models"][number] & { id: string })[];
  selections: Record<AiPurpose, { modelId: string; reasoningEffort: ReasoningEffort } | null>;
};
