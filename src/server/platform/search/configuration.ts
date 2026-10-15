import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDb } from "@/server/db/client";
import { encryptApiKey } from "@/server/ai/credentials";
import { RequestError } from "@/server/http/errors";

export const embeddingConfigurationSchema = z.object({
  name: z.string().trim().min(1).max(80),
  apiType: z.enum(["openai", "google"]),
  baseURL: z
    .url()
    .refine(
      (url) => /^https?:/.test(url) && !new URL(url).username && !new URL(url).password,
      "使用不含用户名与密码的 HTTP 或 HTTPS 地址。",
    ),
  model: z.string().trim().min(1).max(120),
  dimensions: z.number().int().min(1).max(65536),
  apiKey: z.string().min(1).max(4096).optional(),
  enabled: z.boolean().default(true),
});

export async function loadSearchConfiguration() {
  const db = getDb();
  const config = await db.embeddingSetting.findUnique({ where: { id: "question-bank" } });
  const total = await db.question.count();
  const version = config?.version ?? "";
  const [indexedRows, pending, failed, latestFailure] = await Promise.all([
    db.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) FROM "question_search_indexes" i
      JOIN "questions" q ON q.id = i."questionId"
      WHERE i.version = ${version} AND i.status = 'INDEXED'`,
    db.questionSearchIndex.count({ where: { version, status: { in: ["PENDING", "PROCESSING"] } } }),
    db.questionSearchIndex.count({ where: { version, status: "FAILED" } }),
    db.questionSearchIndex.findFirst({
      where: { version, status: "FAILED" },
      orderBy: { updatedAt: "desc" },
      select: { error: true },
    }),
  ]);
  return {
    embedding: config
      ? {
          name: config.name,
          apiType: config.apiType,
          baseURL: config.baseURL,
          model: config.model,
          dimensions: config.dimensions,
          enabled: config.enabled,
          version: config.version,
          hasApiKey: Boolean(config.encryptedApiKey),
        }
      : null,
    searchIndex: {
      total,
      indexed: Number(indexedRows[0].count),
      pending,
      failed,
      enabled: Boolean(config?.enabled),
      ...(latestFailure?.error ? { lastError: latestFailure.error } : {}),
    },
  };
}

export async function saveEmbeddingConfiguration(
  data: z.infer<typeof embeddingConfigurationSchema>,
) {
  return getDb().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(7240132027::bigint)::text`;
    const existing = await tx.embeddingSetting.findUnique({ where: { id: "question-bank" } });
    if (!existing && !data.apiKey) throw new RequestError(400, "首次配置向量化模型需要 API 密钥。");
    const { apiKey, ...values } = data;
    const encryptedApiKey = apiKey ? encryptApiKey(apiKey) : existing!.encryptedApiKey;
    const changed =
      !existing ||
      ["apiType", "baseURL", "model", "dimensions"].some(
        (key) => existing[key as keyof typeof existing] !== values[key as keyof typeof values],
      );
    await tx.embeddingSetting.upsert({
      where: { id: "question-bank" },
      create: { id: "question-bank", ...values, encryptedApiKey },
      update: {
        ...values,
        encryptedApiKey,
        ...(changed ? { version: randomUUID() } : {}),
      },
    });
    return { id: "question-bank" };
  });
}

export async function reindexQuestions() {
  return getDb().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(7240132027::bigint)::text`;
    const config = await tx.embeddingSetting.findUnique({ where: { id: "question-bank" } });
    if (!config?.enabled) throw new RequestError(409, "请先保存并启用向量化模型。");
    // SQL queues existing questions without invoking a paid provider in this request.
    const queued = await tx.$executeRaw`
      INSERT INTO "question_search_indexes"
        ("questionId", version, revision, action, status, attempts, "updatedAt")
      SELECT id, ${config.version}, gen_random_uuid()::text, 'UPSERT', 'PENDING', 0, CURRENT_TIMESTAMP
      FROM "questions"
      ON CONFLICT ("questionId") DO UPDATE SET version = EXCLUDED.version,
        revision = EXCLUDED.revision, action = 'UPSERT', status = 'PENDING', attempts = 0,
        error = NULL, "updatedAt" = CURRENT_TIMESTAMP`;
    return { id: "question-bank", queued };
  });
}
