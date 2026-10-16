import "server-only";
import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import type { Actor, PlatformState } from "@/contracts/platform";
import type {
  TeachingBinding,
  TeachingSession,
  TeachingRosterPreview,
  TeachingPlanVersion,
} from "@/contracts/teaching";
import type { SchoolLesson } from "@/contracts/school";
import { getActor, missing, type Db } from "../access";
import { AccessError, RequestError } from "@/server/http/errors";
import { canManageSchool } from "../school/service";
export const includeSession = {
  participants: true,
  plans: { orderBy: { version: "desc" } as const, take: 1 },
} satisfies Prisma.TeachingSessionInclude;
export type SessionRow = Prisma.TeachingSessionGetPayload<{ include: typeof includeSession }>;
export const conflict = (message = "课堂版本已更新，请重新读取并核对；不会自动重放本次修改。") =>
  new RequestError(409, message);
export async function teachingActor(actor: Actor, db: Db) {
  const current = await getActor(actor.id, db);
  if (current.role === "STUDENT")
    throw new AccessError(403, "课堂记录暂仅授课教师与学校教务管理者可用。");
  return current;
}
export async function currentBinding(
  db: Db,
  termId: string,
  slotId: string,
  originalDate: string,
): Promise<TeachingBinding | null> {
  const term = await db.schoolTerm.findUnique({ where: { id: termId } });
  if (!term || term.publishedRevision === null) return null;
  const publication = await db.schoolPublication.findUnique({
    where: { termId_revision: { termId, revision: term.publishedRevision } },
    include: {
      lessons: {
        where: {
          AND: [
            { snapshot: { path: ["slotId"], equals: slotId } },
            { snapshot: { path: ["originalDate"], equals: originalDate } },
          ],
        },
      },
    },
  });
  if (!publication) return null;
  const rows = publication.lessons.filter((row) => {
    const snapshot = row.snapshot as unknown as SchoolLesson;
    return (
      snapshot.slotId === slotId &&
      snapshot.originalDate === originalDate &&
      snapshot.status === "SCHEDULED"
    );
  });
  if (!rows.length) return null;
  rows.sort((a, b) => {
    const left = a.snapshot as unknown as SchoolLesson,
      right = b.snapshot as unknown as SchoolLesson;
    return (
      left.date.localeCompare(right.date) ||
      left.startTime.localeCompare(right.startTime) ||
      a.id.localeCompare(b.id)
    );
  });
  const lessons = rows.map((row) => row.snapshot as unknown as SchoolLesson);
  if (
    new Set(lessons.map((lesson) => `${lesson.classroomId}/${lesson.teacherId}/${lesson.courseId}`))
      .size !== 1
  )
    throw conflict("同一课堂的连堂课次须属于同一教师、班级与课程，请先调整发布课表。");
  return {
    publicationId: publication.id,
    publicationRevision: publication.revision,
    timezone: publication.timezone,
    lessonIds: rows.map((row) => row.id),
    lessons,
  };
}
export function sameClassroomCourse(left: TeachingBinding, right: TeachingBinding | null) {
  return (
    !!right &&
    left.lessons[0]?.classroomId === right.lessons[0]?.classroomId &&
    left.lessons[0]?.courseId === right.lessons[0]?.courseId
  );
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  return value;
}
export function sameBinding(left: TeachingBinding, right: TeachingBinding | null) {
  return !!right && JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}
