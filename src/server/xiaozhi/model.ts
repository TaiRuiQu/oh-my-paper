import "server-only";
import {
  createModels,
  createProvider,
  type Api,
  type Model,
  type ModelThinkingLevel,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
import { getDb } from "@/server/db/client";
import { decryptApiKey } from "@/server/ai/credentials";
import { getActor } from "@/server/platform/access";
import { RequestError } from "@/server/http/errors";

export async function loadXiaozhiModel(userId: string, modelId: string) {
  const actor = await getActor(userId);
  const stored = await getDb().aiModel.findFirst({
    where: { id: modelId, ...(actor.role === "ADMIN" ? {} : { isPublic: true }) },
    include: { provider: true },
  });
  if (!stored) throw new RequestError(409, "模型不可用，请重新选择已启用的模型。");
  const provider = stored.provider;
  const apis = {
    openai_chat: ["openai-completions", openAICompletionsApi],
    openai_responses: ["openai-responses", openAIResponsesApi],
    anthropic: ["anthropic-messages", anthropicMessagesApi],
    google: ["google-generative-ai", googleGenerativeAIApi],
  } as const;
  const api = apis[provider.apiType as keyof typeof apis];
  if (!api) throw new RequestError(400, "此模型协议尚未接入小纸。");
  const contextWindow = Number(process.env.XIAOZHI_CONTEXT_WINDOW ?? 65536);
  if (!Number.isInteger(contextWindow) || contextWindow < 16384)
    throw new Error("XIAOZHI_CONTEXT_WINDOW must be at least 16384");
  const model: Model<Api> = {
    id: stored.name,
    name: stored.displayName || stored.name,
    provider: provider.id,
    api: api[0],
    baseUrl: provider.baseURL,
    reasoning: stored.reasoningEffort !== "none",
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow,
    maxTokens: Math.min(provider.maxOutputTokens, Math.floor(contextWindow / 4)),
  };
  const models = createModels();
  models.setProvider(
    createProvider({
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseURL,
      auth: {
        apiKey: {
          name: provider.name,
          resolve: async () => ({ auth: { apiKey: decryptApiKey(provider.encryptedApiKey) } }),
        },
      },
      models: [model],
      api: api[1](),
    }),
  );
  const thinkingLevel: ModelThinkingLevel | undefined =
    stored.reasoningEffort === "provider-default"
      ? undefined
      : stored.reasoningEffort === "none"
        ? "off"
        : (stored.reasoningEffort as ModelThinkingLevel);
  return {
    models,
    model: { provider: provider.id, modelId: stored.name },
    thinkingLevel,
    timeoutMs: provider.timeoutSeconds * 1000,
    maxConcurrency: provider.maxConcurrency,
  };
}
