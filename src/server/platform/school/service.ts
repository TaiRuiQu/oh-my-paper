import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Actor } from "@/contracts/platform";
import {
  schoolCommandSchema,
  schoolDateSchema,
  schoolTimetableSchema,
  type SchoolLesson,
  type SchoolState,
  type SchoolTerm,
  type SchoolSchedule,
  type SchoolTimetableCheck,
} from "@/contracts/school";
import { getDb } from "@/server/db/client";
import { getActor, json, type Db } from "../access";
import { AccessError, RequestError } from "@/server/http/errors";
import {
  expandSchoolTimetable,
  findSchoolLessonConflicts,
  schoolDateRange,
  schoolMonday,
} from "@/lib/school-calendar";

export function canManageSchool(actor: SchoolState["actor"]) {
  return (
    actor.role === "ADMIN" ||
    (actor.role === "TEACHER" &&
      !!actor.teachingAssignments?.some((row) => row.role === "SCHOOL_ADMIN"))
  );
}
const notFound = () => new AccessError(404, "记录不存在或无权访问。");
const stale = () => new RequestError(409, "教务版本已更新，请重新读取并核对后保存。");
const invalid = (message: string) => new RequestError(400, message);
function termDTO(
  row: Awaited<ReturnType<Db["schoolTerm"]["findMany"]>>[number],
  manage: boolean,
): SchoolTerm {
  const { timetable, draftReason: _reason, publishedAt, ...term } = row;
  void _reason;
  return {
    ...term,
    publishedAt: publishedAt?.toISOString() ?? null,
    ...(manage ? { timetable: schoolTimetableSchema.parse(timetable) } : {}),
  };
}

