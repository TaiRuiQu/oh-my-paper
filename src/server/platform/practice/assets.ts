import "server-only";
import { rm } from "node:fs/promises";
import type { Actor } from "@/contracts/platform";
import { getDb } from "@/server/db/client";
import { questionAssetUrls } from "@/lib/question-assets";
import type { PracticeEvaluationInput } from "@/contracts/practice";
import { missing, type Db } from "../access";
import { saveImage } from "../assets";
import {
  current,
  own,
  readTeacher,
  sessionAccess,
  setScope,
  sessionScope,
  frozen,
  conflict,
  type CurrentActor,
} from "./context";
import { references } from "./snapshot";
import { evaluationImageUrls } from "./evaluations";
export async function savePracticeAsset(
  actor: Actor,
  sessionId: string,
  buffer: Buffer,
  name: string,
) {
  const db = getDb(),
    a = await current(actor, db),
    row = await sessionAccess(db, a, sessionId);
  if (!own(a, row)) throw missing();
  if (row.status !== "DRAFT") throw conflict("本次已提交，不能向历史作答追加材料。");
  const saved = await saveImage(a.id, buffer, name);
  try {
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(7240132026::bigint)::text`;
      const freshActor = await current(actor, tx),
        fresh = await sessionAccess(tx, freshActor, sessionId);
      if (!own(freshActor, fresh)) throw missing();
      if (fresh.version !== row.version || fresh.status !== "DRAFT")
        throw conflict("上传期间练习已变化，请重新读取后上传。");
      await tx.practiceAsset.create({
        data: { sessionId, assetId: saved.id, uploadedBy: freshActor.id },
      });
    });
  } catch (error) {
    const asset = await db.platformAsset.findUnique({ where: { id: saved.id } });
    if (asset) {
      await db.platformAsset.delete({ where: { id: asset.id } });
      await rm(asset.path, { force: true });
    }
    throw error;
  }
  return { id: saved.id, url: saved.url };
}
/** Authorizes only frozen manifests and submitted evidence, never arbitrary feedback strings or teacher-visible drafts. */
export async function canReadPracticeAsset(
  actor: CurrentActor,
  url: string,
  db: Db,
): Promise<boolean> {
  const sets = await db.practiceSet.findMany({
    where: {
      AND: [
        setScope(actor),
        {
          OR: [
            { promptAssetUrls: { has: url } },
            ...(actor.role !== "STUDENT" ? [{ referenceAssetUrls: { has: url } }] : []),
          ],
        },
      ],
    },
    select: { id: true },
  });
  if (sets.length) return true;
  const rows = await db.practiceSession.findMany({
    where: {
      AND: [
        sessionScope(actor),
        {
          OR: [
            { promptAssetUrls: { has: url } },
            { referenceAssetUrls: { has: url } },
            { attempts: { some: { assetUrls: { has: url } } } },
          ],
        },
      ],
    },
    select: {
      id: true,
      userId: true,
      subject: true,
      student: { include: { classroom: true } },
      currentAttemptId: true,
      frozenPaper: true,
      promptAssetUrls: true,
      referenceAssetUrls: true,
      revealedItemIds: true,
    },
  });
  for (const row of rows) {
    const learner = own(actor, row),
      teacher = !!row.currentAttemptId && readTeacher(actor, row);
    if (!learner && !teacher) continue;
    if (row.promptAssetUrls.includes(url) || (teacher && row.referenceAssetUrls.includes(url)))
      return true;
    if (
      learner &&
      references(frozen(row), row.revealedItemIds).items.some((i) => i.images.includes(url))
    )
      return true;
    if (learner && row.referenceAssetUrls.includes(url)) {
      const feedback = await db.practiceEvaluation.findMany({
        where: {
          attempt: { sessionId: row.id },
          source: { in: ["AI_CANDIDATE", "TEACHER_CONFIRMED"] },
        },
        select: { evaluation: true },
      });
      if (
        feedback.some((e) =>
          (e.evaluation as unknown as PracticeEvaluationInput).items.some((entry) => {
            const q = frozen(row).paper.items.find((i) => i.id === entry.itemId);
            return (
              !!q &&
              questionAssetUrls(q.snapshot.content).includes(url) &&
              evaluationImageUrls(entry).includes(url)
            );
          }),
        )
      )
        return true;
    }
    if (
      await db.practiceAttempt.findFirst({
        where: { sessionId: row.id, assetUrls: { has: url } },
        select: { id: true },
      })
    )
      return true;
  }
  return false;
}
