import "server-only";
import { paperRecord } from "../records";
import type { Prisma as PrismaTypes } from "@/generated/prisma/client";
import type { PlatformState } from "../types";
import type { Command } from "./types";
import { assertAssets, json, missing, owner } from "../access";
import { validateCardTemplate } from "../cards";
import type { Paper } from "../types";
import { executePapersCommand } from "./papers";
import { RequestError } from "@/server/http/errors";
export async function executeTemplatesCommand(
  db: PrismaTypes.TransactionClient,
  a: PlatformState["actor"],
  command: Command,
) {
  switch (command.type) {
    case "template.save": {
      let { id } = command.template;
      let layout = command.template.layout;
      const data = {
        paperId: command.template.paperId,
        name: command.template.name,
        subject: command.template.subject,
      };
      let paperRow = await db.paper.findUnique({
        where: { id: data.paperId },
      });
      let paper = paperRecord(owner(a, paperRow));
      if (paper.kind !== "EXAM") throw new RequestError(400, "作业使用练习册作答，不创建答题卡。");
      if (id) {
        const previous = await db.cardTemplate.findUnique({ where: { id } });
        if (!previous || previous.preset || !previous.ownerId) throw missing();
        owner(a, { ownerId: previous.ownerId });
        if (await db.scanSubmission.count({ where: { templateId: id } }))
          throw new RequestError(409, "已扫描使用的模板不能更改，请另存。");
      }
      if (command.paperDraft) {
        const draft = command.paperDraft;
        if (
          draft.itemIds.length !== draft.items.length ||
          new Set(draft.itemIds).size !== draft.itemIds.length ||
          draft.itemIds.length !== layout.regions.length ||
          layout.regions.some((r) => !draft.itemIds.includes(r.itemId))
        )
          throw new RequestError(400, "题目与答题区必须一一对应。");
        const saved = await executePapersCommand(db, a, {
          type: "paper.save",
          paper: {
            name: `${paper.name}（答题卡修订）`.slice(0, 200),
            kind: "EXAM",
            subject: paper.subject,
            grade: paper.grade,
            instructions: paper.instructions,
            layout: paper.layout as unknown as Paper["layout"],
            items: draft.items,
          },
        });
        if (!saved) throw missing();
        paperRow = await db.paper.findUnique({
          where: { id: saved.id },
        });
        if (!paperRow) throw missing();
        paper = paperRecord(paperRow);
        layout = {
          ...layout,
          regions: layout.regions.map((region) => ({
            ...region,
            itemId: paper!.items[draft.itemIds.indexOf(region.itemId)].id,
          })),
        };
        data.paperId = paper.id;
        // The original paper and templates remain usable by existing assessments.
        id = undefined;
      }
      if (data.subject !== paper.subject) throw new RequestError(400, "模板学科与试卷不一致。");
      if (
        layout.regions.some((r) => !paper.items.some((i) => i.id === r.itemId)) ||
        paper.items.some((i) => !layout.regions.some((r) => r.itemId === i.id))
      )
        throw new RequestError(400, "模板必须完整覆盖当前试卷题目。");
      try {
        validateCardTemplate({ id: id ?? "new", ownerId: a.id, preset: false, ...data, layout }, {
          ...paper,
          createdAt: paper.createdAt.toISOString(),
          updatedAt: paper.updatedAt.toISOString(),
        } as unknown as Paper);
      } catch (error) {
        throw new RequestError(400, error instanceof Error ? error.message : "答题卡布局无效。");
      }
      await assertAssets(
        db,
        a,
        layout.regions.flatMap((r) => (r.image ? [r.image] : [])),
      );
      const t = id
        ? await db.cardTemplate.update({
            where: { id },
            data: { ...data, layout: json(layout) },
          })
        : await db.cardTemplate.create({
            data: { ...data, ownerId: a.id, preset: false, layout: json(layout) },
          });
      return { id: t.id };
    }
    case "template.delete": {
      const t = await db.cardTemplate.findUnique({ where: { id: command.id } });
      if (!t || t.preset || !t.ownerId) throw missing();
      owner(a, { ownerId: t.ownerId });
      if (await db.scanSubmission.count({ where: { templateId: t.id } }))
        throw new RequestError(409, "已使用的模板不能删除。");
      await db.cardTemplate.delete({ where: { id: t.id } });
      return { id: t.id };
    }
  }
}
