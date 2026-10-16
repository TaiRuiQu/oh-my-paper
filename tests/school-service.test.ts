import { beforeEach, expect, it, vi } from "vitest";
import type { Db } from "@/server/platform/access";
import type { SchoolState } from "@/contracts/school";
import { calendarFixture } from "./school-fixture";
const mocks = vi.hoisted(() => ({ getActor: vi.fn(), db: {} as Record<string, unknown> }));
vi.mock("@/server/db/client", () => ({ getDb: () => mocks.db }));
vi.mock("@/server/platform/access", async (original) => ({
  ...(await original<typeof import("@/server/platform/access")>()),
  getActor: mocks.getActor,
}));
import {
  executeSchoolCommand,
  loadSchoolSchedule,
  loadSchoolState,
  checkSchoolTimetable,
} from "@/server/platform/school/service";
const actor = { id: "manager" };
let tables: Record<string, Record<string, ReturnType<typeof vi.fn>>>;
let fixture: ReturnType<typeof calendarFixture>;
function db() {
  return mocks.db as unknown as Db;
}
beforeEach(() => {
  fixture = calendarFixture();
  tables = {};
  for (const name of [
    "schoolTerm",
    "schoolYear",
    "schoolCourse",
    "schoolRoom",
    "schoolOffering",
    "schoolPublication",
    "schoolPublishedLesson",
    "classroom",
    "classroomStudent",
    "user",
  ]) {
    tables[name] = Object.fromEntries(
      ["findMany", "findUnique", "findFirst", "count", "create", "createMany", "update"].map(
        (method) => [
          method,
          vi.fn().mockResolvedValue(method === "findMany" ? [] : method === "count" ? 0 : null),
        ],
      ),
    );
  }
  Object.assign(mocks.db, tables, {
    $queryRaw: vi.fn().mockResolvedValue([]),
    $transaction: vi.fn(async (callback: (tx: Db) => unknown) => callback(db())),
  });
  mocks.getActor.mockReset().mockResolvedValue({
    id: "manager",
    name: "教务",
    role: "TEACHER",
    teachingAssignments: [{ role: "SCHOOL_ADMIN" }],
  });
  tables.schoolTerm.findMany.mockResolvedValue([
    { ...fixture.term, timetable: fixture.timetable, draftReason: "草稿原因", publishedAt: null },
  ]);
  tables.schoolTerm.findUnique.mockResolvedValue({
    ...fixture.term,
    timetable: fixture.timetable,
    publishedAt: null,
  });
  tables.schoolYear.findMany.mockResolvedValue([
    { id: "year", version: 1, name: "学年", startDate: "2026-01-01", endDate: "2026-12-31" },
  ]);
  tables.schoolYear.findUnique.mockResolvedValue({
    id: "year",
    version: 1,
    startDate: "2026-01-01",
    endDate: "2026-12-31",
  });
  tables.schoolCourse.findMany.mockResolvedValue(fixture.courses);
  tables.schoolRoom.findMany.mockResolvedValue(fixture.rooms);
  tables.schoolOffering.findMany.mockResolvedValue(fixture.offerings);
  tables.classroom.findMany.mockResolvedValue(fixture.classrooms);
  tables.user.findMany.mockResolvedValue(fixture.teachers);
});
it("requires current grants after the shared transaction lock, rejecting an actor's stale manager role", async () => {
  mocks.getActor.mockResolvedValue({
    id: "manager",
    name: "撤权教师",
    role: "TEACHER",
    teachingAssignments: [],
  });
  await expect(
    executeSchoolCommand(
      { id: "manager", role: "ADMIN" },
      {
        type: "school.year.save",
        year: { name: "学年", startDate: "2026-01-01", endDate: "2026-12-31" },
      },
    ),
  ).rejects.toMatchObject({ status: 403 });
  expect(tables.schoolYear.create).not.toHaveBeenCalled();
  expect((mocks.db.$queryRaw as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]).toBeLessThan(
    mocks.getActor.mock.invocationCallOrder[0],
  );
});
it("blocks stale draft writes and archived-term writes without updating", async () => {
  await expect(
    executeSchoolCommand(actor, {
      type: "school.timetable.save",
      termId: "term",
      expectedRevision: 2,
      reason: "修改",
      timetable: fixture.timetable,
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(tables.schoolTerm.update).not.toHaveBeenCalled();
  tables.schoolTerm.findUnique.mockResolvedValue({ ...fixture.term, archived: true });
  await expect(
    executeSchoolCommand(actor, {
      type: "school.timetable.save",
      termId: "term",
      expectedRevision: 3,
      reason: "修改",
      timetable: fixture.timetable,
    }),
  ).rejects.toMatchObject({ status: 409 });
});
it("validates term boundaries, covering Monday, and the shared school timezone", async () => {
  const command = {
    type: "school.term.save",
    term: {
      yearId: "year",
      name: "学期",
      startDate: "2026-09-07",
      endDate: "2026-09-20",
      weekOneMonday: "2026-08-31",
      timezone: "Asia/Shanghai",
    },
  };
  await expect(executeSchoolCommand(actor, command)).rejects.toMatchObject({ status: 400 });
  command.term.weekOneMonday = "2026-09-07";
  tables.schoolTerm.findFirst.mockResolvedValue({ timezone: "Europe/London" });
  await expect(executeSchoolCommand(actor, command)).rejects.toMatchObject({ status: 400 });
  expect(tables.schoolTerm.create).not.toHaveBeenCalled();
});
it("retains immutable publication and actual lesson snapshots while later draft edits touch only term", async () => {
  tables.schoolPublication.create.mockImplementation(async ({ data }) => ({
    id: "publication",
    createdAt: new Date("2026-09-01T00:00Z"),
    ...data,
  }));
  const result = await executeSchoolCommand(actor, {
    type: "school.timetable.publish",
    termId: "term",
    expectedRevision: 3,
    reason: "首次发布",
  });
  expect(result).toEqual({ id: "publication", revision: 3 });
  const saved = tables.schoolPublishedLesson.createMany.mock.calls[0][0].data;
  expect(saved).toHaveLength(2);
  expect(saved[0]).toMatchObject({
    teacherId: "teacher",
    classroomId: "class",
    snapshot: { courseName: "体育", teacherName: "张老师", roomName: "操场", startTime: "08:00" },
  });
  tables.schoolTerm.update.mockResolvedValue({ ...fixture.term, revision: 4 });
  await executeSchoolCommand(actor, {
    type: "school.timetable.save",
    termId: "term",
    expectedRevision: 3,
    reason: "未发布修改",
    timetable: { ...fixture.timetable, slots: [] },
  });
  expect(tables.schoolPublication.create).toHaveBeenCalledTimes(1);
  expect(tables.schoolPublishedLesson.createMany).toHaveBeenCalledTimes(1);
  expect(saved[0].snapshot.courseName).toBe("体育");
});
it("returns structured cross-term conflicts and rejects publication in the same locked transaction", async () => {
  const { expandSchoolTimetable } = await import("@/lib/school-calendar");
  const lesson = {
    ...expandSchoolTimetable(fixture).lessons[0],
    id: "other-term-lesson",
    termId: "other",
  };
  tables.schoolTerm.findMany.mockImplementation(async (arg) =>
    arg?.where
      ? [{ id: "other", publishedRevision: 2 }]
      : [{ ...fixture.term, timetable: fixture.timetable, publishedAt: null }],
  );
  tables.schoolPublication.findMany.mockImplementation(async (arg) =>
    arg?.include ? [{ lessons: [{ snapshot: lesson }] }] : [],
  );
  const check = await checkSchoolTimetable(actor, "term");
  expect(check.conflicts.map((c) => c.kind)).toEqual(["TEACHER", "CLASSROOM", "ROOM"]);
  let rejection!: { status: number; message: string };
  await executeSchoolCommand(actor, {
    type: "school.timetable.publish",
    termId: "term",
    expectedRevision: 3,
    reason: "冲突发布",
  }).catch((cause: { status: number; message: string }) => {
    rejection = cause;
  });
  expect(rejection).toMatchObject({ status: 409 });
  expect(rejection.message).toContain("课表存在3项冲突，请先检查并修正：");
  expect(rejection.message).toContain(check.conflicts[0].message);
  expect(tables.schoolPublication.create).not.toHaveBeenCalled();
});
it.each(["TEACHER", "STUDENT"] as const)(
  "returns only %s published term snapshots with no draft or directory disclosure",
  async (role) => {
    mocks.getActor.mockResolvedValue({ id: "person", name: "本人", role, teachingAssignments: [] });
    tables.classroomStudent.findMany.mockResolvedValue([{ classroomId: "class" }]);
    const publication = {
      id: "published",
      termId: "term",
      revision: 2,
      termName: "已发布名称",
      timezone: "Asia/Shanghai",
      startDate: "2026-09-07",
      endDate: "2026-09-20",
      weekOneMonday: "2026-09-07",
      createdAt: new Date("2026-09-01T00:00Z"),
    };
    tables.schoolPublication.findMany.mockResolvedValue([publication]);
    const state: SchoolState = await loadSchoolState(actor, db());
    expect(state.terms[0]).toMatchObject({ name: "已发布名称", revision: 2 });
    expect(state.terms[0]).not.toHaveProperty("timetable");
    expect(JSON.stringify(state)).not.toContain("草稿原因");
    expect(state.courses.concat(state.rooms as never[])).toEqual([]);
    expect(state.teachers).toEqual([]);
    expect(state.classrooms).toEqual([]);
    expect(state.offerings).toEqual([]);
    expect(tables.schoolPublication.findMany.mock.lastCall?.[0].where.lessons.some).toEqual(
      role === "TEACHER" ? { teacherId: "person" } : { classroomId: { in: ["class"] } },
    );
  },
);
it.each(["TEACHER", "STUDENT"] as const)(
  "filters %s schedule at the database query and uses published snapshots",
  async (role) => {
    mocks.getActor.mockResolvedValue({ id: "person", name: "本人", role, teachingAssignments: [] });
    tables.classroomStudent.findMany.mockResolvedValue([{ classroomId: "class" }]);
    tables.schoolTerm.findUnique.mockResolvedValue({ ...fixture.term, publishedRevision: 2 });
    tables.schoolPublication.findUnique.mockResolvedValue({
      id: "published",
      revision: 2,
      timezone: "Asia/Shanghai",
    });
    tables.schoolPublishedLesson.count.mockResolvedValue(1);
    tables.schoolPublishedLesson.findMany.mockResolvedValue([
      {
        snapshot: {
          id: "saved",
          date: "2026-09-07",
          startTime: "08:00",
          teacherName: "发布时教师",
        },
      },
    ]);
    const result = await loadSchoolSchedule(
      actor,
      { termId: "term", startDate: "2026-09-07", endDate: "2026-09-13" },
      db(),
    );
    expect(result.revision).toBe(2);
    expect(result.lessons[0].teacherName).toBe("发布时教师");
    expect(tables.schoolPublishedLesson.findMany.mock.lastCall?.[0].where).toMatchObject(
      role === "TEACHER" ? { teacherId: "person" } : { classroomId: { in: ["class"] } },
    );
  },
);
it("rejects unpublished or unrelated terms for ordinary users and bounds schedule queries", async () => {
  mocks.getActor.mockResolvedValue({ id: "person", role: "TEACHER", teachingAssignments: [] });
  await expect(
    loadSchoolSchedule(
      actor,
      { termId: "term", startDate: "2026-09-07", endDate: "2026-09-13" },
      db(),
    ),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    loadSchoolSchedule(
      actor,
      { termId: "term", startDate: "2026-01-01", endDate: "2027-12-31" },
      db(),
    ),
  ).rejects.toMatchObject({ status: 400 });
});

it("does not allow published terms to move into a draft academic year", async () => {
  tables.schoolTerm.findUnique.mockResolvedValue({
    ...fixture.term,
    yearId: "original-year",
    publishedRevision: 2,
  });
  await expect(
    executeSchoolCommand(actor, {
      type: "school.term.save",
      term: {
        id: "term",
        expectedRevision: 3,
        yearId: "year",
        name: "新学期",
        startDate: fixture.term.startDate,
        endDate: fixture.term.endDate,
        weekOneMonday: fixture.term.weekOneMonday,
        timezone: fixture.term.timezone,
        archived: false,
      },
    }),
  ).rejects.toMatchObject({ status: 400 });
  expect(tables.schoolTerm.update).not.toHaveBeenCalled();
});
it("hides all unassigned and unpublished term metadata from ordinary teachers", async () => {
  mocks.getActor.mockResolvedValue({
    id: "unassigned",
    name: "未任课",
    role: "TEACHER",
    teachingAssignments: [],
  });
  tables.schoolYear.findMany.mockResolvedValue([]);
  const state = await loadSchoolState(actor, db());
  expect(state.terms).toEqual([]);
  expect(state.years).toEqual([]);
  expect(tables.schoolCourse.findMany).not.toHaveBeenCalled();
  expect(tables.user.findMany).not.toHaveBeenCalled();
});
it("returns the current manager's draft separately from the published revision", async () => {
  const state = await loadSchoolState(actor, db());
  expect(state.canManage).toBe(true);
  expect(state.terms[0].timetable).toEqual(fixture.timetable);
  expect(state.terms[0].revision).toBe(3);
  expect(state.teachers).toEqual(fixture.teachers);
});
it("warns about missing weekly allocation while allowing explicit publication without claiming it is fulfilled", async () => {
  fixture.offerings[0].weeklyPeriods = 5;
  tables.schoolPublication.create.mockResolvedValue({ id: "published", createdAt: new Date() });
  const result = await checkSchoolTimetable(actor, "term");
  expect(result.conflicts).toEqual([]);
  expect(result.warnings.map((w) => w.message).join()).toContain("已排1节，计划5节");
  await expect(
    executeSchoolCommand(actor, {
      type: "school.timetable.publish",
      termId: "term",
      expectedRevision: 3,
      reason: "先发布试行课表，课时待补足",
    }),
  ).resolves.toMatchObject({ id: "published" });
});
it.each(["course", "room"] as const)(
  "checks %s expectedVersion before changing the directory",
  async (kind) => {
    tables[kind === "course" ? "schoolCourse" : "schoolRoom"].findUnique.mockResolvedValue({
      version: 3,
    });
    const entry =
      kind === "course"
        ? { id: "course", expectedVersion: 2, name: "自定义课程", subject: null, active: true }
        : { id: "room", expectedVersion: 2, name: "实验室", capacity: 30, active: true };
    await expect(
      executeSchoolCommand(actor, { type: `school.${kind}.save`, [kind]: entry }),
    ).rejects.toMatchObject({ status: 409 });
  },
);
