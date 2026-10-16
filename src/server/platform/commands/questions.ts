import "server-only";
import { normalizeQuestionAssets, questionAssetUrls } from "@/lib/question-assets";
import { RequestError } from "@/server/http/errors";
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
      await assertAssets(db, a, [...data.content.images, ...questionAssetUrls(data.content)]);
      const content = normalizeQuestionAssets(data.content);
      if (content.images.length > 20)
        throw new RequestError(400, "题目全部配图（含文字内引用）最多20张，请减少图片后保存。");
      const q = id
        ? await db.question.update({
            where: { id },
            data: { ...data, content: json(content) },
          })
        : await db.question.create({
            data: { ...data, ownerId: a.id, content: json(content) },
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
