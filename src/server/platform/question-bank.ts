import "server-only";
import { Prisma, type Question } from "@/generated/prisma/client";
import type { PlatformState } from "@/contracts/platform";
import { teacher, type Db } from "./access";
import { RequestError } from "@/server/http/errors";
import { createEmbedding } from "./search/embedding";
import { queryPoints } from "./search/qdrant";
export async function queryQuestionBank(
  db: Db,
  actor: PlatformState["actor"],
  filters: { subject?: string; grade?: string; type?: string; q?: string; searchMode?: string },
  page = 1,
) {
  teacher(actor);
  if (!Number.isInteger(page) || page < 1 || page > 100000)
    throw new RequestError(400, "页码无效。");
  const where: Prisma.QuestionWhereInput = actor.role === "ADMIN" ? {} : { ownerId: actor.id };
  for (const key of ["subject", "grade", "type"] as const)
    if (filters[key]) where[key] = filters[key];
  const searchMode = filters.searchMode || "keyword";
  if (!["keyword", "semantic"].includes(searchMode)) throw new RequestError(400, "搜索方式无效。");
  if (searchMode === "semantic") {
    const query = (filters.q ?? "").trim();
    if (!query || query.length > 200)
      throw new RequestError(400, "请输入 1 至 200 字的语义搜索内容。");
    const config = await db.embeddingSetting.findUnique({ where: { id: "question-bank" } });
    if (!config?.enabled)
      throw new RequestError(409, "管理员尚未启用向量化模型，请使用关键词搜索。");
    const clauses: Prisma.Sql[] = [
      Prisma.sql`i.version = ${config.version}`,
      Prisma.sql`i.status = 'INDEXED'`,
    ];
    if (actor.role !== "ADMIN") clauses.push(Prisma.sql`q."ownerId" = ${actor.id}`);
    for (const key of ["subject", "grade", "type"] as const)
      if (filters[key]) clauses.push(Prisma.sql`${Prisma.raw(`q."${key}"`)} = ${filters[key]}`);
    const [candidates, allTotal] = await Promise.all([
      db.$queryRaw<{ id: string; revision: string }[]>(Prisma.sql`
        SELECT q.id, i.revision FROM "questions" q
        JOIN "question_search_indexes" i ON i."questionId" = q.id
        WHERE ${Prisma.join(clauses, " AND ")}`),
      db.question.count({ where }),
    ]);
    if (!candidates.length)
      return {
        questions: [],
        total: 0,
        page,
        pageSize: 20,
        searchMode,
        indexedTotal: 0,
        warning: allTotal
          ? "当前筛选下尚无已索引题目，请等待后台索引或联系管理员重建索引。"
          : undefined,
      };
    const vector = await createEmbedding(config, query);
    const keys = candidates.map((item) => `${item.id}:${item.revision}`);
    const points = await queryPoints(config.version, vector, keys, page);
    const keyToId = new Map(candidates.map((item) => [`${item.id}:${item.revision}`, item.id]));
    // Revalidate against authoritative rows after the external call, including concurrent edits.
    const questions = points.length
      ? await db.$queryRaw<Question[]>(Prisma.sql`
      SELECT q.* FROM "questions" q
      JOIN "question_search_indexes" i ON i."questionId" = q.id
      WHERE ${Prisma.join(clauses, " AND ")}
      AND (q.id || ':' || i.revision) IN (${Prisma.join(points.map((point) => point.id))})`)
      : [];
    const byId = new Map(questions.map((question) => [question.id, question]));
    return {
      questions: points
        .map((point) => byId.get(keyToId.get(point.id)!))
        .filter((question) => question !== undefined),
      total: candidates.length,
      page,
      pageSize: 20,
      searchMode,
      indexedTotal: candidates.length,
      ...(allTotal > candidates.length
        ? {
            warning: `当前筛选下有 ${allTotal - candidates.length} 道题尚未索引，暂不参与语义搜索。`,
          }
        : {}),
    };
  }
  const query = (filters.q ?? "").trim().slice(0, 200);
  if (query)
    where.OR = [
      { content: { path: ["stem"], string_contains: query, mode: "insensitive" } },
      { knowledgeTags: { has: query } },
    ];
  const [questions, total] = await Promise.all([
    db.question.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * 20,
      take: 20,
    }),
    db.question.count({ where }),
  ]);
  return { questions, total, page, pageSize: 20, searchMode };
}
