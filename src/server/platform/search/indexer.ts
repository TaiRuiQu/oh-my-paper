import "server-only";
import { getDb } from "@/server/db/client";
import type { EmbeddingSetting, QuestionSearchIndex } from "@/generated/prisma/client";
import { createEmbedding, questionSearchText } from "./embedding";
import { deletePoint, ensureCollection, upsertPoint } from "./qdrant";

export async function runQuestionIndexOnce() {
  const db = getDb();
  const config = await db.embeddingSetting.findUnique({ where: { id: "question-bank" } });
  if (!config?.enabled) return false;
  // Expired leases are failed explicitly, rather than automatically repeating paid requests.
  await db.questionSearchIndex.updateMany({
    where: {
      status: "PROCESSING",
      updatedAt: { lt: new Date(Date.now() - 5 * 60000) },
    },
    data: { status: "FAILED", error: "索引进程中断，请重新安排索引。" },
  });
  const job = await db.$transaction(async (tx) => {
    const jobs = await tx.$queryRaw<QuestionSearchIndex[]>`
      SELECT * FROM "question_search_indexes"
      WHERE "status" = 'PENDING' AND "version" = ${config.version}
      ORDER BY "updatedAt", "questionId" FOR UPDATE SKIP LOCKED LIMIT 1`;
    if (!jobs[0]) return null;
    return tx.questionSearchIndex.update({
      where: { questionId: jobs[0].questionId },
      data: { status: "PROCESSING", attempts: { increment: 1 } },
    });
  });
  if (!job) return false;
  await processIndexJob(config, job);
  return true;
}

async function processIndexJob(config: EmbeddingSetting, job: QuestionSearchIndex) {
  const db = getDb();
  const where = { questionId: job.questionId, revision: job.revision, status: "PROCESSING" };
  try {
    const question = await db.question.findUnique({ where: { id: job.questionId } });
    if (job.action === "DELETE" || !question) {
      if (job.indexedRevision)
        await deletePoint(config.version, `${job.questionId}:${job.indexedRevision}`);
      await db.questionSearchIndex.updateMany({ where, data: { status: "DELETED", error: null } });
      return;
    }
    await ensureCollection(config.version, config.dimensions);
    const vector = await createEmbedding(config, questionSearchText(question));
    // Revision-specific points prevent a slow, superseded worker overwriting a newer vector.
    const pointKey = `${job.questionId}:${job.revision}`;
    await upsertPoint(config.version, pointKey, vector);
    const saved = await db.questionSearchIndex.updateMany({
      where,
      data: { status: "INDEXED", indexedRevision: job.revision, error: null },
    });
    if (!saved.count) await deletePoint(config.version, pointKey);
    else if (job.indexedRevision && job.indexedRevision !== job.revision)
      await deletePoint(config.version, `${job.questionId}:${job.indexedRevision}`);
  } catch (error) {
    // Only our safe application errors are stored; never persist raw provider bodies or keys.
    const message =
      error instanceof Error && error.name === "RequestError"
        ? error.message
        : "索引更新失败，请检查向量模型及 Qdrant 配置后重建索引。";
    await db.questionSearchIndex.updateMany({ where, data: { status: "FAILED", error: message } });
  }
}
