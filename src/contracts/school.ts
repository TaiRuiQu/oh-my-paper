import { z } from "zod";
import type { PlatformState } from "./platform";

const id = z.string().min(1).max(128);
const name = z.string().trim().min(1).max(120);
const version = z.number().int().positive();
export const schoolDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "日期无效");
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const schoolTimezoneSchema = z
  .string()
  .max(80)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "学校时区无效");
export const schoolPeriodSchema = z
  .strictObject({ id, name, startTime: time, endTime: time })
  .refine((p) => p.startTime < p.endTime, "节次结束时间须晚于开始时间");
export const schoolSlotSchema = z
  .strictObject({
    id,
    offeringId: id,
    weekday: z.number().int().min(1).max(7),
    periodIds: z.array(id).min(1).max(12),
    roomId: id.nullable(),
    fromWeek: z.number().int().min(1).max(54),
    toWeek: z.number().int().min(1).max(54),
    parity: z.enum(["ALL", "ODD", "EVEN"]),
  })
  .refine((slot) => slot.fromWeek <= slot.toWeek, "教学周范围无效");
export const schoolCalendarDaySchema = z
  .strictObject({
    date: schoolDateSchema,
    kind: z.enum(["CLOSED", "REPLACE"]),
    sourceDate: schoolDateSchema.nullable(),
    reason: z.string().trim().min(1).max(500),
  })
  .refine(
    (day) => (day.kind === "CLOSED" ? day.sourceDate === null : day.sourceDate !== null),
    "补课须指定采用哪一天的课表，停课不填来源日期",
  );
export const schoolLessonOverrideSchema = z
  .strictObject({
    id,
    slotId: id,
    originalDate: schoolDateSchema,
    action: z.enum(["CANCEL", "MOVE"]),
    date: schoolDateSchema.nullable(),
    periodIds: z.array(id).max(12),
    teacherId: id.nullable(),
    roomId: id.nullable(),
    reason: z.string().trim().min(1).max(500),
  })
  .refine(
    (entry) =>
      entry.action === "CANCEL"
        ? entry.date === null && !entry.periodIds.length
        : entry.date !== null && entry.periodIds.length > 0,
    "调课须指定日期与节次，取消不填新日期或节次",
  );
export const schoolTimetableSchema = z
  .strictObject({
    periods: z.array(schoolPeriodSchema).max(30),
    slots: z.array(schoolSlotSchema).max(1000),
    calendar: z.array(schoolCalendarDaySchema).max(400),
    overrides: z.array(schoolLessonOverrideSchema).max(1000),
  })
  .superRefine((draft, ctx) => {
    for (const [kind, values] of [
      ["节次", draft.periods.map((p) => p.id)],
      ["课表", draft.slots.map((s) => s.id)],
      ["校历日期", draft.calendar.map((d) => d.date)],
      ["调课", draft.overrides.map((o) => o.id)],
      ["被调整课次", draft.overrides.map((o) => `${o.slotId}/${o.originalDate}`)],
    ] as const)
      if (new Set(values).size !== values.length)
        ctx.addIssue({ code: "custom", message: `${kind}不能重复` });
    for (const slot of draft.slots)
      if (new Set(slot.periodIds).size !== slot.periodIds.length)
        ctx.addIssue({ code: "custom", message: "同一连堂不能重复节次" });
    for (const entry of draft.overrides)
      if (new Set(entry.periodIds).size !== entry.periodIds.length)
        ctx.addIssue({ code: "custom", message: "调课不能重复节次" });
  });
export type SchoolTimetable = z.infer<typeof schoolTimetableSchema>;
export type SchoolPeriod = SchoolTimetable["periods"][number];
export type SchoolSlot = SchoolTimetable["slots"][number];
export type SchoolCalendarDay = SchoolTimetable["calendar"][number];
export type SchoolLessonOverride = SchoolTimetable["overrides"][number];

