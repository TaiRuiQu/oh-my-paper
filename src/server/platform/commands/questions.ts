import "server-only";
import type { Prisma as PrismaTypes } from "@/generated/prisma/client";
import type { PlatformState } from "../types";
import type { Command } from "./types";
import { assertAssets, json, owner } from "../access";
export async function executeQuestionsCommand(
  db: PrismaTypes.TransactionClient,
  a: PlatformState["actor"],
  command: Command,
) {
  switch (command.type) {
    case "question.save": {
      const { id, ...data } = command.question;
      if (id) owner(a, await db.question.findUnique({ where: { id } }));
      await assertAssets(db, a, data.content.images);
      const q = id
        ? await db.question.update({
            where: { id },
            data: { ...data, content: json(data.content) },
          })
        : await db.question.create({
            data: { ...data, ownerId: a.id, content: json(data.content) },
          });
      return { id: q.id };
    }
    case "question.delete": {
      owner(a, await db.question.findUnique({ where: { id: command.id } }));
      await db.question.delete({ where: { id: command.id } });
      return { id: command.id };
    }
  }
}
