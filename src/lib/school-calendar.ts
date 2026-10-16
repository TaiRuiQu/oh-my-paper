import type {
  SchoolConflict,
  SchoolLesson,
  SchoolState,
  SchoolTerm,
  SchoolTimetable,
  SchoolTimetableCheck,
  SchoolTimetableWarning,
} from "@/contracts/school";
import { schoolDateSchema, schoolTimetableSchema } from "@/contracts/school";

const DAY = 86_400_000;
const MAX_LESSONS = 50_000;
export const schoolWeekdayNames = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
export const schoolDayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY;
export const schoolDateAt = (day: number) => new Date(day * DAY).toISOString().slice(0, 10);
export function schoolMonday(date: string) {
  const day = schoolDayNumber(date);
  return schoolDateAt(day - ((new Date(day * DAY).getUTCDay() + 6) % 7));
}
export function schoolDateRange(start: string, end: string) {
  return (
    schoolDateSchema.safeParse(start).success &&
    schoolDateSchema.safeParse(end).success &&
    start <= end &&
    schoolDayNumber(end) - schoolDayNumber(start) < 400
  );
}

/** All compared lessons must use the same school timezone. Adjacent intervals do not overlap. */
export function findSchoolLessonConflicts(lessons: SchoolLesson[]): SchoolConflict[] {
  const groups = new Map<string, SchoolLesson[]>();
  const kinds = ["TEACHER", "CLASSROOM", "ROOM"] as const;
  for (const lesson of lessons) {
    if (lesson.status === "CANCELLED") continue;
    for (const kind of kinds) {
      const resource =
        kind === "TEACHER"
          ? lesson.teacherId
          : kind === "CLASSROOM"
            ? lesson.classroomId
            : lesson.roomId;
      if (!resource) continue;
      const key = `${kind}/${resource}/${lesson.date}`;
      const group = groups.get(key) ?? [];
      group.push(lesson);
      groups.set(key, group);
    }
  }
  const conflicts: SchoolConflict[] = [];
  for (const [key, group] of groups) {
    group.sort((a, b) => a.startTime.localeCompare(b.startTime));
    const kind = key.split("/")[0] as (typeof kinds)[number];
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length && group[j].startTime < group[i].endTime; j++) {
        conflicts.push({
          kind,
          date: group[i].date,
          lessonIds: [group[i].id, group[j].id],
          message: `${group[i].date} ${group[i].startTime}–${group[i].endTime} ${kind === "TEACHER" ? "教师" : kind === "CLASSROOM" ? "班级" : "教室"}与 ${group[j].startTime}–${group[j].endTime} 的课次重叠`,
        });
        if (conflicts.length >= 200) return conflicts;
      }
    }
  }
  return conflicts;
}

type CalendarInput = Pick<
  SchoolState,
  "offerings" | "courses" | "rooms" | "classrooms" | "teachers"
> & {
  term: SchoolTerm;
  timetable: SchoolTimetable;
};

