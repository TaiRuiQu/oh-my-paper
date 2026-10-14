import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { PlatformState } from "@/contracts/platform";
import { teacher, type Db } from "./access";
import { RequestError } from "@/server/http/errors";
export async function queryQuestionBank(
  db: Db,
  actor: PlatformState["actor"],
  filters: { subject?: string; grade?: string; type?: string; q?: string },
  page = 1,
) {
  teacher(actor);
  if (!Number.isInteger(page) || page < 1 || page > 100000)
    throw new RequestError(400, "页码无效。");
  const where: Prisma.QuestionWhereInput = actor.role === "ADMIN" ? {} : { ownerId: actor.id };
  for (const key of ["subject", "grade", "type"] as const)
    if (filters[key]) where[key] = filters[key];
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
  return { questions, total, page, pageSize: 20 };
}