export function planDTO(plan: SessionRow["plans"][number]): TeachingPlanVersion {
  return {
    ...plan,
    source: plan.source as "HUMAN" | "AI",
    plan: plan.plan as unknown as TeachingPlanVersion["plan"],
    createdAt: plan.createdAt.toISOString(),
  };
}
export async function sessionAccess(db: Db, current: PlatformState["actor"], id: string) {
  const row = await db.teachingSession.findUnique({ where: { id }, include: includeSession });
  if (!row) throw missing();
  const binding = row.binding as unknown as TeachingBinding;
  const term = await db.schoolTerm.findUnique({ where: { id: row.termId } });
  const archived = term?.archived === true;
  const latest = await currentBinding(db, row.termId, row.slotId, row.originalDate);
  const manager = canManageSchool(current);
  const assigned =
    sameClassroomCourse(binding, latest) && latest?.lessons[0]?.teacherId === current.id;
  const historical =
    (row.startedAt !== null || row.status === "CANCELLED") && row.teacherId === current.id;
  if (!manager && !(row.status === "NOT_STARTED" && assigned) && !historical) throw missing();
  const rosterCurrent =
    row.status !== "NOT_STARTED" ||
    !row.rosterConfirmed ||
    (await rosterPreview(db, row)).fingerprint === row.rosterFingerprint;
  return { row, binding, latest, manager, assigned, current, archived, rosterCurrent };
}
export function sessionDTO(access: Awaited<ReturnType<typeof sessionAccess>>): TeachingSession {
  const { row, binding, latest, manager, assigned, current, archived, rosterCurrent } = access;
  const scheduleChanged = !sameBinding(binding, latest);
  const active = row.status === "IN_PROGRESS" || row.status === "INTERRUPTED";
  const notStarted = row.status === "NOT_STARTED";
  const owner = row.teacherId === latest?.lessons[0]?.teacherId;
  const writable =
    !(notStarted && archived) &&
    (manager ||
      (notStarted ? assigned && owner : row.startedAt !== null && row.teacherId === current.id));
  const bound = !scheduleChanged;
  const planReady =
    row.confirmedPlanVersion !== null &&
    row.confirmedPlanVersion === row.planVersion &&
    row.plans[0]?.bindingVersion === row.bindingVersion;
  const hasExpected = row.participants.some(
    (participant) => participant.rosterStatus === "EXPECTED",
  );
  const unmarked = row.participants.some(
    (participant) =>
      participant.rosterStatus === "EXPECTED" && participant.attendance === "UNMARKED",
  );
  const reasons: string[] = [];
  if (notStarted && !sameClassroomCourse(binding, latest))
    reasons.push("原课堂的班级或课程已变化，请使用新课表编号另建课堂，不能转移原始记录。");
  if (notStarted && archived) reasons.push("归档学期的未开始课堂已暂停准备与开课。");
  if (!writable && !(notStarted && archived))
    reasons.push("当前账号不是本次已发布课次的授课教师，历史记录仅供查看。");
  if (scheduleChanged && notStarted)
    reasons.push("已发布课表已变化，请明确重新绑定并核对教案与名单。");
  if (!planReady) reasons.push("教案尚未确认当前版本。");
  if (!rosterCurrent) reasons.push("班级名册已变化，请重新预览差异并明确调整课堂名单。");
  if (!row.rosterConfirmed) reasons.push("课堂名单尚未核对确认。");
  else if (!hasExpected) reasons.push("至少保留一位本次应到学生后才能开课。");
  if (active && unmarked) reasons.push("仍有应到学生未登记出勤，请逐人核对后结束。");
  return {
    id: row.id,
    termId: row.termId,
    slotId: row.slotId,
    originalDate: row.originalDate,
    version: row.version,
    bindingVersion: row.bindingVersion,
    status: row.status as TeachingSession["status"],
    binding,
    planVersion: row.planVersion,
    confirmedPlanVersion: row.confirmedPlanVersion,
    plan: row.plans[0] ? planDTO(row.plans[0]) : null,
    rosterFingerprint: row.rosterFingerprint,
    rosterConfirmed: row.rosterConfirmed,
    participants: row.participants.map((participant) => ({
      ...participant,
      rosterStatus: participant.rosterStatus as "EXPECTED" | "EXCLUDED",
      attendance: participant.attendance as TeachingSession["participants"][number]["attendance"],
    })),
    summary: row.summary,
    reflection: row.reflection,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    interruptedAt: row.interruptedAt?.toISOString() ?? null,
    currentSchedule: latest,
    scheduleChanged,
    canPrepare: writable && notStarted && bound,
    canRebind:
      notStarted &&
      !archived &&
      sameClassroomCourse(binding, latest) &&
      (manager || assigned) &&
      !bound,
    canCancel: notStarted && writable,
    canManageRoster: writable && (active || (notStarted && bound)),
    canTakeAttendance:
      writable && row.rosterConfirmed && hasExpected && (active || (notStarted && bound)),
    canStart:
      writable &&
      notStarted &&
      bound &&
      planReady &&
      row.rosterConfirmed &&
      hasExpected &&
      rosterCurrent,
    canFinish: writable && active && !unmarked,
    canCorrect: (manager || historicalTeacher(access)) && row.status === "COMPLETED",
    blockReasons: reasons,
  };
}
function historicalTeacher(access: Awaited<ReturnType<typeof sessionAccess>>) {
  return access.row.startedAt !== null && access.row.teacherId === access.current.id;
}
export async function rosterPreview(db: Db, row: SessionRow): Promise<TeachingRosterPreview> {
  const binding = row.binding as unknown as TeachingBinding;
  const classroomId = binding.lessons[0].classroomId;
  const classroom = await db.classroom.findUnique({
    where: { id: classroomId },
    include: { students: { orderBy: { id: "asc" } } },
  });
  if (!classroom) throw missing();
  const candidates = classroom.students.map((student) => ({
    studentId: student.id,
    name: student.name,
    studentNumber: student.studentNumber,
    classroomId,
    classroomName: classroom.name,
  }));
  const fingerprint = createHash("sha256").update(JSON.stringify(candidates)).digest("hex");
  return {
    sessionId: row.id,
    fingerprint,
    candidates,
    addedStudentIds: candidates
      .filter(
        (student) =>
          !row.participants.some((participant) => participant.studentId === student.studentId),
      )
      .map((student) => student.studentId),
    removedParticipantIds: row.participants
      .filter(
        (participant) =>
          participant.rosterStatus === "EXPECTED" &&
          !candidates.some((student) => student.studentId === participant.studentId),
      )
      .map((participant) => participant.id),
  };
}
