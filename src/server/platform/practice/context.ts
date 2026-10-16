import "server-only";
import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import type { Actor, PlatformState } from "@/contracts/platform";
import type {
  PracticeAttemptSummary,
  PracticeEvaluation,
  PracticeFrozenPaper,
  PracticeIdentity,
  PracticeSessionSummary,
  PracticeSet,
} from "@/contracts/practice";
import { canReadSubject } from "@/contracts/permissions";
import { RequestError } from "@/server/http/errors";
import { getActor, missing, type Db } from "../access";
export const hash = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
export function canonical(value: unknown): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === "object" && !(v instanceof Date)
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, x]) => [k, sort(x)]),
          )
        : v;
  return JSON.stringify(sort(value));
}
export const conflict = (message = "练习版本已变化，请重新读取并比较；本次修改没有保存。") =>
  new RequestError(409, message);
export function parse<T>(
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
  value: unknown,
): T {
  const p = schema.safeParse(value);
  if (!p.success) throw new RequestError(400, "练习请求参数无效。");
  return p.data;
}
export const setInclude = {
  classroom: true,
  owner: { select: { name: true } },
} satisfies Prisma.PracticeSetInclude;
export const sessionInclude = {
  student: { include: { classroom: true } },
  classroom: true,
  set: { include: setInclude },
  currentAttempt: { include: { evaluations: { orderBy: { version: "asc" as const } } } },
  _count: { select: { attempts: true } },
} satisfies Prisma.PracticeSessionInclude;
export const sessionSummarySelect = {
  id: true,
  version: true,
  sourceKind: true,
  setId: true,
  name: true,
  subject: true,
  identity: true,
  userId: true,
  status: true,
  createdAt: true,
  currentAttemptId: true,
  reviewRequestedAt: true,
  student: { include: { classroom: true } },
  _count: { select: { attempts: true } },
  currentAttempt: {
    select: {
      id: true,
      sessionId: true,
      sequence: true,
      submittedAt: true,
      attemptFingerprint: true,
      contentFingerprint: true,
      eligibility: true,
      evaluations: { select: { version: true, source: true } },
    },
  },
} satisfies Prisma.PracticeSessionSelect;
export type SummaryRow = Prisma.PracticeSessionGetPayload<{ select: typeof sessionSummarySelect }>;
type AttemptSummaryRow = NonNullable<SummaryRow["currentAttempt"]>;
export const setSummarySelect = {
  id: true,
  version: true,
  name: true,
  subject: true,
  classroomId: true,
  classroomName: true,
  status: true,
  publishedAt: true,
  ownerId: true,
  owner: { select: { name: true } },
  classroom: true,
} satisfies Prisma.PracticeSetSelect;
export type SetSummaryRow = Prisma.PracticeSetGetPayload<{ select: typeof setSummarySelect }>;
export type SetRow = Prisma.PracticeSetGetPayload<{ include: typeof setInclude }>;
export type SessionRow = Prisma.PracticeSessionGetPayload<{ include: typeof sessionInclude }>;
export type AttemptRow = Prisma.PracticeAttemptGetPayload<{ include: { evaluations: true } }>;
export type CurrentActor = PlatformState["actor"];
export const frozen = (row: { frozenPaper: unknown }) => row.frozenPaper as PracticeFrozenPaper;
export const identity = (row: { identity: unknown }) => row.identity as PracticeIdentity;
export function own(actor: CurrentActor, row: Pick<SessionRow, "userId" | "student">) {
  return actor.role === "STUDENT" && row.userId === actor.id && row.student.userId === actor.id;
}
export function readTeacher(actor: CurrentActor, row: Pick<SessionRow, "student" | "subject">) {
  return actor.role !== "STUDENT" && canReadSubject(actor, row.student.classroom, row.subject);
}
export function reviewTeacher(actor: CurrentActor, row: Pick<SessionRow, "student" | "subject">) {
  return (
    actor.role === "ADMIN" ||
    (actor.role === "TEACHER" &&
      !!actor.teachingAssignments?.some(
        (g) =>
          g.role === "SUBJECT_TEACHER" &&
          g.classroomId === row.student.classroomId &&
          g.subject === row.subject,
      ))
  );
}
export function sessionScope(actor: CurrentActor): Prisma.PracticeSessionWhereInput {
  if (actor.role === "ADMIN") return {};
  if (actor.role === "STUDENT") return { userId: actor.id, student: { userId: actor.id } };
  return {
    AND: [
      { currentAttemptId: { not: null } },
      {
        OR: (actor.teachingAssignments ?? []).map((g): Prisma.PracticeSessionWhereInput => {
          if (g.role === "SCHOOL_ADMIN") return {};
          if (g.role === "GRADE_DIRECTOR")
            return { student: { classroom: { stage: g.stage, cohort: g.cohort } } };
          return {
            student: { classroomId: g.classroomId },
            ...(g.role === "SUBJECT_TEACHER" ? { subject: g.subject } : {}),
          };
        }),
      },
    ],
  };
}
export function setScope(actor: CurrentActor): Prisma.PracticeSetWhereInput {
  if (actor.role === "ADMIN") return {};
  if (actor.role === "STUDENT")
    return { status: "OPEN", classroom: { students: { some: { userId: actor.id } } } };
  return {
    OR: (actor.teachingAssignments ?? []).map((g): Prisma.PracticeSetWhereInput => {
      if (g.role === "SCHOOL_ADMIN") return {};
      if (g.role === "GRADE_DIRECTOR") return { classroom: { stage: g.stage, cohort: g.cohort } };
      return {
        classroomId: g.classroomId,
        ...(g.role === "SUBJECT_TEACHER" ? { subject: g.subject } : {}),
      };
    }),
  };
}
export async function sessionAccess(db: Db, actor: CurrentActor, id: string) {
  const row = await db.practiceSession.findUnique({ where: { id }, include: sessionInclude });
  if (!row || !(own(actor, row) || (row.currentAttemptId && readTeacher(actor, row))))
    throw missing();
  return row;
}
export async function attemptAccess(db: Db, actor: CurrentActor, id: string) {
  const attempt = await db.practiceAttempt.findUnique({
    where: { id },
    include: { evaluations: { orderBy: { version: "asc" } } },
  });
  if (!attempt) throw missing();
  return { attempt, row: await sessionAccess(db, actor, attempt.sessionId) };
}
export async function current(actor: Actor, db: Db) {
  return getActor(actor.id, db);
}
export function evaluationVersion(attempt: { evaluations: { version: number }[] }) {
  return Math.max(0, ...attempt.evaluations.map((e) => e.version));
}
export function teacherConfirmed(attempt: { evaluations: { source: string }[] }) {
  return attempt.evaluations.some((e) => e.source === "TEACHER_CONFIRMED");
}
export function evaluationDTO(e: Prisma.PracticeEvaluationGetPayload<object>): PracticeEvaluation {
  return {
    ...e,
    source: e.source as PracticeEvaluation["source"],
    createdAt: e.createdAt.toISOString(),
    evaluation: e.evaluation as unknown as PracticeEvaluation["evaluation"],
  };
}
export function summary(row: SummaryRow): PracticeSessionSummary {
  const evaluations = row.currentAttempt?.evaluations ?? [];
  return {
    id: row.id,
    version: row.version,
    sourceKind: row.sourceKind as "SET" | "REPLAY",
    setId: row.setId,
    name: row.name,
    subject: row.subject,
    student: identity(row),
    status: row.status as "DRAFT" | "SUBMITTED",
    createdAt: row.createdAt.toISOString(),
    submittedAt: row.currentAttempt?.submittedAt.toISOString() ?? null,
    currentAttemptId: row.currentAttemptId,
    attemptCount: row._count.attempts,
    reviewRequestedAt: row.reviewRequestedAt?.toISOString() ?? null,
    feedbackState:
      row.status === "DRAFT"
        ? "NONE"
        : evaluations.some((e) => e.source === "TEACHER_CONFIRMED")
          ? row.reviewRequestedAt
            ? "WAITING"
            : "TEACHER_CONFIRMED"
          : evaluations.some((e) => e.source === "AI_CANDIDATE")
            ? "AI_CANDIDATE"
            : evaluations.some((e) => e.source === "SELF")
              ? "SELF"
              : "WAITING",
  };
}
export function attemptDTO(
  actor: CurrentActor,
  row: SummaryRow,
  attempt: AttemptSummaryRow,
): PracticeAttemptSummary {
  const learner = own(actor, row),
    active = row.status === "SUBMITTED" && row.currentAttemptId === attempt.id,
    confirmed = teacherConfirmed(attempt);
  return {
    id: attempt.id,
    sessionId: row.id,
    sequence: attempt.sequence,
    submittedAt: attempt.submittedAt.toISOString(),
    attemptFingerprint: attempt.attemptFingerprint,
    contentFingerprint: attempt.contentFingerprint,
    evaluationVersion: evaluationVersion(attempt),
    eligibility: attempt.eligibility as unknown as PracticeAttemptSummary["eligibility"],
    canSelfAssess: learner && active && !confirmed,
    canRequestReview: learner && active,
    canRequestAi: (learner || reviewTeacher(actor, row)) && active && !confirmed,
    canConfirmReview: reviewTeacher(actor, row) && active,
    blockReasons: [
      ...(!active ? ["本轮已进入历史，不能用新草稿覆盖既有尝试。"] : []),
      ...(confirmed ? ["已有教师核验，自核和AI不能取代；更正须教师明确填写原因。"] : []),
    ],
  };
}
export function setDTO(actor: CurrentActor, row: SetSummaryRow, itemCount: number): PracticeSet {
  const teacher = actor.role !== "STUDENT" && canReadSubject(actor, row.classroom, row.subject);
  return {
    id: row.id,
    version: row.version,
    name: row.name,
    subject: row.subject,
    classroomId: row.classroomId,
    classroomName: row.classroomName,
    status: row.status as "OPEN" | "CLOSED",
    publishedAt: row.publishedAt.toISOString(),
    ownerName: row.owner.name,
    itemCount,
    canStart: actor.role === "STUDENT" && row.status === "OPEN",
    canClose:
      teacher && (actor.role === "ADMIN" || row.ownerId === actor.id) && row.status === "OPEN",
    blockReasons: row.status === "CLOSED" ? ["题集已关闭新领取，已有练习记录仍保留。"] : [],
  };
}
export async function audit(
  db: Prisma.TransactionClient,
  actor: CurrentActor,
  type: string,
  options: { sessionId?: string; setId?: string; reason?: string; details?: unknown } = {},
) {
  await db.practiceEvent.create({
    data: {
      sessionId: options.sessionId,
      setId: options.setId,
      type,
      actorId: actor.id,
      actorName: actor.name,
      reason: options.reason ?? "",
      details: JSON.parse(JSON.stringify(options.details ?? {})) as Prisma.InputJsonValue,
    },
  });
}