export const schoolCommandSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("school.year.save"),
    year: z.strictObject({
      id: id.optional(),
      expectedVersion: version.optional(),
      name,
      startDate: schoolDateSchema,
      endDate: schoolDateSchema,
    }),
  }),
  z.strictObject({
    type: z.literal("school.term.save"),
    term: z.strictObject({
      id: id.optional(),
      expectedRevision: version.optional(),
      yearId: id,
      name,
      startDate: schoolDateSchema,
      endDate: schoolDateSchema,
      weekOneMonday: schoolDateSchema,
      timezone: schoolTimezoneSchema,
      archived: z.boolean().default(false),
    }),
  }),
  z.strictObject({
    type: z.literal("school.course.save"),
    course: z.strictObject({
      id: id.optional(),
      expectedVersion: version.optional(),
      name,
      subject: z.string().trim().max(40).nullable(),
      active: z.boolean(),
    }),
  }),
  z.strictObject({
    type: z.literal("school.room.save"),
    room: z.strictObject({
      id: id.optional(),
      expectedVersion: version.optional(),
      name,
      capacity: z.number().int().min(1).max(10000).nullable(),
      active: z.boolean(),
    }),
  }),
  z.strictObject({
    type: z.literal("school.offering.save"),
    termId: id,
    expectedRevision: version,
    offering: z.strictObject({
      id: id.optional(),
      courseId: id,
      classroomId: id,
      teacherId: id,
      weeklyPeriods: z.number().int().min(1).max(50),
      active: z.boolean(),
    }),
  }),
  z.strictObject({
    type: z.literal("school.timetable.save"),
    termId: id,
    expectedRevision: version,
    reason: z.string().trim().min(1).max(500),
    timetable: schoolTimetableSchema,
  }),
  z.strictObject({
    type: z.literal("school.timetable.publish"),
    termId: id,
    expectedRevision: version,
    reason: z.string().trim().min(1).max(500),
  }),
]);
export type SchoolCommand = z.infer<typeof schoolCommandSchema>;
export type SchoolYear = {
  id: string;
  version: number;
  name: string;
  startDate: string;
  endDate: string;
};
export type SchoolCourse = {
  id: string;
  version: number;
  name: string;
  subject: string | null;
  active: boolean;
};
export type SchoolRoom = {
  id: string;
  version: number;
  name: string;
  capacity: number | null;
  active: boolean;
};
export type SchoolOffering = {
  id: string;
  termId: string;
  courseId: string;
  classroomId: string;
  teacherId: string;
  weeklyPeriods: number;
  active: boolean;
};
export type SchoolTerm = {
  id: string;
  yearId: string;
  name: string;
  startDate: string;
  endDate: string;
  weekOneMonday: string;
  timezone: string;
  archived: boolean;
  revision: number;
  publishedRevision: number | null;
  publishedAt: string | null;
  timetable?: SchoolTimetable;
};
export type SchoolLesson = {
  id: string;
  termId: string;
  offeringId: string;
  slotId: string;
  date: string;
  originalDate: string;
  startTime: string;
  endTime: string;
  periodNames: string[];
  courseId: string;
  courseName: string;
  classroomId: string;
  classroomName: string;
  teacherId: string;
  teacherName: string;
  roomId: string | null;
  roomName: string | null;
  status: "SCHEDULED" | "CANCELLED";
  reason: string;
};
export type SchoolConflict = {
  kind: "TEACHER" | "CLASSROOM" | "ROOM" | "CONFIGURATION";
  date: string | null;
  lessonIds: string[];
  message: string;
};
export type SchoolPublication = {
  id: string;
  termId: string;
  revision: number;
  createdAt: string;
  actorName: string;
  reason: string;
  lessonCount: number;
};
export type SchoolState = {
  actor: PlatformState["actor"];
  canManage: boolean;
  years: SchoolYear[];
  terms: SchoolTerm[];
  courses: SchoolCourse[];
  rooms: SchoolRoom[];
  offerings: SchoolOffering[];
  classrooms: { id: string; name: string; stage: string; cohort: string }[];
  teachers: { id: string; name: string }[];
  publications: SchoolPublication[];
};
export type SchoolSchedule = {
  publicationId: string | null;
  termId: string;
  revision: number | null;
  timezone: string;
  startDate: string;
  endDate: string;
  lessons: SchoolLesson[];
  status: "UNPUBLISHED" | "PUBLISHED";
};
// WEEK_CLOSED folds a fully closed week's expected per-offering shortfalls into one
// per-week advisory; SHORTFALL is a per-item gap on a week with teaching days.
export type SchoolTimetableWarning = {
  kind: "WEEK_CLOSED" | "SHORTFALL";
  week: number;
  message: string;
};
export type SchoolTimetableCheck = {
  revision: number;
  lessons: SchoolLesson[];
  conflicts: SchoolConflict[];
  warnings: SchoolTimetableWarning[];
};
