import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { Actor } from "@/contracts/platform";
import {
  practiceEvidenceQuerySchema,
  type PracticeEvidence,
  type PracticeEvidenceItem,
} from "@/contracts/practice";
import { canReadSubject } from "@/contracts/permissions";
import { getDb } from "@/server/db/client";
import { missing, type Db } from "../access";
import { schoolTimezone } from "../school-timezone";
import { current, parse, type CurrentActor } from "./context";

/** SQL scopes use the student's current classroom, never the frozen display identity. */
function actorScope(a: CurrentActor) {
  if (a.role === "ADMIN") return Prisma.sql`TRUE`;
  if (a.role === "STUDENT") return Prisma.sql`s."userId" = ${a.id} AND st."userId" = ${a.id}`;
  const grants = (a.teachingAssignments ?? []).map((g) =>
    g.role === "SCHOOL_ADMIN"
      ? Prisma.sql`TRUE`
      : g.role === "GRADE_DIRECTOR"
        ? Prisma.sql`cl.stage = ${g.stage} AND cl.cohort = ${g.cohort}`
        : g.role === "SUBJECT_TEACHER"
          ? Prisma.sql`st."classroomId" = ${g.classroomId} AND s.subject = ${g.subject}`
          : Prisma.sql`st."classroomId" = ${g.classroomId}`,
  );
  return grants.length
    ? Prisma.sql`(${Prisma.join(
        grants.map((g) => Prisma.sql`(${g})`),
        " OR ",
      )})`
    : Prisma.sql`FALSE`;
}
const joins = Prisma.sql`FROM practice_evidence e JOIN practice_evaluations ev ON ev.id=e."evaluationId" JOIN practice_attempts a ON a.id=ev."attemptId" JOIN practice_sessions s ON s.id=e."sessionId" JOIN classroom_students st ON st.id=s."studentId" JOIN classrooms cl ON cl.id=st."classroomId"`;
type EvidenceRow = {
  id: string;
  attemptId: string;
  sessionId: string;
  itemId: string;
  partId: string;
  subject: string;
  knowledgeTags: string[];
  judgment: PracticeEvidenceItem["judgment"];
  source: PracticeEvidenceItem["source"];
  eligibility: PracticeEvidenceItem["eligibility"];
  evaluationId: string;
  evaluationVersion: number;
  recordedAt: Date;
};
type Counts = {
  distinctQuestions: bigint;
  unexposedQuestions: bigint;
  repeatedOrAssistedQuestions: bigint;
  selfAssessed: bigint;
  aiCandidates: bigint;
  teacherConfirmed: bigint;
  lastEvidenceAt: Date | null;
};
export async function loadPracticeEvidence(
  actor: Actor,
  input: unknown = {},
  db: Db = getDb(),
): Promise<PracticeEvidence> {
  const [a, timezone] = await Promise.all([current(actor, db), schoolTimezone(db)]),
    q = parse(practiceEvidenceQuerySchema, input);
  const student = q.studentId
    ? await db.classroomStudent.findUnique({
        where: { id: q.studentId },
        include: { classroom: true },
      })
    : a.role === "STUDENT"
      ? await db.classroomStudent.findFirst({
          where: { userId: a.id },
          orderBy: { id: "asc" },
          include: { classroom: true },
        })
      : null;
  if (!student || (a.role === "STUDENT" && student.userId !== a.id)) throw missing();
  if (a.role !== "STUDENT" && !canReadSubject(a, student.classroom, q.subject)) throw missing();
  const scope = Prisma.sql`${actorScope(a)} AND s."studentId" = ${student.id} ${q.subject ? Prisma.sql`AND s.subject = ${q.subject}` : Prisma.empty}`;
  // A correction replaces the effective projection only. Every old evaluation/evidence row remains immutable in history.
  const effective = Prisma.sql`${scope} AND ev.version = (SELECT MAX(newer.version) FROM practice_evaluations newer WHERE newer."attemptId"=a.id) AND NOT (ev.source='TEACHER_CONFIRMED' AND s."currentAttemptId"=a.id AND s."reviewRequestedAt" IS NOT NULL)`;
  const [cursor] = q.beforeId
    ? await db.$queryRaw<{ id: string; recordedAt: Date }[]>(
        Prisma.sql`SELECT e.id,e."recordedAt" ${joins} WHERE ${effective} AND e.id=${q.beforeId} LIMIT 1`,
      )
    : [];
  if (q.beforeId && !cursor) throw missing();
  const rows = await db.$queryRaw<EvidenceRow[]>(
    Prisma.sql`SELECT e.id,a.id AS "attemptId",e."sessionId",e."itemId",e."partId",e.subject,e."knowledgeTags",e.judgment,e.source,e.eligibility,e."evaluationId",ev.version AS "evaluationVersion",e."recordedAt" ${joins} WHERE ${effective} ${cursor ? Prisma.sql`AND (e."recordedAt" < ${cursor.recordedAt} OR (e."recordedAt" = ${cursor.recordedAt} AND e.id < ${cursor.id}))` : Prisma.empty} ORDER BY e."recordedAt" DESC,e.id DESC LIMIT ${q.limit + 1}`,
  );
  const [counts] = await db.$queryRaw<Counts[]>(
    Prisma.sql`SELECT COUNT(DISTINCT e."promptFingerprint") AS "distinctQuestions",COUNT(DISTINCT e."promptFingerprint") FILTER(WHERE e.eligibility='UNEXPOSED_IN_SYSTEM') AS "unexposedQuestions",COUNT(DISTINCT e."promptFingerprint") FILTER(WHERE e.eligibility<>'UNEXPOSED_IN_SYSTEM') AS "repeatedOrAssistedQuestions",COUNT(DISTINCT e."promptFingerprint") FILTER(WHERE e.source='SELF') AS "selfAssessed",COUNT(DISTINCT e."promptFingerprint") FILTER(WHERE e.source='AI_CANDIDATE') AS "aiCandidates",COUNT(DISTINCT e."promptFingerprint") FILTER(WHERE e.source='TEACHER_CONFIRMED') AS "teacherConfirmed",MAX(e."recordedAt") AS "lastEvidenceAt" ${joins} WHERE ${effective}`,
  );
  const [attempts] = await db.$queryRaw<{ count: bigint }[]>(
    Prisma.sql`SELECT COUNT(*) AS count FROM practice_attempts a JOIN practice_sessions s ON s.id=a."sessionId" JOIN classroom_students st ON st.id=s."studentId" JOIN classrooms cl ON cl.id=st."classroomId" WHERE ${scope}`,
  );
  const page = rows.slice(0, q.limit);
  return {
    actor: a,
    timezone,
    studentId: student.id,
    items: page.map((e) => ({
      attemptId: e.attemptId,
      sessionId: e.sessionId,
      itemId: e.itemId,
      subject: e.subject,
      knowledgeTags: e.knowledgeTags,
      judgment: e.judgment,
      source: e.source,
      eligibility: e.eligibility,
      evaluationId: e.evaluationId,
      evaluationVersion: e.evaluationVersion,
      partId: e.partId || null,
      recordedAt: e.recordedAt.toISOString(),
    })),
    summary: {
      submittedAttempts: Number(attempts?.count ?? 0),
      distinctQuestions: Number(counts?.distinctQuestions ?? 0),
      unexposedQuestions: Number(counts?.unexposedQuestions ?? 0),
      repeatedOrAssistedQuestions: Number(counts?.repeatedOrAssistedQuestions ?? 0),
      selfAssessed: Number(counts?.selfAssessed ?? 0),
      aiCandidates: Number(counts?.aiCandidates ?? 0),
      teacherConfirmed: Number(counts?.teacherConfirmed ?? 0),
      lastEvidenceAt: counts?.lastEvidenceAt?.toISOString() ?? null,
    },
    nextBeforeId: rows.length > q.limit ? page.at(-1)!.id : null,
  };
}
