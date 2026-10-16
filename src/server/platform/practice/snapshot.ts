import "server-only";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import type { Paper } from "@/contracts/platform";
import type {
  PracticeFrozenPaper,
  PracticeItemEligibility,
  PracticeReference,
  PracticeSetPreview,
} from "@/contracts/practice";
import { canReadSubject } from "@/contracts/permissions";
import { questionAssetUrls } from "@/lib/question-assets";
import { getStoragePaths } from "@/server/config/env";
import { RequestError } from "@/server/http/errors";
import { owner, missing, visibleClassrooms, type Db } from "../access";
import { paperRecord } from "../records";
import { promptImages, studentPaper } from "../homework/context";
import { current, hash } from "./context";
import type { Actor } from "@/contracts/platform";
export function paperDTO(
  raw: { items: unknown; layout: unknown; kind: string; createdAt: Date; updatedAt: Date } & Omit<
    Paper,
    "items" | "layout" | "kind" | "createdAt" | "updatedAt"
  >,
): Paper {
  return {
    ...paperRecord(raw),
    kind: raw.kind as Paper["kind"],
    layout: raw.layout as Paper["layout"],
    createdAt: raw.createdAt.toISOString(),
    updatedAt: raw.updatedAt.toISOString(),
  };
}
export const paperPromptUrls = (paper: Paper) =>
  questionAssetUrls({
    stem: [paper.instructions, ...(paper.layout.textBlocks ?? []).map((b) => b.text)].join("\n"),
  });
