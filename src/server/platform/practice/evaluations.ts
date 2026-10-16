import "server-only";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { Actor } from "@/contracts/platform";
import {
  practiceGradeInputSchema,
  practiceEvaluationSchema,
  type PracticeGradeInput,
  type PracticeEvaluationInput,
  type PracticeAiContext,
  type PracticeAnswer,
  type PracticeItemEligibility,
  type PracticeCommand,
  type PracticeCommandResult,
} from "@/contracts/practice";
import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { getStoragePaths } from "@/server/config/env";
import { RequestError } from "@/server/http/errors";
import { questionAssetUrls } from "@/lib/question-assets";
import { json, missing, type Db } from "../access";
import {
  current,
  parse,
  conflict,
  canonical,
  own,
  frozen,
  attemptAccess,
  evaluationVersion,
  teacherConfirmed,
  reviewTeacher,
  audit,
  type SessionRow,
  type AttemptRow,
  type CurrentActor,
} from "./context";
import { recordExposure } from "./exposure";
import { references } from "./snapshot";

export function evaluationImageUrls(entry: PracticeEvaluationInput["items"][number]) {
  return questionAssetUrls({
    stem: entry.feedback,
    parts: entry.parts.map((p) => ({ stem: p.feedback })),
  });
}
function active(row: SessionRow, attempt: AttemptRow, expected: number) {
  if (row.status !== "SUBMITTED" || row.currentAttemptId !== attempt.id)
    throw conflict("本次尝试已进入历史，请重新读取当前提交；不能把旧反馈套到新稿。");
  if (evaluationVersion(attempt) !== expected)
    throw conflict("反馈版本已变化，请重新读取并比较，不能覆盖他人核验。");
}
export function validateEvaluation(row: SessionRow, evaluation: PracticeEvaluationInput) {
  const items = frozen(row).paper.items;
  if (evaluation.items.length !== items.length)
    throw new RequestError(422, "请逐题给出反馈，无法核验的题目须明确待核验或跳过。");
  for (const item of items) {
    const feedback = evaluation.items.find((f) => f.itemId === item.id);
    const parts = item.snapshot.type === "MIXED" ? item.snapshot.content.parts : [];
    if (
      !feedback ||
      feedback.parts.length !== parts.length ||
      parts.some((p) => !feedback.parts.some((f) => f.partId === p.id))
    )
      throw new RequestError(422, "反馈题目或小问与冻结练习不一致。");
  }
}
/** Only trusted immutable sources can authorize a picture in feedback. SELF cannot reveal private reference images. */
export function feedbackImageUrls(
  row: SessionRow,
  attempt: AttemptRow,
  source: string,
  evaluation: PracticeEvaluationInput,
  historicalPublic: string[] = [],
) {
  const value = frozen(row),
    allowedPublic = new Set(
      attempt.assetUrls.concat(
        historicalPublic,
        value.studentImageUrls,
        Object.values(value.studentImageUrlsByItem).flat(),
        references(value, row.revealedItemIds).items.flatMap((i) => i.images),
      ),
    );
  for (const old of attempt.evaluations.filter((e) => e.source !== "SELF"))
    for (const entry of (old.evaluation as unknown as PracticeEvaluationInput).items) {
      const q = value.paper.items.find((i) => i.id === entry.itemId);
      if (q)
        evaluationImageUrls(entry)
          .filter((url) => questionAssetUrls(q.snapshot.content).includes(url))
          .forEach((url) => allowedPublic.add(url));
    }
  for (const entry of evaluation.items) {
    const question = value.paper.items.find((i) => i.id === entry.itemId)!;
    const allowed =
      source === "SELF"
        ? allowedPublic
        : new Set([...allowedPublic, ...questionAssetUrls(question.snapshot.content)]);
    if (evaluationImageUrls(entry).some((url) => !allowed.has(url)))
      throw new RequestError(
        422,
        "反馈包含尚未开放或不属于该题的图片，请移除该图片或先明确查看参考。",
      );
  }
  // A summary has no item identity, so it can only reuse public prompt / already opened pictures.
  if (questionAssetUrls({ stem: evaluation.summary }).some((url) => !allowedPublic.has(url)))
    throw new RequestError(422, "反馈概述不能引用未开放的参考图片，请放在对应题目的反馈中。");
}
async function storeEvaluation(
  db: Prisma.TransactionClient,
  a: CurrentActor,
  row: SessionRow,
  attempt: AttemptRow,
  source: "SELF" | "AI_CANDIDATE" | "TEACHER_CONFIRMED",
  evaluation: PracticeEvaluationInput,
  options: { reason?: string; candidateId?: string | null; jobId?: string } = {},
) {
  validateEvaluation(row, evaluation);
  const history = await db.practiceEvaluation.findMany({
    where: {
      attempt: { sessionId: row.id },
      source: { in: ["AI_CANDIDATE", "TEACHER_CONFIRMED"] },
    },
    select: { evaluation: true },
  });
  const historicalPublic = history.flatMap((e) =>
    (e.evaluation as unknown as PracticeEvaluationInput).items.flatMap((entry) => {
      const question = frozen(row).paper.items.find((i) => i.id === entry.itemId);
      return question
        ? evaluationImageUrls(entry).filter((url) =>
            questionAssetUrls(question.snapshot.content).includes(url),
          )
        : [];
    }),
  );
  feedbackImageUrls(row, attempt, source, evaluation, historicalPublic);
  const version = evaluationVersion(attempt) + 1;
  const saved = await db.practiceEvaluation.create({
    data: {
      attemptId: attempt.id,
      version,
      source,
      actorId: a.id,
      actorName: a.name,
      candidateId: options.candidateId,
      aiJobId: options.jobId,
      evaluation: json(evaluation),
    },
  });
  const eligibility = attempt.eligibility as unknown as PracticeItemEligibility[];
  const rows = frozen(row).paper.items.flatMap((item) => {
    const feedback = evaluation.items.find((e) => e.itemId === item.id)!,
      qualification = eligibility.find((e) => e.itemId === item.id)!;
    const leaves =
      item.snapshot.type === "MIXED"
        ? feedback.parts.map((p) => ({ partId: p.partId, judgment: p.judgment }))
        : [{ partId: "", judgment: feedback.judgment }];
    return leaves.map((leaf) => ({
      sessionId: row.id,
      evaluationId: saved.id,
      itemId: item.id,
      partId: leaf.partId,
      originalQuestionId: qualification.originalQuestionId,
      promptFingerprint: qualification.promptFingerprint,
      subject: row.subject,
      knowledgeTags:
        leaf.partId &&
        item.snapshot.content.parts.find((p) => p.id === leaf.partId)?.knowledgeTags.length
          ? item.snapshot.content.parts.find((p) => p.id === leaf.partId)!.knowledgeTags
          : item.snapshot.knowledgeTags,
      judgment: leaf.judgment,
      source,
      eligibility: qualification.eligibility,
    }));
  });
  if (rows.length) await db.practiceEvidence.createMany({ data: rows });
  await recordExposure(
    db,
    row,
    evaluation.items.map((i) => i.itemId),
    "FEEDBACK_PROVIDED",
    "已提供练习反馈，后续重做保守视为答案已可获取。",
  );
  if (source === "TEACHER_CONFIRMED")
    await db.practiceSession.update({ where: { id: row.id }, data: { reviewRequestedAt: null } });
  await audit(db, a, `practice.evaluation.${source.toLowerCase()}`, {
    sessionId: row.id,
    reason: options.reason,
    details: {
      attemptId: attempt.id,
      changes: [
        `保存第 ${version} 版${source === "TEACHER_CONFIRMED" ? "教师核验" : source === "SELF" ? "学生自评" : "AI候选"}；原反馈保留历史，不进入正式成绩。`,
      ],
    },
  });
  return saved;
}
export async function executeEvaluationCommand(
  db: Prisma.TransactionClient,
  a: CurrentActor,
  c: Extract<
    PracticeCommand,
    { type: "practice.self-assess" | "practice.review.confirm" | "practice.review.request" }
  >,
): Promise<PracticeCommandResult> {
  const { row, attempt } = await attemptAccess(db, a, c.attemptId);
  active(row, attempt, c.expectedEvaluationVersion);
  if (c.type === "practice.review.request") {
    if (!own(a, row)) throw missing();
    await db.practiceSession.update({
      where: { id: row.id },
      data: { reviewRequestedAt: new Date(), version: { increment: 1 } },
    });
    await audit(db, a, c.type, {
      sessionId: row.id,
      reason: c.message,
      details: {
        attemptId: attempt.id,
        changes: ["请求教师核验；已有核验保留历史，待核验期间不视为已确认结论。"],
      },
    });
    return {
      id: row.id,
      sessionId: row.id,
      version: row.version + 1,
      attemptId: attempt.id,
      evaluationVersion: evaluationVersion(attempt),
    };
  }
  if (c.type === "practice.self-assess") {
    if (!own(a, row)) throw missing();
    if (teacherConfirmed(attempt)) throw conflict("已有教师核验，学生可请求复核，不能用自评覆盖。");
  } else {
    if (!reviewTeacher(a, row)) throw missing();
    if (
      c.candidateId &&
      !attempt.evaluations.some((e) => e.id === c.candidateId && e.source === "AI_CANDIDATE")
    )
      throw conflict("候选反馈不属于本次尝试。");
  }
  const saved = await storeEvaluation(
    db,
    a,
    row,
    attempt,
    c.type === "practice.self-assess" ? "SELF" : "TEACHER_CONFIRMED",
    c.evaluation,
    c.type === "practice.review.confirm" ? { reason: c.reason, candidateId: c.candidateId } : {},
  );
  return {
    id: row.id,
    sessionId: row.id,
    version: row.version,
    attemptId: attempt.id,
    evaluationId: saved.id,
    evaluationVersion: saved.version,
  };
}
async function context(db: Db, actor: Actor, input: PracticeGradeInput) {
  const a = await current(actor, db),
    { row, attempt } = await attemptAccess(db, a, input.attemptId);
  if (!(own(a, row) || reviewTeacher(a, row))) throw missing();
  active(row, attempt, input.expectedEvaluationVersion);
  if (teacherConfirmed(attempt)) throw conflict("教师已核验，旧AI候选不能取代教师结论。");
  if (
    (input.sessionId && input.sessionId !== row.id) ||
    input.attemptFingerprint !== attempt.attemptFingerprint ||
    input.contentFingerprint !== row.contentFingerprint ||
    input.contentFingerprint !== attempt.contentFingerprint
  )
    throw conflict("本次反馈基线与冻结作答不一致。");
  return { a, row, attempt };
}
export async function loadPracticeAiContext(
  actor: Actor,
  raw: unknown,
  db: Db = getDb(),
): Promise<PracticeAiContext> {
  const input = parse(practiceGradeInputSchema, raw),
    { a, row, attempt } = await context(db, actor, input);
  return {
    actor: a,
    sessionId: row.id,
    setId: row.setId,
    subject: row.subject,
    attemptId: attempt.id,
    evaluationVersion: evaluationVersion(attempt),
    attemptFingerprint: attempt.attemptFingerprint,
    contentFingerprint: attempt.contentFingerprint,
    paper: frozen(row).paper,
    answers: attempt.answers as unknown as PracticeAnswer[],
    eligibility: attempt.eligibility as unknown as PracticeItemEligibility[],
  };
}
export async function readPracticeAiAsset(
  actor: Actor,
  raw: unknown,
  url: string,
  db: Db = getDb(),
) {
  const input = parse(practiceGradeInputSchema, raw),
    { row, attempt } = await context(db, actor, input);
  const allowed = [...row.promptAssetUrls, ...row.referenceAssetUrls, ...attempt.assetUrls];
  if (!allowed.includes(url) || !/^\/api\/platform\/assets\/[a-f0-9-]{36}$/.test(url))
    throw missing();
  const asset = await db.platformAsset.findUnique({ where: { id: url.split("/").at(-1)! } }),
    root = resolve(getStoragePaths().storage, "platform-assets") + sep;
  if (!asset || !resolve(asset.path).startsWith(root)) throw missing();
  return { buffer: await readFile(asset.path), name: asset.name };
}
export async function commitPracticeAiFeedback(
  actor: Actor,
  raw: unknown,
  rawEvaluation: unknown,
  options: { jobId: string; db?: Db },
) {
  const input = parse(practiceGradeInputSchema, raw),
    evaluation = parse(practiceEvaluationSchema, rawEvaluation),
    db = options.db ?? getDb();
  const commit = async (tx: Prisma.TransactionClient) => {
    await tx.$queryRaw`SELECT id FROM ai_jobs WHERE id = ${options.jobId} FOR UPDATE`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(7240132026::bigint)::text`;
    const job = await tx.aiJob.findUnique({ where: { id: options.jobId } });
    if (
      !job ||
      job.userId !== actor.id ||
      job.kind !== "PRACTICE_GRADE" ||
      job.status !== "RUNNING"
    )
      throw conflict("练习反馈任务已失效或不属于当前账号。");
    const { a, row, attempt } = await context(tx, actor, input);
    const fixed = { ...input, sessionId: row.id },
      jobInput = parse(practiceGradeInputSchema, job.input);
    if (canonical(fixed) !== canonical(jobInput))
      throw conflict("AI任务原始基线与本次提交不一致。");
    const saved = await storeEvaluation(tx, a, row, attempt, "AI_CANDIDATE", evaluation, {
      jobId: job.id,
    });
    const counts: Record<string, number> = {
      CORRECT: 0,
      PARTIAL: 0,
      INCORRECT: 0,
      UNSURE: 0,
      SKIPPED: 0,
      total: 0,
    };
    for (const entry of evaluation.items)
      for (const leaf of entry.parts.length ? entry.parts : [entry]) {
        counts[leaf.judgment]++;
        counts.total++;
      }
    const result = {
      sessionId: row.id,
      setId: row.setId,
      attemptId: attempt.id,
      evaluationId: saved.id,
      version: saved.version,
      counts,
    };
    await tx.aiJob.update({
      where: { id: job.id },
      data: {
        status: "COMPLETED",
        result: json({ summary: "练习反馈候选已保存，等待核验。", result }),
        finishedAt: new Date(),
      },
    });
    return result;
  };
  return "$transaction" in db ? db.$transaction(commit, { timeout: 60000 }) : commit(db);
}
