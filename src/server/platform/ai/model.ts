import "server-only";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import { defaultSettingsMiddleware, wrapLanguageModel, type LanguageModel } from "ai";
import { reasoningEffortSchema } from "@/contracts/ai-models";
import { getDb } from "@/server/db/client";
import { decryptApiKey } from "@/server/ai/credentials";
import { getActor } from "../service";
import { AccessError, RequestError } from "@/server/http/errors";
import { normalizeResponsesResponse } from "./responses";
export async function loadAiModel(userId: string, modelId?: string) {
  const actor = await getActor(userId);
  const stored = await getDb().aiModel.findFirst({
    where: {
      ...(modelId ? { id: modelId } : {}),
      ...(actor.role === "ADMIN" ? {} : { isPublic: true }),
    },
    include: { provider: true },
    orderBy: { id: "asc" },
  });
  if (!stored) throw new RequestError(409, "请先由管理员配置可用 AI 模型。");
  if (actor.role !== "ADMIN" && !stored.isPublic) throw new AccessError(403, "该模型未公开。");
  const p = stored.provider,
    apiKey = decryptApiKey(p.encryptedApiKey),
    settings = { apiKey, baseURL: p.baseURL };
  const reasoning = reasoningEffortSchema.parse(stored.reasoningEffort);
  let model: LanguageModel;
  switch (p.apiType) {
    case "openai_chat":
      model = createOpenAI(settings).chat(stored.name);
      break;
    case "openai_responses":
      model = createOpenAI({
        ...settings,
        fetch: async (input, init) => normalizeResponsesResponse(await fetch(input, init)),
      }).responses(stored.name);
      break;
    case "anthropic":
      model = createAnthropic(settings)(stored.name);
      break;
    case "google":
      model = createGoogle(settings)(stored.name);
      break;
    default:
      throw new RequestError(400, "不支持的模型协议。");
  }
  if (reasoning !== "provider-default" && ["openai_chat", "openai_responses"].includes(p.apiType))
    model = wrapLanguageModel({
      model,
      middleware: defaultSettingsMiddleware({
        settings: { providerOptions: { openai: { forceReasoning: true } } },
      }),
    });
  return {
    model,
    baseURL: p.baseURL,
    identity: {
      modelId: stored.id,
      model: stored.name,
      providerName: p.name,
      providerId: p.id,
      apiType: p.apiType,
    },
    usePreviousResponseId: p.apiType === "openai_responses" && p.usePreviousResponseId,
    reasoning,
    maxOutputTokens: p.maxOutputTokens,
    timeoutMs: p.timeoutSeconds * 1000,
    maxConcurrency: p.maxConcurrency,
  };
}