function unsupported(text: string) {
  return (
    /<img\b/i.test(text) ||
    [...text.matchAll(/!\[[^\]]*\]\(([^\s)]+)(?:\s+[^)]*)?\)|!\[[^\]]*\](?!\()/g)].some(
      (m) => !m[1] || !/^\/api\/platform\/assets\/[a-f0-9-]{36}$/.test(m[1]),
    )
  );
}
export function snapshotReasons(paper: Paper) {
  const texts = [
    paper.instructions,
    ...(paper.layout.textBlocks ?? []).map((b) => b.text),
    ...paper.items.flatMap((i) => [
      i.snapshot.content.stem,
      ...i.snapshot.content.options.map((o) => o.text),
      ...i.snapshot.content.parts.flatMap((p) => [p.stem, ...p.options.map((o) => o.text)]),
    ]),
  ];
  return [
    ...(!paper.items.length ? ["请先添加题目。"] : []),
    ...(texts.some(unsupported)
      ? ["请将题面外链、HTML或引用式图片改为本站上传的Markdown图片后发布。"]
      : []),
  ];
}
export async function loadPracticeSetPreview(
  actor: Actor,
  paperId: string,
  db: Db,
): Promise<PracticeSetPreview> {
  const a = await current(actor, db);
  if (a.role === "STUDENT") throw missing();
  const raw = owner(a, await db.paper.findUnique({ where: { id: paperId } })),
    paper = paperDTO(raw);
  const classes = await db.classroom.findMany({ where: visibleClassrooms(a) });
  const classrooms = classes
    .filter((c) => canReadSubject(a, c, paper.subject))
    .map(({ id, name, stage, cohort }) => ({ id, name, stage, cohort }));
  const suggested = paperPromptUrls(paper),
    items = paper.items.map((i) => ({
      itemId: i.id,
      allowedStudentImageUrls: questionAssetUrls(i.snapshot.content),
      suggestedStudentImageUrls: promptImages(i.snapshot.content),
    }));
  const reasons = [
    ...snapshotReasons(paper),
    ...(!classrooms.length ? ["当前没有可发布此学科练习的班级权限。"] : []),
  ];
  return {
    actor: a,
    paper,
    studentPaper: studentPaper({
      paper,
      studentImageUrls: suggested,
      studentImageUrlsByItem: Object.fromEntries(
        items.map((i) => [i.itemId, i.suggestedStudentImageUrls]),
      ),
    }),
    classrooms,
    allowedStudentImageUrls: suggested,
    suggestedStudentImageUrls: suggested,
    items,
    canPublish: !reasons.length,
    blockReasons: reasons,
  };
}
export async function verifyFrozen(
  db: Db,
  actorId: string,
  admin: boolean,
  preview: PracticeSetPreview,
  selected: { studentImageUrls: string[]; items: { itemId: string; studentImageUrls: string[] }[] },
): Promise<PracticeFrozenPaper> {
  if (
    selected.items.length !== preview.items.length ||
    selected.studentImageUrls.some((u) => !preview.allowedStudentImageUrls.includes(u)) ||
    preview.suggestedStudentImageUrls.some((u) => !selected.studentImageUrls.includes(u))
  )
    throw new RequestError(400, "请明确完整发放说明及阅读块配图。");
  for (const u of selected.studentImageUrls) {
    const asset = await db.platformAsset.findUnique({ where: { id: u.split("/").at(-1)! } });
    if (!asset || (!admin && asset.ownerId !== actorId)) throw missing();
  }
  const byItem: Record<string, string[]> = {};
  for (const item of preview.items) {
    const chosen = selected.items.find((i) => i.itemId === item.itemId),
      source = preview.paper.items.find((i) => i.id === item.itemId)!.snapshot;
    if (
      !chosen ||
      chosen.studentImageUrls.some((u) => !item.allowedStudentImageUrls.includes(u)) ||
      item.suggestedStudentImageUrls.some((u) => !chosen.studentImageUrls.includes(u))
    )
      throw new RequestError(400, "请完整确认每道题的学生可见配图。");
    for (const u of chosen.studentImageUrls) {
      const asset = await db.platformAsset.findUnique({ where: { id: u.split("/").at(-1)! } });
      if (
        !asset ||
        (!admin &&
          !source.content.images.includes(u) &&
          asset.ownerId !== source.ownerId &&
          asset.ownerId !== actorId)
      )
        throw missing();
    }
    byItem[item.itemId] = chosen.studentImageUrls;
  }
  return {
    paper: preview.paper,
    studentImageUrls: selected.studentImageUrls,
    studentImageUrlsByItem: byItem,
  };
}
export function replayFrozen(paper: Paper): PracticeFrozenPaper {
  const reasons = snapshotReasons(paper);
  if (reasons.length) throw new RequestError(400, reasons.join(" "));
  return {
    paper,
    studentImageUrls: paperPromptUrls(paper),
    studentImageUrlsByItem: Object.fromEntries(
      paper.items.map((i) => {
        const c = i.snapshot.content,
          hidden = questionAssetUrls({
            answers: c.answers,
            explanation: c.explanation,
            rubric: c.rubric,
            parts: c.parts.map((p) => ({
              answers: p.answers,
              explanation: p.explanation,
              rubric: p.rubric,
            })),
          });
        return [
          i.id,
          [...new Set([...promptImages(c), ...c.images.filter((u) => !hidden.includes(u))])],
        ];
      }),
    ),
  };
}
export function promptAssetUrls(value: PracticeFrozenPaper) {
  return [
    ...new Set([...value.studentImageUrls, ...Object.values(value.studentImageUrlsByItem).flat()]),
  ];
}
export function referenceAssetUrls(value: PracticeFrozenPaper) {
  return [...new Set(value.paper.items.flatMap((i) => questionAssetUrls(i.snapshot.content)))];
}
export function references(value: PracticeFrozenPaper, ids: string[]): PracticeReference {
  return {
    items: value.paper.items
      .filter((i) => ids.includes(i.id))
      .map((i) => {
        const c = i.snapshot.content;
        return {
          itemId: i.id,
          answers: c.answers,
          explanation: c.explanation,
          rubric: c.rubric,
          images: questionAssetUrls(c),
          parts: c.parts.map((p) => ({
            partId: p.id,
            answers: p.answers,
            explanation: p.explanation,
            rubric: p.rubric,
          })),
        };
      }),
  };
}
/** Body-only identity survives copied IDs, image URLs and hidden answer edits. */
export async function sourceItems(
  db: Db,
  paper: Paper,
  manifest: PracticeFrozenPaper = replayFrozen(paper),
): Promise<PracticeItemEligibility[]> {
  const cache = new Map<string, string>();
  async function imageHash(u: string) {
    if (!cache.has(u)) {
      const asset = await db.platformAsset.findUnique({ where: { id: u.split("/").at(-1)! } });
      const root = resolve(getStoragePaths().storage, "platform-assets") + sep;
      if (!asset || !resolve(asset.path).startsWith(root)) throw missing();
      cache.set(
        u,
        createHash("sha256")
          .update(await readFile(asset.path))
          .digest("hex"),
      );
    }
    return cache.get(u)!;
  }
  async function normalize(text: string) {
    for (const u of questionAssetUrls({ stem: text }))
      text = text.replaceAll(u, `asset:${await imageHash(u)}`);
    return text.replace(/\s+/g, " ").trim();
  }
  const blocks = await Promise.all((paper.layout.textBlocks ?? []).map((b) => normalize(b.text)));
  return Promise.all(
    paper.items.map(async (i) => {
      const c = i.snapshot.content;
      return {
        itemId: i.id,
        originalQuestionId: i.snapshot.id || i.questionId,
        promptFingerprint: hash({
          instructions: await normalize(paper.instructions),
          images: await Promise.all((manifest.studentImageUrlsByItem[i.id] ?? []).map(imageHash)),
          sharedImages: await Promise.all(manifest.studentImageUrls.map(imageHash)),
          type: i.snapshot.type,
          stem: await normalize(c.stem),
          options: await Promise.all(
            c.options.map(async (o) => ({ label: o.label, text: await normalize(o.text) })),
          ),
          parts: await Promise.all(
            c.parts.map(async (p) => ({
              type: p.type,
              stem: await normalize(p.stem),
              options: await Promise.all(
                p.options.map(async (o) => ({ label: o.label, text: await normalize(o.text) })),
              ),
            })),
          ),
          blocks,
        }),
        eligibility: "UNKNOWN" as const,
        reasons: [],
      };
    }),
  );
}
