import "server-only";
import type { Prisma as PrismaTypes } from "@/generated/prisma/client";
import type { PlatformState } from "../types";
import type { Command } from "./types";
import { assertAssets, json, missing, owner } from "../access";
import { questionInputSchema } from "../schemas";
import { RequestError } from "@/server/http/errors";
export async function executePapersCommand(
  db: PrismaTypes.TransactionClient,
  a: PlatformState["actor"],
  command: Command,
) {
  switch (command.type) {
    case "paper.save": {
      const { id, items, ...data } = command.paper;
      if (id) {
        owner(a, await db.paper.findUnique({ where: { id } }));
        if (await db.assessmentPaper.count({ where: { paperId: id } }))
          throw new RequestError(409, "试卷已用于考试或作业，请另存新卷以保留原始成绩依据。");
      }
      const rows = await db.question.findMany({
        where: {
          id: { in: items.filter((i) => !i.question).map((i) => i.questionId) },
          ...(a.role === "ADMIN" ? {} : { ownerId: a.id }),
        },
      });
      if (rows.length !== items.filter((i) => !i.question).length) throw missing();
      if (rows.some((q) => q.subject !== data.subject))
        throw new RequestError(400, "题目学科必须与试卷学科一致。");
      const nested = [];
      for (const [position, item] of items.entries()) {
        const source = item.question ?? rows.find((q) => q.id === item.questionId)!;
        const parsed = questionInputSchema.safeParse({
          ...source,
          content: item.content ?? source.content,
        });
        if (!parsed.success)
          throw new RequestError(400, parsed.error.issues.map((i) => i.message).join(" "));
        if (parsed.data.subject !== data.subject)
          throw new RequestError(400, "题目学科必须与试卷学科一致。");
        await assertAssets(db, a, parsed.data.content.images);
        const now = new Date().toISOString();
        nested.push({
          questionId: item.questionId,
          score: item.score,
          section: item.section,
          position,
          snapshot: json({
            ...parsed.data,
            id: item.questionId,
            ownerId: a.id,
            createdAt: "createdAt" in source ? source.createdAt.toISOString() : now,
            updatedAt: now,
          }),
        });
      }
      if (id) {
        await db.paperItem.deleteMany({ where: { paperId: id } });
        await db.cardTemplate.deleteMany({ where: { paperId: id } });
        const p = await db.paper.update({
          where: { id },
          data: { ...data, layout: json(data.layout), items: { create: nested } },
        });
        return { id: p.id };
      }
      const p = await db.paper.create({
        data: { ...data, ownerId: a.id, layout: json(data.layout), items: { create: nested } },
      });
      return { id: p.id };
    }
    case "paper.delete": {
      owner(a, await db.paper.findUnique({ where: { id: command.id } }));
      if (await db.assessmentPaper.count({ where: { paperId: command.id } }))
        throw new RequestError(409, "已布置的试卷不能删除。");
      await db.paper.delete({ where: { id: command.id } });
      return { id: command.id };
    }
  }
}
