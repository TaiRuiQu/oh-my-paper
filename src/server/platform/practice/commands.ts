import "server-only";
import type { Actor } from "@/contracts/platform";
import {
  practiceCommandSchema,
  type PracticeCommand,
  type PracticeCommandResult,
  type PracticeAnswer,
  type PracticeFrozenPaper,
} from "@/contracts/practice";
import type { Prisma } from "@/generated/prisma/client";
import { canReadSubject } from "@/contracts/permissions";
import { getDb } from "@/server/db/client";
import { RequestError } from "@/server/http/errors";
import { json, missing, type Db } from "../access";
import {
  current,
  parse,
  conflict,
  canonical,
  hash,
  own,
  frozen,
  sessionAccess,
  setInclude,
  audit,
  type SessionRow,
  type CurrentActor,
} from "./context";
import {
  loadPracticeSetPreview,
  verifyFrozen,
  replayFrozen,
  paperDTO,
  sourceItems,
  promptAssetUrls,
  referenceAssetUrls,
  references,
} from "./snapshot";
import { eligibility, recordExposure } from "./exposure";
import { executeEvaluationCommand } from "./evaluations";

export async function validateAnswers(
  db: Db,
  actor: CurrentActor,
  row: SessionRow,
  answers: PracticeAnswer[],
) {
  const ids = new Set(frozen(row).paper.items.map((i) => i.id));
  if (answers.some((a) => !ids.has(a.itemId)))
    throw new RequestError(400, "作答包含本次练习之外的题目。");
  for (const url of answers.flatMap((a) => a.images)) {
    const assetId = url.split("/").at(-1)!;
    const link = await db.practiceAsset.findUnique({
      where: { assetId },
      include: { asset: true },
    });
    if (
      !link ||
      link.sessionId !== row.id ||
      link.uploadedBy !== actor.id ||
      link.asset.ownerId !== actor.id
    )
      throw missing();
  }
}
function requireDraft(
  a: CurrentActor,
  row: SessionRow,
  expectedVersion: number,
  expectedDraftVersion?: number,
) {
  if (!own(a, row)) throw missing();
  if (
    row.version !== expectedVersion ||
    (expectedDraftVersion !== undefined && row.draftVersion !== expectedDraftVersion)
  )
    throw conflict();
  if (row.status !== "DRAFT") throw conflict("本轮已经提交；请显式重做建立新尝试。");
}
async function execute(
  db: Prisma.TransactionClient,
  actor: Actor,
  c: PracticeCommand,
): Promise<PracticeCommandResult> {
  await db.$queryRaw`SELECT pg_advisory_xact_lock(7240132026::bigint)::text`;
  const a = await current(actor, db),
    now = new Date();
  if (c.type === "practice.set.publish") {
    if (a.role === "STUDENT") throw missing();
    const receipt = await db.practiceSet.findUnique({
      where: { ownerId_publishRequestId: { ownerId: a.id, publishRequestId: c.requestId } },
      include: setInclude,
    });
    if (receipt) {
      if (!canReadSubject(a, receipt.classroom, receipt.subject)) throw missing();
      if (canonical(receipt.publishInput) !== canonical(c))
        throw conflict("该发布请求编号已用于不同参数，不能重复发布。");
      return { id: receipt.id, setId: receipt.id, version: 1 };
    }
    const preview = await loadPracticeSetPreview(a, c.paperId, db);
    if (preview.paper.updatedAt !== c.expectedPaperUpdatedAt)
      throw conflict("源试卷已变化，请重新预览并确认学生可见材料。");
    if (!preview.canPublish || !preview.classrooms.some((r) => r.id === c.classroomId))
      throw conflict(preview.blockReasons.join(" ") || "当前无该班级学科发布权限。");
    const value = await verifyFrozen(db, a.id, a.role === "ADMIN", preview, c);
    const row = await db.practiceSet.create({
      data: {
        ownerId: a.id,
        publishRequestId: c.requestId,
        publishInput: json(c),
        classroomId: c.classroomId,
        classroomName: preview.classrooms.find((r) => r.id === c.classroomId)!.name,
        paperId: c.paperId,
        name: c.name,
        subject: preview.paper.subject,
        frozenPaper: json(value),
        contentFingerprint: hash(value),
        promptAssetUrls: promptAssetUrls(value),
        referenceAssetUrls: referenceAssetUrls(value),
      },
    });
    await audit(db, a, c.type, {
      setId: row.id,
      details: { changes: ["发布独立练习题集；与正式成绩隔离。"] },
    });
    return { id: row.id, setId: row.id, version: row.version };
  }
  if (c.type === "practice.set.close") {
    const row = await db.practiceSet.findUnique({ where: { id: c.setId }, include: setInclude });
    if (
      !row ||
      a.role === "STUDENT" ||
      (a.role !== "ADMIN" && row.ownerId !== a.id) ||
      !canReadSubject(a, row.classroom, row.subject)
    )
      throw missing();
    if (row.version !== c.expectedVersion || row.status !== "OPEN") throw conflict();
    const saved = await db.practiceSet.update({
      where: { id: row.id },
      data: { status: "CLOSED", version: { increment: 1 }, closedAt: now },
    });
    await audit(db, a, c.type, {
      setId: row.id,
      reason: c.reason,
      details: { changes: ["关闭新领取，保留已领取练习和历史反馈。"] },
    });
    return { id: row.id, setId: row.id, version: saved.version };
  }
  if (c.type === "practice.start") {
    if (a.role !== "STUDENT") throw missing();
    const receipt = await db.practiceSession.findUnique({
      where: { userId_startRequestId: { userId: a.id, startRequestId: c.requestId } },
      include: { student: true },
    });
    if (receipt) {
      if (receipt.student.userId !== a.id) throw missing();
      if (canonical(receipt.startInput) !== canonical(c))
        throw conflict("该领取请求编号已用于不同资料或学生身份。");
      return { id: receipt.id, sessionId: receipt.id, version: 1, draftVersion: 0 };
    }
    const student = await db.classroomStudent.findUnique({
      where: { id: c.source.studentId },
      include: { classroom: true },
    });
    if (!student || student.userId !== a.id) throw missing();
    let value: PracticeFrozenPaper,
      setId: string | null = null,
      sourceVersion: string,
      name: string;
    if (c.source.kind === "SET") {
      const set = await db.practiceSet.findUnique({ where: { id: c.source.setId } });
      if (!set || set.classroomId !== student.classroomId) throw missing();
      if (set.version !== c.source.expectedVersion || set.status !== "OPEN")
        throw conflict("题集已关闭或版本变化，不能新领取。");
      value = frozen(set);
      setId = set.id;
      sourceVersion = String(set.version);
      name = set.name;
    } else {
      const raw = await db.paper.findUnique({ where: { id: c.source.paperId } });
      if (!raw || raw.ownerId !== a.id || raw.kind !== "HOMEWORK") throw missing();
      if (raw.updatedAt.toISOString() !== c.source.expectedPaperUpdatedAt)
        throw conflict("复习资料已变化，请重新读取。");
      value = replayFrozen(paperDTO(raw));
      sourceVersion = c.source.expectedPaperUpdatedAt;
      name = raw.name;
    }
    const sources = await sourceItems(db, value.paper, value);
    const row = await db.practiceSession.create({
      data: {
        userId: a.id,
        studentId: student.id,
        classroomId: student.classroomId,
        identity: json({
          studentId: student.id,
          userId: a.id,
          name: student.name,
          studentNumber: student.studentNumber,
          classroomId: student.classroomId,
          classroomName: student.classroom.name,
          stage: student.classroom.stage,
          cohort: student.classroom.cohort,
        }),
        sourceKind: c.source.kind,
        setId,
        sourcePaperId: value.paper.id,
        sourceVersion,
        startRequestId: c.requestId,
        startInput: json(c),
        name,
        subject: value.paper.subject,
        frozenPaper: json(value),
        contentFingerprint: hash(value),
        sourceItems: json(sources),
        promptAssetUrls: promptAssetUrls(value),
        referenceAssetUrls: referenceAssetUrls(value),
      },
    });
    await audit(db, a, c.type, {
      sessionId: row.id,
      setId: setId ?? undefined,
      details: {
        changes: [
          c.source.kind === "REPLAY"
            ? "从已有完整复习资料建立复现练习；答案已可获取。"
            : "领取冻结题集并建立本人练习草稿。",
        ],
      },
    });
    return { id: row.id, sessionId: row.id, version: row.version, draftVersion: 0 };
  }
  if (
    c.type === "practice.self-assess" ||
    c.type === "practice.review.confirm" ||
    c.type === "practice.review.request"
  )
    return executeEvaluationCommand(db, a, c);
  const row = await sessionAccess(db, a, c.sessionId);
  if (!own(a, row)) throw missing();
  if (c.type === "practice.submit") {
    const prior = await db.practiceAttempt.findUnique({
      where: { sessionId_requestId: { sessionId: row.id, requestId: c.requestId } },
    });
    if (prior) {
      if (
        prior.sessionVersion !== c.expectedVersion ||
        prior.draftVersion !== c.expectedDraftVersion
      )
        throw conflict("该提交编号已用于不同草稿版本。");
      return {
        id: row.id,
        sessionId: row.id,
        version: prior.sessionVersion + 1,
        draftVersion: prior.draftVersion,
        attemptId: prior.id,
        sequence: prior.sequence,
      };
    }
    requireDraft(a, row, c.expectedVersion, c.expectedDraftVersion);
    const answers = row.draftAnswers as unknown as PracticeAnswer[];
    await validateAnswers(db, a, row, answers);
    const eligibilitySnapshot = await eligibility(db, row),
      sequence = (row.currentAttempt?.sequence ?? 0) + 1;
    const attempt = await db.practiceAttempt.create({
      data: {
        sessionId: row.id,
        sequence,
        requestId: c.requestId,
        sessionVersion: row.version,
        draftVersion: row.draftVersion,
        answers: json(answers),
        assetUrls: [...new Set(answers.flatMap((v) => v.images))],
        eligibility: json(eligibilitySnapshot),
        attemptFingerprint: hash({
          sessionId: row.id,
          sequence,
          contentFingerprint: row.contentFingerprint,
          answers,
        }),
        contentFingerprint: row.contentFingerprint,
        submittedAt: now,
      },
    });
    await db.practiceSession.update({
      where: { id: row.id },
      data: {
        status: "SUBMITTED",
        currentAttemptId: attempt.id,
        reviewRequestedAt: null,
        version: { increment: 1 },
      },
    });
    await recordExposure(
      db,
      row,
      frozen(row).paper.items.map((i) => i.id),
      "ATTEMPTED",
      "已提交不可变练习作答。",
    );
    await audit(db, a, c.type, {
      sessionId: row.id,
      details: {
        attemptId: attempt.id,
        changes: [`提交第 ${sequence} 次练习；资格按提交时可获取的答案渠道冻结。`],
      },
    });
    return {
      id: row.id,
      sessionId: row.id,
      version: row.version + 1,
      draftVersion: row.draftVersion,
      attemptId: attempt.id,
      sequence,
    };
  }
  if (row.version !== c.expectedVersion) throw conflict();
  if (c.type === "practice.draft.save") {
    requireDraft(a, row, c.expectedVersion, c.expectedDraftVersion);
    await validateAnswers(db, a, row, c.answers);
    await db.practiceSession.update({
      where: { id: row.id },
      data: {
        draftAnswers: json(c.answers),
        draftUpdatedAt: now,
        draftVersion: { increment: 1 },
        version: { increment: 1 },
      },
    });
    return {
      id: row.id,
      sessionId: row.id,
      version: row.version + 1,
      draftVersion: row.draftVersion + 1,
    };
  }
  if (c.type === "practice.retry") {
    if (row.status !== "SUBMITTED") throw conflict("当前已有草稿，请继续本轮作答。");
    await db.practiceSession.update({
      where: { id: row.id },
      data: {
        status: "DRAFT",
        draftAnswers: c.copyPreviousAnswers
          ? (row.currentAttempt!.answers as Prisma.InputJsonValue)
          : [],
        draftUpdatedAt: now,
        draftVersion: { increment: 1 },
        version: { increment: 1 },
        reviewRequestedAt: null,
      },
    });
    await audit(db, a, c.type, {
      sessionId: row.id,
      details: {
        attemptId: row.currentAttemptId,
        changes: ["建立重做草稿；旧提交和反馈保留，不作为新题独立证据。"],
      },
    });
    return {
      id: row.id,
      sessionId: row.id,
      version: row.version + 1,
      draftVersion: row.draftVersion + 1,
    };
  }
  const ids = frozen(row).paper.items.map((i) => i.id);
  if (c.itemIds.some((id) => !ids.includes(id)))
    throw new RequestError(400, "参考题目不属于本练习。");
  const revealedItemIds = [...new Set([...row.revealedItemIds, ...c.itemIds])];
  await recordExposure(
    db,
    row,
    c.itemIds,
    "REFERENCE_REVEALED",
    c.reason || "已请求提供参考答案。",
  );
  await db.practiceSession.update({
    where: { id: row.id },
    data: { revealedItemIds, version: { increment: 1 } },
  });
  await audit(db, a, c.type, {
    sessionId: row.id,
    reason: c.reason,
    details: { changes: [`提供 ${c.itemIds.length} 题参考；后续重做按答案已可获取标记。`] },
  });
  return {
    id: row.id,
    sessionId: row.id,
    version: row.version + 1,
    reference: references(frozen(row), c.itemIds),
  };
}
export async function executePracticeCommand(
  actor: Actor,
  input: unknown,
  options: { db?: Db } = {},
) {
  const c = parse(practiceCommandSchema, input),
    db = options.db ?? getDb();
  return "$transaction" in db
    ? db.$transaction((tx) => execute(tx, actor, c), { timeout: 60000 })
    : execute(db, actor, c);
}
