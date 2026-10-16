import { expect, it } from "vitest";
import {
  expandSchoolTimetable,
  findSchoolLessonConflicts,
  schoolDateRange,
} from "@/lib/school-calendar";
import { calendarFixture } from "./school-fixture";

it("expands regular patterns by school civil dates with half-open adjacent periods", () => {
  const input = calendarFixture();
  input.timetable.slots[0].periodIds = ["p1", "p2"];
  const result = expandSchoolTimetable(input);
  expect(result.lessons.map((l) => `${l.date}/${l.startTime}`)).toEqual([
    "2026-09-07/08:00",
    "2026-09-07/08:40",
    "2026-09-14/08:00",
    "2026-09-14/08:40",
  ]);
  expect(result.conflicts).toEqual([]);
  expect(result.warnings[0].message).toContain("已排2节，计划1节");
});
it.each(["ODD", "EVEN"] as const)(
  "honors %s teaching weeks and replacement source week",
  (parity) => {
    const input = calendarFixture();
    input.timetable.slots[0].parity = parity;
    input.timetable.calendar = [
      { date: "2026-09-19", kind: "REPLACE", sourceDate: "2026-09-07", reason: "补第一周周一" },
    ];
    const dates = expandSchoolTimetable(input).lessons.map((l) => l.date);
    expect(dates).toEqual(parity === "ODD" ? ["2026-09-07", "2026-09-19"] : ["2026-09-14"]);
  },
);
it("keeps cancelled originals and publishes substituted moved lessons with exact names and times", () => {
  const input = calendarFixture();
  input.timetable.calendar = [
    { date: "2026-09-14", kind: "CLOSED", sourceDate: null, reason: "放假" },
  ];
  input.timetable.overrides = [
    {
      id: "move",
      slotId: "slot",
      originalDate: "2026-09-07",
      action: "MOVE",
      date: "2026-09-08",
      periodIds: ["p2"],
      teacherId: "substitute",
      roomId: null,
      reason: "临时代课",
    },
  ];
  const result = expandSchoolTimetable(input);
  expect(result.conflicts).toEqual([]);
  expect(result.lessons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ date: "2026-09-07", status: "CANCELLED", reason: "临时代课" }),
      expect.objectContaining({
        date: "2026-09-08",
        startTime: "08:40",
        teacherName: "代课老师",
        status: "SCHEDULED",
      }),
      expect.objectContaining({ date: "2026-09-14", status: "CANCELLED", reason: "放假" }),
    ]),
  );
});
it("reports teacher, classroom and room collisions by times rather than period IDs", () => {
  const input = calendarFixture();
  input.timetable.periods.push({
    id: "overlap",
    name: "交叠",
    startTime: "08:30",
    endTime: "09:00",
  });
  input.timetable.slots.push({ ...input.timetable.slots[0], id: "other", periodIds: ["overlap"] });
  const result = expandSchoolTimetable(input);
  expect(new Set(result.conflicts.map((c) => c.kind))).toEqual(
    new Set(["TEACHER", "CLASSROOM", "ROOM"]),
  );
  expect(result.conflicts.every((c) => c.lessonIds.length === 2)).toBe(true);
});
it("rejects nonexistent references, out-of-term calendar and closed-day moves structurally", () => {
  const input = calendarFixture();
  input.timetable.calendar = [
    { date: "2026-09-08", kind: "CLOSED", sourceDate: null, reason: "停课" },
  ];
  input.timetable.overrides = [
    {
      id: "bad",
      slotId: "slot",
      originalDate: "2026-09-07",
      action: "MOVE",
      date: "2026-09-08",
      periodIds: ["missing"],
      teacherId: null,
      roomId: null,
      reason: "调整",
    },
  ];
  const result = expandSchoolTimetable(input);
  expect(result.conflicts.every((c) => c.kind === "CONFIGURATION")).toBe(true);
  expect(result.conflicts.map((c) => c.message).join()).toContain("目标日已停课");
});
it("rejects overrides that reference a valid slot on a day without that lesson", () => {
  const input = calendarFixture();
  input.timetable.overrides = [
    {
      id: "bad",
      slotId: "slot",
      originalDate: "2026-09-08",
      action: "CANCEL",
      date: null,
      periodIds: [],
      teacherId: null,
      roomId: null,
      reason: "错误来源",
    },
  ];
  expect(expandSchoolTimetable(input).conflicts[0].message).toContain("没有对应课次");
});
it("names slot configuration conflicts by editor number, business fields and weekday", () => {
  const input = calendarFixture();
  input.timetable.slots.push({ ...input.timetable.slots[0], id: "slot-2", roomId: null });
  input.offerings[0].active = false;
  expect(expandSchoolTimetable(input).conflicts.map((c) => c.message)).toEqual([
    "周课表 1（一班 · 体育 · 张老师 · 周一）引用了不存在或停用的开课安排。",
    "周课表 2（一班 · 体育 · 张老师 · 周一）引用了不存在或停用的开课安排。",
  ]);
});
it("names a disabled offering course by class, course and teacher instead of its id", () => {
  const input = calendarFixture();
  input.courses[0].active = false;
  expect(expandSchoolTimetable(input).conflicts.map((c) => c.message)).toEqual([
    "开课任务（一班 · 体育 · 张老师）的课程、班级或授课教师已不可用。",
  ]);
});
it("locates dangling overrides and out-of-term dates by editor numbers without raw ids", () => {
  const input = calendarFixture();
  input.timetable.overrides = [
    {
      id: "gone",
      slotId: "deleted-slot",
      originalDate: "2026-09-07",
      action: "CANCEL",
      date: null,
      periodIds: [],
      teacherId: null,
      roomId: null,
      reason: "来源已删",
    },
    {
      id: "out",
      slotId: "slot",
      originalDate: "2026-08-01",
      action: "CANCEL",
      date: null,
      periodIds: [],
      teacherId: null,
      roomId: null,
      reason: "日期无效",
    },
  ];
  const messages = expandSchoolTimetable(input).conflicts.map((c) => c.message);
  expect(messages).toContain(
    "调代课 1 的原周课表已不存在（可能已被删除），请重新选择或删除该调代课。",
  );
  expect(messages).toContain("调代课 2（原周课表：周课表 1）的原定日期或调整后日期不在本学期内。");
  expect(messages.join()).not.toContain("gone");
});
it("labels an override whose original lesson is cancelled by the school calendar", () => {
  const input = calendarFixture();
  input.timetable.calendar = [
    { date: "2026-09-07", kind: "CLOSED", sourceDate: null, reason: "活动停课" },
  ];
  input.timetable.overrides = [
    {
      id: "same-day",
      slotId: "slot",
      originalDate: "2026-09-07",
      action: "CANCEL",
      date: null,
      periodIds: [],
      teacherId: null,
      roomId: null,
      reason: "同日取消",
    },
  ];
  expect(expandSchoolTimetable(input).conflicts.map((c) => c.message)).toEqual([
    "调代课 1（原周课表：周课表 1）的原课次已被校历停课，请移除该调代课或调整校历。",
  ]);
});
it("bounds date expansion and checks the exact covering Monday", () => {
  expect(schoolDateRange("2026-01-01", "2027-02-05")).toBe(false);
  const input = calendarFixture();
  input.term.weekOneMonday = "2026-08-31";
  expect(expandSchoolTimetable(input).conflicts[0].kind).toBe("CONFIGURATION");
});
it("finds cross-term resource collisions while ignoring retained cancelled records", () => {
  const result = expandSchoolTimetable(calendarFixture());
  const first = result.lessons[0];
  expect(
    findSchoolLessonConflicts([first, { ...first, id: "another-term", termId: "other" }]),
  ).toHaveLength(3);
  expect(
    findSchoolLessonConflicts([first, { ...first, id: "cancelled", status: "CANCELLED" }]),
  ).toEqual([]);
});
