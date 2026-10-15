import "server-only";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { assessmentRecord } from "./records";
import { getDb } from "@/server/db/client";
import { AccessError, RequestError } from "@/server/http/errors";
import type { Assessment, PlatformState, Role } from "./types";
import {
  canReadSubject,
  canReviewSubject,
  teachingAssignmentSchema,
} from "@/contracts/permissions";
export type Db = PrismaClient | Prisma.TransactionClient;
export const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export const missing = () => new AccessError(404, "记录不存在或无权访问。");
export async function getActor(userId: string, db: Db = getDb()): Promise<PlatformState["actor"]> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, role: true, teachingAssignments: true },
  });
  if (!user) throw new AccessError(401, "请先登录。");
  if (!["ADMIN", "TEACHER", "STUDENT"].includes(user.role))
    throw new AccessError(403, "账号角色无效，请联系管理员。");
  return {
    ...user,
    role: user.role as Role,
    teachingAssignments: user.teachingAssignments.map(toTeachingAssignment),
  };
}
export function toTeachingAssignment(row: {
  role: string;
  grade: string;
  classroomId: string | null;
  subject: string;
}) {
  return teachingAssignmentSchema.parse({
    role: row.role,
    ...(row.role === "GRADE_DIRECTOR" ? { grade: row.grade } : {}),
    ...(["HOMEROOM", "SUBJECT_TEACHER"].includes(row.role) ? { classroomId: row.classroomId } : {}),
    ...(row.role === "SUBJECT_TEACHER" ? { subject: row.subject } : {}),
  });
}
export function visibleClassrooms(a: PlatformState["actor"]): Prisma.ClassroomWhereInput {
  if (a.role === "ADMIN") return {};
  if (a.role === "STUDENT") return { students: { some: { userId: a.id } } };
  const assignments = a.teachingAssignments ?? [];
  if (assignments.some((row) => row.role === "SCHOOL_ADMIN")) return {};
  return {
    OR: assignments.map((row) =>
      row.role === "GRADE_DIRECTOR"
        ? { grade: row.grade }
        : "classroomId" in row
          ? { id: row.classroomId }
          : { id: { in: [] } },
    ),
  };
}
export const teacher = (a: PlatformState["actor"]) => {
  if (a.role === "STUDENT") throw new AccessError(403, "需要教师权限。");
};
export function owner<T extends { ownerId: string }>(
  a: PlatformState["actor"],
  record: T | null,
): T {
  if (!record || (a.role !== "ADMIN" && record.ownerId !== a.id)) throw missing();
  return record;
}
export async function canAssess(db: Db, a: PlatformState["actor"], id: string) {
  const row = await db.assessment.findUnique({ where: { id } });
  if (!row) throw missing();
  const assessment = assessmentRecord(row);
  if (a.role === "ADMIN") return assessment;
  const classes = await db.classroom.findMany({
    where: { AND: [{ id: { in: assessment.classroomIds } }, visibleClassrooms(a)] },
  });
  const papers = assessment.papers.filter((p) =>
    classes.some((c) => canReadSubject(a, c, p.subject)),
  );
  if (!papers.length) throw missing();
  return { ...assessment, papers, classroomIds: classes.map((c) => c.id) };
}
export async function canUseStudent(
  db: Db,
  a: PlatformState["actor"],
  classroomId: string,
  subject: string,
) {
  if (a.role === "ADMIN") return;
  const classroom = await db.classroom.findUnique({ where: { id: classroomId } });
  if (!classroom || !canReadSubject(a, classroom, subject)) throw missing();
  if (
    classroom.ownerId !== a.id &&
    !a.teachingAssignments?.some(
      (row) =>
        row.role === "SUBJECT_TEACHER" &&
        row.classroomId === classroomId &&
        row.subject === subject,
    )
  )
    throw missing();
}
export async function assertCanReview(
  db: Db,
  a: PlatformState["actor"],
  assessment: Pick<Assessment, "classroomIds"> & { reviewScope: string },
  classroomId: string,
  subject: string,
) {
  const classroom = await db.classroom.findUnique({ where: { id: classroomId } });
  const teachingClassrooms = await db.classroom.findMany({
    where: {
      id: {
        in: (a.teachingAssignments ?? []).flatMap((row) =>
          row.role === "SUBJECT_TEACHER" ? [row.classroomId] : [],
        ),
      },
    },
    select: { id: true, grade: true },
  });
  if (
    !classroom ||
    !canReviewSubject(
      a,
      { ...assessment, reviewScope: assessment.reviewScope as Assessment["reviewScope"] },
      classroom,
      subject,
      teachingClassrooms,
    )
  )
    throw missing();
}
export async function assertAssets(db: Db, a: PlatformState["actor"], urls: string[]) {
  for (const url of [...new Set(urls)]) {
    const match = /^\/api\/platform\/assets\/([\w-]+)$/.exec(url);
    if (!match) throw new RequestError(400, "图片和扫描件必须先上传到本站。");
    const asset = await db.platformAsset.findUnique({ where: { id: match[1] } });
    if (!asset || (a.role !== "ADMIN" && asset.ownerId !== a.id)) throw missing();
  }
}