export async function loadSchoolState(actor: Actor, db: Db = getDb()): Promise<SchoolState> {
  const current = await getActor(actor.id, db);
  const canManage = canManageSchool(current);
  const allTerms = await db.schoolTerm.findMany({ orderBy: { startDate: "desc" } });
  let terms = allTerms.map((row) => termDTO(row, canManage));
  if (!canManage) {
    const scope = await lessonScope(current, db);
    const publications = await db.schoolPublication.findMany({
      where: {
        OR: allTerms
          .filter((term) => term.publishedRevision !== null)
          .map((term) => ({ termId: term.id, revision: term.publishedRevision! })),
        lessons: { some: scope },
      },
    });
    terms = publications
      .map((publication) => {
        const source = allTerms.find((term) => term.id === publication.termId)!;
        return {
          id: source.id,
          yearId: source.yearId,
          name: publication.termName,
          startDate: publication.startDate,
          endDate: publication.endDate,
          weekOneMonday: publication.weekOneMonday,
          timezone: publication.timezone,
          archived: source.archived,
          revision: publication.revision,
          publishedRevision: publication.revision,
          publishedAt: publication.createdAt.toISOString(),
        };
      })
      .sort((a, b) => b.startDate.localeCompare(a.startDate));
  }
  const years = await db.schoolYear.findMany({
    where: canManage ? {} : { id: { in: [...new Set(terms.map((term) => term.yearId))] } },
    orderBy: { startDate: "desc" },
  });
  const base: SchoolState = {
    actor: current,
    canManage,
    years,
    terms,
    courses: [],
    rooms: [],
    offerings: [],
    classrooms: [],
    teachers: [],
    publications: [],
  };
  if (!canManage) return base;
  const [courses, rooms, offerings, classrooms, teachers, publications] = await Promise.all([
    db.schoolCourse.findMany({ orderBy: { name: "asc" } }),
    db.schoolRoom.findMany({ orderBy: { name: "asc" } }),
    db.schoolOffering.findMany(),
    db.classroom.findMany({
      select: { id: true, name: true, stage: true, cohort: true },
      orderBy: { name: "asc" },
    }),
    db.user.findMany({
      where: { role: { in: ["ADMIN", "TEACHER"] } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.schoolPublication.findMany({
      select: {
        id: true,
        termId: true,
        revision: true,
        createdAt: true,
        actorName: true,
        reason: true,
        lessonCount: true,
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  return {
    ...base,
    courses,
    rooms,
    offerings,
    classrooms,
    teachers,
    publications: publications.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
  };
}

async function lessonScope(
  current: SchoolState["actor"],
  db: Db,
): Promise<Prisma.SchoolPublishedLessonWhereInput> {
  if (canManageSchool(current)) return {};
  if (current.role === "TEACHER") return { teacherId: current.id };
  const students = await db.classroomStudent.findMany({
    where: { userId: current.id },
    select: { classroomId: true },
  });
  return { classroomId: { in: [...new Set(students.map((student) => student.classroomId))] } };
}

async function requireManager(actor: Actor, db: Db) {
  const current = await getActor(actor.id, db);
  if (!canManageSchool(current)) throw new AccessError(403, "需要学校教务管理权限。");
  return current;
}
async function latestPublishedLessons(db: Db, exceptTermId: string): Promise<SchoolLesson[]> {
  const terms = await db.schoolTerm.findMany({
    where: { id: { not: exceptTermId }, publishedRevision: { not: null } },
  });
  if (!terms.length) return [];
  const publications = await db.schoolPublication.findMany({
    where: { OR: terms.map((term) => ({ termId: term.id, revision: term.publishedRevision! })) },
    include: { lessons: true },
  });
  return publications.flatMap((publication) =>
    publication.lessons.map((row) => row.snapshot as unknown as SchoolLesson),
  );
}
async function check(db: Db, actor: Actor, termId: string): Promise<SchoolTimetableCheck> {
  const state = await loadSchoolState(actor, db);
  if (!state.canManage) throw new AccessError(403, "需要学校教务管理权限。");
  const term = state.terms.find((entry) => entry.id === termId);
  if (!term) throw notFound();
  const result = expandSchoolTimetable({ ...state, term, timetable: term.timetable! });
  const external = await latestPublishedLessons(db, termId);
  result.conflicts.push(
    ...findSchoolLessonConflicts([...result.lessons, ...external]).filter(
      (conflict) =>
        conflict.lessonIds.some((id) => result.lessons.some((lesson) => lesson.id === id)) &&
        conflict.lessonIds.some((id) => external.some((lesson) => lesson.id === id)),
    ),
  );
  return result;
}
export async function checkSchoolTimetable(
  actor: Actor,
  termId: string,
): Promise<SchoolTimetableCheck> {
  return getDb().$transaction(
    async (db) => {
      await db.$queryRaw`SELECT pg_advisory_xact_lock(7240132026::bigint)::text`;
      await requireManager(actor, db);
      return check(db, actor, termId);
    },
    { timeout: 20000 },
  );
}

export async function loadSchoolSchedule(
  actor: Actor,
  query: { termId: string; startDate: string; endDate: string },
  db: Db = getDb(),
): Promise<SchoolSchedule> {
  const current = await getActor(actor.id, db);
  if (!schoolDateRange(query.startDate, query.endDate)) throw invalid("查询日期无效或超过400天。");
  const term = await db.schoolTerm.findUnique({ where: { id: query.termId } });
  if (!term) throw notFound();
  const publication =
    term.publishedRevision === null
      ? null
      : await db.schoolPublication.findUnique({
          where: { termId_revision: { termId: term.id, revision: term.publishedRevision } },
        });
  const base: SchoolSchedule = {
    publicationId: publication?.id ?? null,
    termId: term.id,
    revision: publication?.revision ?? null,
    timezone: publication?.timezone ?? term.timezone,
    startDate: query.startDate,
    endDate: query.endDate,
    lessons: [],
    status: publication ? "PUBLISHED" : "UNPUBLISHED",
  };
  if (!publication) {
    if (!canManageSchool(current)) throw notFound();
    return base;
  }
  const scope = await lessonScope(current, db);
  if (
    !canManageSchool(current) &&
    !(await db.schoolPublishedLesson.count({ where: { publicationId: publication.id, ...scope } }))
  )
    throw notFound();
  const rows = await db.schoolPublishedLesson.findMany({
    where: {
      publicationId: publication.id,
      date: { gte: query.startDate, lte: query.endDate },
      ...scope,
    },
    orderBy: { date: "asc" },
  });
  base.lessons = rows
    .map((row) => row.snapshot as unknown as SchoolLesson)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  return base;
}

export async function executeSchoolCommand(
  actor: Actor,
  input: unknown,
): Promise<{ id: string; revision?: number; version?: number }> {
  const parsed = schoolCommandSchema.safeParse(input);
  if (!parsed.success) throw invalid(parsed.error.issues.map((issue) => issue.message).join("；"));
  const command = parsed.data;
  return getDb().$transaction(
    async (db) => {
      // Shared with account grant changes and the existing teaching commands.
      await db.$queryRaw`SELECT pg_advisory_xact_lock(7240132026::bigint)::text`;
      const current = await requireManager(actor, db);
      if (command.type === "school.year.save") {
        const { id, expectedVersion, ...data } = command.year;
        if (!schoolDateSchema.safeParse(data.startDate).success || data.startDate > data.endDate)
          throw invalid("学年起止日期无效。");
        if (id) {
          const previous = await db.schoolYear.findUnique({
            where: { id },
            include: { terms: true },
          });
          if (!previous) throw notFound();
          if (previous.version !== expectedVersion) throw stale();
          if (
            previous.terms.some(
              (term) => term.startDate < data.startDate || term.endDate > data.endDate,
            )
          )
            throw invalid("学年日期须覆盖已有全部学期。");
          const row = await db.schoolYear.update({
            where: { id },
            data: { ...data, version: { increment: 1 } },
          });
          return { id, version: row.version };
        }
        const row = await db.schoolYear.create({ data });
        return { id: row.id, version: row.version };
      }
      if (command.type === "school.course.save" || command.type === "school.room.save") {
        const course = command.type === "school.course.save";
        if (course) {
          const { id, expectedVersion, ...data } = command.course;
          if (id) {
            const previous = await db.schoolCourse.findUnique({ where: { id } });
            if (!previous) throw notFound();
            if (previous.version !== expectedVersion) throw stale();
            const row = await db.schoolCourse.update({
              where: { id },
              data: { ...data, version: { increment: 1 } },
            });
            return { id, version: row.version };
          }
          const row = await db.schoolCourse.create({ data });
          return { id: row.id, version: row.version };
        } else {
          const { id, expectedVersion, ...data } = command.room;
          if (id) {
            const previous = await db.schoolRoom.findUnique({ where: { id } });
            if (!previous) throw notFound();
            if (previous.version !== expectedVersion) throw stale();
            const row = await db.schoolRoom.update({
              where: { id },
              data: { ...data, version: { increment: 1 } },
            });
            return { id, version: row.version };
          }
          const row = await db.schoolRoom.create({ data });
          return { id: row.id, version: row.version };
        }
      }
      if (command.type === "school.term.save") {
        const { id, expectedRevision, ...data } = command.term;
        const year = await db.schoolYear.findUnique({ where: { id: data.yearId } });
        if (!year) throw notFound();
        if (
          !schoolDateRange(data.startDate, data.endDate) ||
          schoolMonday(data.startDate) !== data.weekOneMonday ||
          data.startDate < year.startDate ||
          data.endDate > year.endDate
        )
          throw invalid("学期须位于学年内且不超过400天，第一周周一须覆盖开学日。");
        const other = await db.schoolTerm.findFirst({
          where: { ...(id ? { id: { not: id } } : {}) },
        });
        if (other && other.timezone !== data.timezone)
          throw invalid("单校所有学期须使用同一学校时区。");
        if (id) {
          const previous = await db.schoolTerm.findUnique({ where: { id } });
          if (!previous) throw notFound();
          if (previous.revision !== expectedRevision) throw stale();
          if (previous.publishedRevision !== null && previous.yearId !== data.yearId)
            throw invalid("已发布学期不能更换所属学年，请建立新的学期。");
          if (previous.publishedRevision !== null && previous.timezone !== data.timezone)
            throw invalid("已有发布版本的学校时区不能修改。");
          const row = await db.schoolTerm.update({
            where: { id },
            data: { ...data, revision: { increment: 1 } },
          });
          return { id, revision: row.revision };
        }
        const row = await db.schoolTerm.create({ data });
        return { id: row.id, revision: row.revision };
      }
      const term = await db.schoolTerm.findUnique({ where: { id: command.termId } });
      if (!term) throw notFound();
      if (term.revision !== command.expectedRevision) throw stale();
      if (term.archived) throw new RequestError(409, "归档学期不能调整或发布，请先取消归档。");
      if (command.type === "school.offering.save") {
        const { id, ...data } = command.offering;
        const [course, classroom, teacher] = await Promise.all([
          db.schoolCourse.findUnique({ where: { id: data.courseId } }),
          db.classroom.findUnique({ where: { id: data.classroomId } }),
          db.user.findUnique({ where: { id: data.teacherId } }),
        ]);
        if (
          !course?.active ||
          !classroom ||
          !teacher ||
          !["TEACHER", "ADMIN"].includes(teacher.role)
        )
          throw invalid("课程、班级或授课教师不可用。");
        if (id && !(await db.schoolOffering.findFirst({ where: { id, termId: term.id } })))
          throw notFound();
        const row = id
          ? await db.schoolOffering.update({ where: { id }, data })
          : await db.schoolOffering.create({ data: { ...data, termId: term.id } });
        const updated = await db.schoolTerm.update({
          where: { id: term.id },
          data: { revision: { increment: 1 } },
        });
        return { id: row.id, revision: updated.revision };
      }
      if (command.type === "school.timetable.save") {
        const updated = await db.schoolTerm.update({
          where: { id: term.id },
          data: {
            timetable: json(command.timetable),
            draftReason: command.reason,
            revision: { increment: 1 },
          },
        });
        return { id: term.id, revision: updated.revision };
      }
      const result = await check(db, current, term.id);
      if (result.conflicts.length)
        throw new RequestError(
          409,
          `课表存在${result.conflicts.length}项冲突，请先检查并修正：${result.conflicts[0].message}`,
        );
      if (term.publishedRevision === term.revision)
        throw new RequestError(409, "当前版本已发布，无需重复发布。");
      const publication = await db.schoolPublication.create({
        data: {
          termId: term.id,
          revision: term.revision,
          timezone: term.timezone,
          startDate: term.startDate,
          endDate: term.endDate,
          termName: term.name,
          weekOneMonday: term.weekOneMonday,
          actorId: current.id,
          actorName: current.name,
          reason: command.reason,
          timetable: term.timetable as Prisma.InputJsonValue,
          lessonCount: result.lessons.filter((lesson) => lesson.status === "SCHEDULED").length,
        },
      });
      if (result.lessons.length)
        await db.schoolPublishedLesson.createMany({
          data: result.lessons.map((lesson) => ({
            publicationId: publication.id,
            offeringId: lesson.offeringId,
            classroomId: lesson.classroomId,
            teacherId: lesson.teacherId,
            courseId: lesson.courseId,
            roomId: lesson.roomId,
            date: lesson.date,
            snapshot: json(lesson),
          })),
        });
      await db.schoolTerm.update({
        where: { id: term.id },
        data: { publishedRevision: term.revision, publishedAt: publication.createdAt },
      });
      return { id: publication.id, revision: term.revision };
    },
    { timeout: 30000 },
  );
}
