import type { SchoolState, SchoolTerm, SchoolTimetable } from "@/contracts/school";
export function calendarFixture() {
  const term: SchoolTerm = {
    id: "term",
    yearId: "year",
    name: "秋季",
    startDate: "2026-09-07",
    endDate: "2026-09-20",
    weekOneMonday: "2026-09-07",
    timezone: "Asia/Shanghai",
    archived: false,
    revision: 3,
    publishedRevision: null,
    publishedAt: null,
  };
  const timetable: SchoolTimetable = {
    periods: [
      { id: "p1", name: "第一节", startTime: "08:00", endTime: "08:40" },
      { id: "p2", name: "第二节", startTime: "08:40", endTime: "09:20" },
    ],
    slots: [
      {
        id: "slot",
        offeringId: "offering",
        weekday: 1,
        periodIds: ["p1"],
        roomId: "room",
        fromWeek: 1,
        toWeek: 2,
        parity: "ALL",
      },
    ],
    calendar: [],
    overrides: [],
  };
  const state: Pick<SchoolState, "courses" | "rooms" | "offerings" | "classrooms" | "teachers"> = {
    courses: [{ id: "course", version: 1, name: "体育", subject: null, active: true }],
    rooms: [{ id: "room", version: 1, name: "操场", capacity: null, active: true }],
    offerings: [
      {
        id: "offering",
        termId: "term",
        courseId: "course",
        classroomId: "class",
        teacherId: "teacher",
        weeklyPeriods: 1,
        active: true,
      },
    ],
    classrooms: [{ id: "class", name: "一班", stage: "小学", cohort: "2030" }],
    teachers: [
      { id: "teacher", name: "张老师" },
      { id: "substitute", name: "代课老师" },
    ],
  };
  return { ...state, term, timetable };
}