/** Expand civil dates, without consulting the machine timezone or recursively applying replacement days. */
export function expandSchoolTimetable(input: CalendarInput): SchoolTimetableCheck {
  const { term } = input;
  const conflicts: SchoolConflict[] = [];
  const configuration = (message: string) => {
    if (!conflicts.some((entry) => entry.kind === "CONFIGURATION" && entry.message === message))
      conflicts.push({ kind: "CONFIGURATION", date: null, lessonIds: [], message });
  };
  const result = {
    revision: term.revision,
    lessons: [] as SchoolLesson[],
    conflicts,
    warnings: [] as SchoolTimetableWarning[],
  };
  if (
    !schoolDateRange(term.startDate, term.endDate) ||
    schoolMonday(term.startDate) !== term.weekOneMonday
  ) {
    configuration("学期日期须有效且不超过400天；第一周周一须为开学日所在周的周一。");
    return result;
  }
  const parsed = schoolTimetableSchema.safeParse(input.timetable);
  if (!parsed.success) {
    configuration(parsed.error.issues.map((issue) => issue.message).join("；"));
    return result;
  }
  const timetable = parsed.data;
  const periods = new Map(timetable.periods.map((entry) => [entry.id, entry]));
  const offerings = new Map(
    input.offerings.filter((entry) => entry.termId === term.id).map((entry) => [entry.id, entry]),
  );
  const courses = new Map(input.courses.map((entry) => [entry.id, entry]));
  const rooms = new Map(input.rooms.map((entry) => [entry.id, entry]));
  const classes = new Map(input.classrooms.map((entry) => [entry.id, entry]));
  const teachers = new Map(input.teachers.map((entry) => [entry.id, entry]));
  const days = new Map(timetable.calendar.map((entry) => [entry.date, entry]));
  const slots = new Map(timetable.slots.map((entry) => [entry.id, entry]));
  const inTerm = (date: string) => date >= term.startDate && date <= term.endDate;
  // Conflict messages must locate entries the way the editor names them: 周课表 N /
  // 调代课 N, numbered by position in these same arrays, plus business names.
  const offeringNames = (offeringId: string) => {
    const offering = offerings.get(offeringId);
    return offering
      ? [
          classes.get(offering.classroomId)?.name ?? "未知班级",
          courses.get(offering.courseId)?.name ?? "未知课程",
          teachers.get(offering.teacherId)?.name ?? "未知教师",
        ].join(" · ")
      : null;
  };
  const slotLabel = (index: number) => {
    const names = offeringNames(timetable.slots[index].offeringId);
    return names
      ? `周课表 ${index + 1}（${names} · ${schoolWeekdayNames[timetable.slots[index].weekday - 1]}）`
      : `周课表 ${index + 1}`;
  };
  const overrideLabel = (index: number) => {
    const slotIndex = timetable.slots.findIndex(
      (slot) => slot.id === timetable.overrides[index].slotId,
    );
    return slotIndex < 0
      ? `调代课 ${index + 1}`
      : `调代课 ${index + 1}（原周课表：周课表 ${slotIndex + 1}）`;
  };
  for (const day of timetable.calendar) {
    if (!inTerm(day.date) || (day.sourceDate && !inTerm(day.sourceDate)))
      configuration("校历日期与换日来源必须在本学期内。");
    if (day.date === day.sourceDate) configuration("补课来源不能是当天。");
  }
  for (const [index, slot] of timetable.slots.entries()) {
    const label = slotLabel(index);
    const offering = offerings.get(slot.offeringId);
    if (!offering || !offering.active) configuration(`${label}引用了不存在或停用的开课安排。`);
    if (
      offering &&
      (!courses.get(offering.courseId)?.active ||
        !classes.has(offering.classroomId) ||
        !teachers.has(offering.teacherId))
    ) {
      const names = offeringNames(slot.offeringId);
      configuration(
        `${names ? `开课任务（${names}）` : "关联开课任务"}的课程、班级或授课教师已不可用。`,
      );
    }
    if (slot.periodIds.some((id) => !periods.has(id)))
      configuration(`${label}引用了不存在的节次。`);
    if (slot.roomId && !rooms.get(slot.roomId)?.active)
      configuration(`${label}的教室不存在或已停用。`);
  }
  for (const [index, entry] of timetable.overrides.entries()) {
    const label = overrideLabel(index);
    if (!slots.has(entry.slotId))
      // A dangling source never carries the parenthesized slot reference, so the
      // bare label always ends in a number here.
      configuration(`${label} 的原周课表已不存在（可能已被删除），请重新选择或删除该调代课。`);
    else if (!inTerm(entry.originalDate) || (entry.date && !inTerm(entry.date)))
      configuration(`${label}的原定日期或调整后日期不在本学期内。`);
    if (entry.periodIds.some((id) => !periods.has(id)))
      configuration(`${label}引用了不存在的节次。`);
    if (entry.teacherId && !teachers.has(entry.teacherId))
      configuration(`${label}的代课教师不可用。`);
    if (entry.roomId && !rooms.get(entry.roomId)?.active) configuration(`${label}的教室不可用。`);
    if (entry.action === "MOVE" && entry.date && days.get(entry.date)?.kind === "CLOSED")
      configuration(`${label}的目标日已停课，请先修改校历。`);
  }
  if (conflicts.length) return result;
  const overrides = new Map(
    timetable.overrides.map((entry) => [`${entry.slotId}/${entry.originalDate}`, entry]),
  );
  const usedOverrides = new Set<string>();
  const weekly = new Map<string, number>();
  const weekOf = (date: string) =>
    Math.floor((schoolDayNumber(date) - schoolDayNumber(term.weekOneMonday)) / 7) + 1;
  for (let day = schoolDayNumber(term.startDate); day <= schoolDayNumber(term.endDate); day++) {
    const date = schoolDateAt(day);
    const calendar = days.get(date);
    const teachingDate = calendar?.kind === "REPLACE" ? calendar.sourceDate! : date;
    const week = weekOf(teachingDate);
    const weekday = ((new Date(`${teachingDate}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
    for (const slot of timetable.slots) {
      // Target days adopt the source day's regular pattern, including its source week/parity.
      if (
        slot.weekday !== weekday ||
        week < slot.fromWeek ||
        week > slot.toWeek ||
        (slot.parity === "ODD" && week % 2 === 0) ||
        (slot.parity === "EVEN" && week % 2 !== 0)
      )
        continue;
      const offering = offerings.get(slot.offeringId)!;
      const course = courses.get(offering.courseId)!;
      const classroom = classes.get(offering.classroomId)!;
      const base = {
        termId: term.id,
        offeringId: offering.id,
        slotId: slot.id,
        originalDate: date,
        courseId: course.id,
        courseName: course.name,
        classroomId: classroom.id,
        classroomName: classroom.name,
        teacherId: offering.teacherId,
        teacherName: teachers.get(offering.teacherId)!.name,
        roomId: slot.roomId,
        roomName: slot.roomId ? rooms.get(slot.roomId)!.name : null,
      };
      const override = overrides.get(`${slot.id}/${date}`);
      if (override) {
        usedOverrides.add(override.id);
        if (calendar?.kind === "CLOSED")
          configuration(
            `${overrideLabel(timetable.overrides.indexOf(override))}的原课次已被校历停课，请移除该调代课或调整校历。`,
          );
      }
      for (const periodId of slot.periodIds) {
        const period = periods.get(periodId)!;
        result.lessons.push({
          ...base,
          id: `${term.id}/${slot.id}/${date}/${periodId}`,
          date,
          startTime: period.startTime,
          endTime: period.endTime,
          periodNames: [period.name],
          status: calendar?.kind === "CLOSED" || override ? "CANCELLED" : "SCHEDULED",
          reason: override?.reason ?? calendar?.reason ?? "",
        });
      }
      if (override?.action === "MOVE") {
        for (const periodId of override.periodIds) {
          const period = periods.get(periodId)!;
          result.lessons.push({
            ...base,
            id: `${term.id}/override/${override.id}/${periodId}`,
            date: override.date!,
            startTime: period.startTime,
            endTime: period.endTime,
            periodNames: [period.name],
            teacherId: override.teacherId ?? base.teacherId,
            teacherName: override.teacherId
              ? teachers.get(override.teacherId)!.name
              : base.teacherName,
            roomId: override.roomId ?? base.roomId,
            roomName: override.roomId ? rooms.get(override.roomId)!.name : base.roomName,
            status: "SCHEDULED",
            reason: override.reason,
          });
        }
      }
      if (!calendar) {
        const key = `${offering.id}/${week}`;
        weekly.set(key, (weekly.get(key) ?? 0) + slot.periodIds.length);
      }
      if (result.lessons.length > MAX_LESSONS) {
        configuration(`实际课次超过${MAX_LESSONS}条，请缩小课表规模。`);
        result.lessons = [];
        return result;
      }
    }
  }
  for (const [index, entry] of timetable.overrides.entries())
    if (!usedOverrides.has(entry.id))
      configuration(
        `${overrideLabel(index)}的原日期没有对应课次（请核对教学周、单双周或校历换日）。`,
      );
  // Weekly targets are advisory, never represented as a successfully fulfilled allocation.
  const maxWeek = weekOf(term.endDate);
  // A week whose every in-term civil day is CLOSED has no effective teaching days, so
  // its shortfalls are expected and fold into one per-week advisory. Weeks that keep
  // any teaching day always report per item, so real under-allocation can never hide
  // behind a calendar exception.
  const closedWeekLabels = new Map<number, string>();
  for (let week = 1; week <= maxWeek; week++) {
    const first = schoolDayNumber(term.weekOneMonday) + (week - 1) * 7;
    let inTermDays = 0;
    let closedDays = 0;
    const reasons = new Set<string>();
    for (let day = first; day < first + 7; day++) {
      const date = schoolDateAt(day);
      if (date < term.startDate) continue;
      if (date > term.endDate) break;
      inTermDays += 1;
      const calendar = days.get(date);
      if (calendar?.kind === "CLOSED") {
        closedDays += 1;
        reasons.add(calendar.reason);
      }
    }
    if (inTermDays > 0 && closedDays === inTermDays)
      closedWeekLabels.set(week, reasons.size === 1 ? `校历停课：${[...reasons][0]}` : "校历停课");
  }
  const active = [...offerings.values()].filter((entry) => entry.active);
  const offeringLabel = (offering: (typeof active)[number]) =>
    `${courses.get(offering.courseId)?.name ?? offering.id} · ${classes.get(offering.classroomId)?.name ?? offering.classroomId}`;
  for (let week = 1; week <= maxWeek; week++) {
    const closedLabel = closedWeekLabels.get(week);
    if (closedLabel) {
      const planned = active.filter((entry) => entry.weeklyPeriods > 0);
      if (planned.length)
        result.warnings.push({
          kind: "WEEK_CLOSED",
          week,
          message: `第${week}周（${closedLabel}）：${planned.length}项开课任务未排常规课次——该周无有效教学日，由校历例外解释。`,
        });
      continue;
    }
    for (const offering of active) {
      const count = weekly.get(`${offering.id}/${week}`) ?? 0;
      if (count !== offering.weeklyPeriods)
        result.warnings.push({
          kind: "SHORTFALL",
          week,
          message: `${offeringLabel(offering)} 第${week}周常规已排${count}节，计划${offering.weeklyPeriods}节；校历例外和调课另计，首末周可能不完整。`,
        });
    }
  }
  conflicts.push(...findSchoolLessonConflicts(result.lessons));
  result.lessons.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.startTime.localeCompare(b.startTime) ||
      a.id.localeCompare(b.id),
  );
  return result;
}
