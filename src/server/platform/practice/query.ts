import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { Actor } from "@/contracts/platform";
import {
  practiceSourcesQuerySchema,
  practiceSessionsQuerySchema,
  practiceReviewsQuerySchema,
  practiceHistoryQuerySchema,
  type PracticeSources,
  type PracticeSets,
  type PracticeSessions,
  type PracticeSetDetail,
  type PracticeSessionDetail,
  type PracticeAttemptDetail,
  type PracticeReviews,
  type PracticeHistory,
} from "@/contracts/practice";
import { getDb } from "@/server/db/client";
import { missing, type Db } from "../access";
import { schoolTimezone } from "../school-timezone";
import { studentPaper } from "../homework/context";
import {
  current,
  parse,
  setScope,
  setInclude,
  setSummarySelect,
  setDTO,
  sessionScope,
  sessionSummarySelect,
  sessionAccess,
  attemptAccess,
  summary,
  own,
  frozen,
  attemptDTO,
  evaluationDTO,
  type SessionRow,
} from "./context";
import { eligibility } from "./exposure";
import { references } from "./snapshot";

export async function loadPracticeSets(
  actor: Actor,
  input: unknown = {},
  db: Db = getDb(),
): Promise<PracticeSets> {
  const a = await current(actor, db),
    q = parse(practiceSourcesQuerySchema, input);
  const scope: Prisma.PracticeSetWhereInput = {
    AND: [
      setScope(a),
      ...(q.classroomId ? [{ classroomId: q.classroomId }] : []),
      ...(q.subject ? [{ subject: q.subject }] : []),
    ],
  };
  const cursor = q.beforeId
    ? await db.practiceSet.findFirst({
        where: { AND: [scope, { id: q.beforeId }] },
        select: { id: true, publishedAt: true },
      })
    : null;
  if (q.beforeId && !cursor) throw missing();
  const rows = await db.practiceSet.findMany({
    where: {
      AND: [
        scope,
        ...(cursor
          ? [
              {
                OR: [
                  { publishedAt: { lt: cursor.publishedAt } },
                  { publishedAt: cursor.publishedAt, id: { lt: cursor.id } },
                ],
              },
            ]
          : []),
      ],
    },
    select: setSummarySelect,
    orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
    take: q.limit + 1,
  });
  const counts = rows.length
    ? await db.$queryRaw<{ id: string; count: number }[]>(
        Prisma.sql`SELECT id,jsonb_array_length("frozenPaper"->'paper'->'items') AS count FROM practice_sets WHERE id IN (${Prisma.join(rows.map((r) => r.id))})`,
      )
    : [];
  return {
    actor: a,
    sets: rows
      .slice(0, q.limit)
      .map((r) => setDTO(a, r, counts.find((c) => c.id === r.id)?.count ?? 0)),
    nextBeforeId: rows.length > q.limit ? rows[q.limit - 1].id : null,
  };
}
export async function loadPracticeSources(
  actor: Actor,
  input: unknown = {},
  db: Db = getDb(),
): Promise<PracticeSources> {
  const a = await current(actor, db),
    q = parse(practiceSourcesQuerySchema, input),
    sets = await loadPracticeSets(a, q, db);
  const scope: Prisma.PaperWhereInput = {
    ...(a.role === "ADMIN" ? {} : { ownerId: a.id }),
    ...(a.role === "STUDENT" ? { kind: "HOMEWORK" } : {}),
    ...(q.subject ? { subject: q.subject } : {}),
  };
  const cursor = q.paperBeforeId
    ? await db.paper.findFirst({
        where: { AND: [scope, { id: q.paperBeforeId }] },
        select: { id: true, updatedAt: true },
      })
    : null;
  if (q.paperBeforeId && !cursor) throw missing();
  const papers = await db.paper.findMany({
    where: {
      AND: [
        scope,
        ...(cursor
          ? [
              {
                OR: [
                  { updatedAt: { lt: cursor.updatedAt } },
                  { updatedAt: cursor.updatedAt, id: { lt: cursor.id } },
                ],
              },
            ]
          : []),
      ],
    },
    select: { id: true, name: true, subject: true, updatedAt: true },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: q.limit + 1,
  });
  const counts = papers.length
    ? await db.$queryRaw<{ id: string; count: number }[]>(
        Prisma.sql`SELECT id,jsonb_array_length(items) AS count FROM papers WHERE id IN (${Prisma.join(papers.map((p) => p.id))})`,
      )
    : [];
  const summaries = papers.slice(0, q.limit).map((p) => ({
    id: p.id,
    name: p.name,
    subject: p.subject,
    updatedAt: p.updatedAt.toISOString(),
    itemCount: counts.find((c) => c.id === p.id)?.count ?? 0,
  }));
  const records =
    a.role === "STUDENT"
      ? await db.classroomStudent.findMany({
          where: { userId: a.id },
          include: { classroom: true },
          orderBy: { id: "asc" },
        })
      : [];
  return {
    actor: a,
    sets: sets.sets,
    replayPapers: a.role === "STUDENT" ? summaries : [],
    publishPapers: a.role !== "STUDENT" ? summaries : [],
    ownStudents: records.map((s) => ({
      studentId: s.id,
      userId: a.id,
      name: s.name,
      studentNumber: s.studentNumber,
      classroomId: s.classroomId,
      classroomName: s.classroom.name,
      stage: s.classroom.stage,
      cohort: s.classroom.cohort,
    })),
    canPublish: a.role !== "STUDENT",
    nextBeforeId: sets.nextBeforeId,
    nextPaperBeforeId: papers.length > q.limit ? papers[q.limit - 1].id : null,
  };
}
export async function loadPracticeSet(
  actor: Actor,
  id: string,
  db: Db = getDb(),
): Promise<PracticeSetDetail> {
  const a = await current(actor, db),
    row = await db.practiceSet.findFirst({
      where: { AND: [{ id }, setScope(a)] },
      include: setInclude,
    });
  if (!row) throw missing();
  return {
    actor: a,
    set: setDTO(a, row, frozen(row).paper.items.length),
    fullPaper: a.role === "STUDENT" ? null : frozen(row).paper,
    studentPaper: studentPaper(frozen(row)),
  };
}
export async function loadPracticeSessions(
  actor: Actor,
  input: unknown = {},
  db: Db = getDb(),
): Promise<PracticeSessions> {
  const a = await current(actor, db),
    q = parse(practiceSessionsQuerySchema, input);
  const scope: Prisma.PracticeSessionWhereInput = {
    AND: [
      sessionScope(a),
      ...(a.role !== "STUDENT" ? [{ currentAttemptId: { not: null } }] : []),
      ...(q.studentId ? [{ studentId: q.studentId }] : []),
      ...(q.setId ? [{ setId: q.setId }] : []),
      ...(q.status ? [{ status: q.status }] : []),
    ],
  };
  const cursor = q.beforeId
    ? await db.practiceSession.findFirst({
        where: { AND: [scope, { id: q.beforeId }] },
        select: { id: true, createdAt: true },
      })
    : null;
  if (q.beforeId && !cursor) throw missing();
  const rows = await db.practiceSession.findMany({
    where: {
      AND: [
        scope,
        ...(cursor
          ? [
              {
                OR: [
                  { createdAt: { lt: cursor.createdAt } },
                  { createdAt: cursor.createdAt, id: { lt: cursor.id } },
                ],
              },
            ]
          : []),
      ],
    },
    select: sessionSummarySelect,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: q.limit + 1,
  });
  return {
    actor: a,
    sessions: rows.slice(0, q.limit).map(summary),
    nextBeforeId: rows.length > q.limit ? rows[q.limit - 1].id : null,
  };
}
export async function loadPracticeSession(
  actor: Actor,
  id: string,
  db: Db = getDb(),
): Promise<PracticeSessionDetail> {
  const [a, timezone] = await Promise.all([current(actor, db), schoolTimezone(db)]),
    row = await sessionAccess(db, a, id),
    learner = own(a, row),
    editable = learner && row.status === "DRAFT";
  return {
    actor: a,
    timezone,
    session: summary(row),
    papers: [studentPaper(frozen(row))],
    draft: learner
      ? {
          version: row.draftVersion,
          answers: row.draftAnswers as unknown as import("@/contracts/practice").PracticeAnswer[],
          updatedAt: row.draftUpdatedAt?.toISOString() ?? null,
        }
      : null,
    currentAttempt: row.currentAttempt ? attemptDTO(a, row, row.currentAttempt) : null,
    evaluations: row.currentAttempt?.evaluations.map(evaluationDTO) ?? [],
    reference: learner
      ? row.revealedItemIds.length
        ? references(frozen(row), row.revealedItemIds)
        : null
      : references(
          frozen(row),
          frozen(row).paper.items.map((i) => i.id),
        ),
    revealedItemIds: learner ? row.revealedItemIds : [],
    eligibility: learner
      ? row.status === "SUBMITTED" && row.currentAttempt
        ? (row.currentAttempt
            .eligibility as unknown as import("@/contracts/practice").PracticeItemEligibility[])
        : await eligibility(db, row)
      : [],
    capabilities: {
      canSaveDraft: editable,
      canUpload: editable,
      canSubmit: editable,
      canRetry: learner && row.status === "SUBMITTED",
      canRevealReference: learner && row.revealedItemIds.length < frozen(row).paper.items.length,
      canViewHistory: true,
      blockReasons: editable
        ? []
        : [
            learner
              ? "本轮已经提交；重做会建立新的尝试，原记录保留。"
              : "学生草稿私有，教师仅可读取已提交证据。",
          ],
    },
  };
}
async function attemptDetail(
  a: Awaited<ReturnType<typeof current>>,
  row: SessionRow,
  attempt: Awaited<ReturnType<typeof attemptAccess>>["attempt"],
  timezone: string,
): Promise<PracticeAttemptDetail> {
  return {
    actor: a,
    timezone,
    session: summary(row),
    attempt: attemptDTO(a, row, attempt),
    papers: [studentPaper(frozen(row))],
    answers: attempt.answers as unknown as import("@/contracts/practice").PracticeAnswer[],
    reference: own(a, row)
      ? row.revealedItemIds.length
        ? references(frozen(row), row.revealedItemIds)
        : null
      : references(
          frozen(row),
          frozen(row).paper.items.map((i) => i.id),
        ),
    evaluations: attempt.evaluations.map(evaluationDTO),
  };
}
export async function loadPracticeReview(
  actor: Actor,
  id: string,
  db: Db = getDb(),
): Promise<PracticeAttemptDetail> {
  const [a, timezone] = await Promise.all([current(actor, db), schoolTimezone(db)]);
  if (a.role === "STUDENT") throw missing();
  const { row, attempt } = await attemptAccess(db, a, id);
  return attemptDetail(a, row, attempt, timezone);
}
export async function loadPracticeReviews(
  actor: Actor,
  input: unknown = {},
  db: Db = getDb(),
): Promise<PracticeReviews> {
  const [a, timezone] = await Promise.all([current(actor, db), schoolTimezone(db)]),
    q = parse(practiceReviewsQuerySchema, input);
  if (a.role === "STUDENT") throw missing();
  const scope: Prisma.PracticeSessionWhereInput = {
    AND: [
      sessionScope(a),
      { status: "SUBMITTED", currentAttemptId: { not: null } },
      ...(q.classroomId ? [{ student: { classroomId: q.classroomId } }] : []),
      ...(q.subject ? [{ subject: q.subject }] : []),
    ],
  };
  // The queue is ordered by the immutable current submission, not the age of the session or its UUID.
  const cursorRow = q.beforeId
    ? await db.practiceSession.findFirst({
        where: { AND: [scope, { currentAttemptId: q.beforeId }] },
        select: { currentAttempt: { select: { id: true, submittedAt: true } } },
      })
    : null;
  const cursor = cursorRow?.currentAttempt;
  if (q.beforeId && !cursor) throw missing();
  const rows = await db.practiceSession.findMany({
    where: {
      AND: [
        scope,
        ...(cursor
          ? [
              {
                currentAttempt: {
                  OR: [
                    { submittedAt: { lt: cursor.submittedAt } },
                    { submittedAt: cursor.submittedAt, id: { lt: cursor.id } },
                  ],
                },
              },
            ]
          : []),
      ],
    },
    select: sessionSummarySelect,
    orderBy: [{ currentAttempt: { submittedAt: "desc" } }, { currentAttempt: { id: "desc" } }],
    take: q.limit + 1,
  });
  return {
    actor: a,
    timezone,
    attempts: rows
      .slice(0, q.limit)
      .filter((r) => !!r.currentAttempt)
      .map((r) => ({ session: summary(r), attempt: attemptDTO(a, r, r.currentAttempt!) })),
    nextBeforeId: rows.length > q.limit ? rows[q.limit - 1].currentAttemptId : null,
  };
}
export async function loadPracticeHistory(
  actor: Actor,
  id: string,
  input: unknown = {},
  db: Db = getDb(),
): Promise<PracticeHistory> {
  const [a, timezone] = await Promise.all([current(actor, db), schoolTimezone(db)]),
    row = await sessionAccess(db, a, id),
    q = parse(practiceHistoryQuerySchema, input);
  if (q.attemptId) {
    const attempt = await db.practiceAttempt.findFirst({
      where: { id: q.attemptId, sessionId: row.id },
      include: { evaluations: { orderBy: { version: "asc" } } },
    });
    if (!attempt || (q.evaluationId && !attempt.evaluations.some((e) => e.id === q.evaluationId)))
      throw missing();
    const detail = await attemptDetail(a, row, attempt, timezone);
    return {
      sessionId: row.id,
      timezone,
      events: [],
      attempts: [
        {
          ...detail,
          evaluations: q.evaluationId
            ? detail.evaluations.filter((e) => e.id === q.evaluationId)
            : detail.evaluations,
        },
      ],
      nextBeforeId: null,
    };
  }
  const cursor = q.beforeId
    ? await db.practiceEvent.findFirst({
        where: { id: q.beforeId, sessionId: id },
        select: { sequence: true },
      })
    : null;
  if (q.beforeId && !cursor) throw missing();
  const events = await db.practiceEvent.findMany({
      where: { sessionId: id, ...(cursor ? { sequence: { lt: cursor.sequence } } : {}) },
      orderBy: { sequence: "desc" },
      take: q.limit + 1,
    }),
    page = events.slice(0, q.limit);
  const ids = page.flatMap((e) => {
    const v = e.details as { attemptId?: string };
    return v.attemptId ? [v.attemptId] : [];
  });
  const attempts = await db.practiceAttempt.findMany({
    where: { id: { in: ids }, sessionId: row.id },
    include: { evaluations: { orderBy: { version: "asc" } } },
    orderBy: { sequence: "desc" },
  });
  return {
    sessionId: id,
    timezone,
    events: page.map((e) => ({
      id: e.id,
      sessionId: e.sessionId,
      setId: e.setId,
      type: e.type,
      actorName: e.actorName,
      createdAt: e.createdAt.toISOString(),
      reason: e.reason,
      changes: Array.isArray((e.details as { changes?: unknown }).changes)
        ? (e.details as { changes: string[] }).changes
        : [],
    })),
    attempts: await Promise.all(
      attempts.map((attempt) => attemptDetail(a, row, attempt, timezone)),
    ),
    nextBeforeId: events.length > q.limit ? page.at(-1)!.id : null,
  };
}
export { loadPracticeEvidence } from "./evidence";
