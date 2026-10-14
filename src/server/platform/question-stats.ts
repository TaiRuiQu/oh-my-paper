import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { Db } from "./access";
export async function questionStatistics(db: Db, ownerId?: string) {
  // Aggregate on the server; full question bodies never enter the analysis response.
  const rows = await db.$queryRaw<
    {
      subject: string;
      type: string;
      difficulty: number;
      knowledgeTags: string[];
      hasAnswers: boolean;
      hasExplanation: boolean;
    }[]
  >(Prisma.sql`
    SELECT "subject", "type", "difficulty", "knowledgeTags",
      (jsonb_array_length(COALESCE("content"->'answers', '[]'::jsonb)) > 0 OR jsonb_path_exists("content", '$.parts[*].answers[*]')) AS "hasAnswers",
      (COALESCE("content"->>'explanation', '') <> '') AS "hasExplanation"
    FROM "questions" ${ownerId ? Prisma.sql`WHERE "ownerId" = ${ownerId}` : Prisma.empty}
  `);
  const tags = new Map<
    string,
    { tag: string; count: number; subjects: string[]; difficulty: number }
  >();
  const subjects: Record<string, number> = {},
    types: Record<string, number> = {};
  let missingAnswers = 0,
    missingExplanations = 0;
  for (const row of rows) {
    if (!row.hasAnswers) missingAnswers++;
    if (!row.hasExplanation) missingExplanations++;
    subjects[row.subject] = (subjects[row.subject] ?? 0) + 1;
    types[row.type] = (types[row.type] ?? 0) + 1;
    for (const tag of row.knowledgeTags) {
      const current = tags.get(tag) ?? { tag, count: 0, subjects: [], difficulty: 0 };
      current.count++;
      current.difficulty += row.difficulty;
      if (!current.subjects.includes(row.subject)) current.subjects.push(row.subject);
      tags.set(tag, current);
    }
  }
  return {
    total: rows.length,
    subjects,
    types,
    missingAnswers,
    missingExplanations,
    tags: [...tags.values()].map((t) => ({ ...t, difficulty: t.difficulty / t.count })),
  };
}
