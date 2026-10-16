import "server-only";
import { rm } from "node:fs/promises";
import type { Actor } from "@/contracts/platform";
import { getDb } from "@/server/db/client";
import { getActor, missing, type Db } from "../access";
import { saveImage } from "../assets";
import {
  assignmentAccess,
  frozenPapers,
  homeworkConflict,
  homeworkInclude,
  homeworkWorkScope,
  visibleWorks,
  workReasons,
  type HomeworkActor,
} from "./context";

export async function saveHomeworkAsset(
  actor: Actor,
  workId: string,
  buffer: Buffer,
  name: string,
) {
  const db = getDb(),
    current = await getActor(actor.id, db);
  const found = await db.homeworkWork.findUnique({
    where: { id: workId },
    select: { assignmentId: true },
  });
  if (!found || current.role !== "STUDENT") throw missing();
  const row = await assignmentAccess(db, current, found.assignmentId),
    work = visibleWorks(current, row).find((w) => w.id === workId);
  if (!work) throw missing();
  const reasons = workReasons(current, row, work);
  if (reasons.length) throw homeworkConflict(reasons.join(" "));
  // Decode outside the global domain lock. Revalidate the captured baseline before attaching.
  const saved = await saveImage(current.id, buffer, name);
  try {
    await db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(7240132026::bigint)::text`;
        const freshActor = await getActor(actor.id, tx),
          fresh = await assignmentAccess(tx, freshActor, row.id),
          freshWork = visibleWorks(freshActor, fresh).find((w) => w.id === workId);
        if (!freshWork || freshActor.role !== "STUDENT") throw missing();
        if (fresh.version !== row.version || freshWork.version !== work.version)
          throw homeworkConflict("上传期间作业或草稿已变化，请重新读取后上传。");
        const blocked = workReasons(freshActor, fresh, freshWork);
        if (blocked.length) throw homeworkConflict(blocked.join(" "));
        await tx.homeworkAsset.create({
          data: { workId, assetId: saved.id, uploadedBy: current.id },
        });
      },
      { timeout: 30000 },
    );
  } catch (error) {
    const stored = await db.platformAsset.findUnique({ where: { id: saved.id } });
    if (stored) {
      await db.platformAsset.delete({ where: { id: saved.id } });
      await rm(stored.path, { force: true });
    }
    throw error;
  }
  return { id: saved.id, url: saved.url };
}

/** Extends access only with issued prompt media or immutable submitted evidence, never teacher-visible drafts. */
export async function canReadHomeworkAsset(actor: HomeworkActor, url: string, db: Db) {
  const rows = await db.homeworkAssignment.findMany({
    where: { promptAssetUrls: { has: url }, works: { some: homeworkWorkScope(actor) } },
    include: {
      ...homeworkInclude,
      works: { ...homeworkInclude.works, where: homeworkWorkScope(actor) },
    },
  });
  for (const row of rows)
    for (const work of visibleWorks(actor, row)) {
      if (
        actor.role === "STUDENT" &&
        (row.status === "CANCELLED" || work.participantSubject.status !== "REQUIRED")
      )
        continue;
      const frozen = frozenPapers(row).find(
        ({ paper }) => paper.id === work.participantSubject.paperId,
      );
      if (
        frozen &&
        [
          ...frozen.studentImageUrls,
          ...Object.values(frozen.studentImageUrlsByItem).flat(),
        ].includes(url)
      )
        return true;
    }
  const id = /^\/api\/platform\/assets\/([a-f0-9-]{36})$/.exec(url)?.[1];
  if (!id) return false;
  const uploaded = await db.homeworkAsset.findUnique({
    where: { assetId: id },
    select: { workId: true, work: { select: { assignmentId: true } } },
  });
  if (!uploaded) return false;
  let row;
  try {
    row = await assignmentAccess(db, actor, uploaded.work.assignmentId);
  } catch (error) {
    if (error instanceof Error && "status" in error && error.status === 404) return false;
    throw error;
  }
  const work = visibleWorks(actor, row).find((work) => work.id === uploaded.workId);
  if (!work) return false;
  // Uploaded drafts are private even for an assignment manager. Only frozen receipts authorize teachers.
  return !!(await db.homeworkAttempt.findFirst({
    where: { workId: work.id, submission: { sourceFiles: { has: url } } },
    select: { id: true },
  }));
}
