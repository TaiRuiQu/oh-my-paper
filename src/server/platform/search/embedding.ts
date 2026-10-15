import "server-only";
import { embed } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogle } from "@ai-sdk/google";
import type { EmbeddingSetting } from "@/generated/prisma/client";
import { decryptApiKey } from "@/server/ai/credentials";
import { RequestError } from "@/server/http/errors";

export function questionSearchText(question: {
  subject: string;
  grade: string;
  knowledgeTags: string[];
  content: unknown;
}) {
  const text: string[] = [question.subject, question.grade, ...question.knowledgeTags];
  const visit = (value: unknown, key = "") => {
    if (["images", "sourcePage", "id"].includes(key)) return;
    if (typeof value === "string") text.push(value);
    else if (Array.isArray(value)) value.forEach((item) => visit(item, key));
    else if (value && typeof value === "object")
      Object.entries(value).forEach(([name, item]) => visit(item, name));
  };
  visit(question.content);
  return text.filter(Boolean).join("\n").slice(0, 24000);
}

export async function createEmbedding(config: EmbeddingSetting, text: string) {
  try {
    const settings = { baseURL: config.baseURL, apiKey: decryptApiKey(config.encryptedApiKey) };
    const model =
      config.apiType === "google"
        ? createGoogle(settings).embedding(config.model)
        : createOpenAI(settings).embedding(config.model);
    const result = await embed({
      model,
      value: text,
      dimensions: config.dimensions,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(60000),
    });
    if (
      result.embedding.length !== config.dimensions ||
      !result.embedding.every(Number.isFinite) ||
      !result.embedding.some((value) => value !== 0)
    )
      throw new RequestError(409, "模型返回的向量维度或数值无效，请检查配置后重建索引。");
    return result.embedding;
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError(503, "向量化模型调用失败，请检查模型、密钥、维度及接口配置后重试。");
  }
}
