import { z } from "zod";
import { SUBJECTS, type Assessment, type Classroom, type PlatformState } from "./platform";

const classroomId = z.string().min(1).max(100);
export const teachingAssignmentSchema = z.discriminatedUnion("role", [
  z.strictObject({ role: z.literal("SCHOOL_ADMIN") }),
  z.strictObject({ role: z.literal("GRADE_DIRECTOR"), grade: z.string().trim().min(1).max(80) }),
  z.strictObject({ role: z.literal("HOMEROOM"), classroomId }),
  z.strictObject({ role: z.literal("SUBJECT_TEACHER"), classroomId, subject: z.enum(SUBJECTS) }),
]);
export type TeachingAssignment = z.infer<typeof teachingAssignmentSchema>;
export const teachingPermissionsCommandSchema = z.strictObject({
  type: z.literal("user.permissions"),
  id: z.string().min(1),
  assignments: z
    .array(teachingAssignmentSchema)
    .max(200)
    .superRefine((rows, ctx) => {
      const keys = rows.map(assignmentKey);
      if (new Set(keys).size !== keys.length)
        ctx.addIssue({ code: "custom", message: "不能重复分配相同的教学身份。" });
    }),
});
export const TEACHING_ROLES = {
  SCHOOL_ADMIN: "学校总管理",
  GRADE_DIRECTOR: "年级主任",
  HOMEROOM: "班主任",
  SUBJECT_TEACHER: "任课老师",
} as const;

export function assignmentKey(assignment: TeachingAssignment) {
  return JSON.stringify([
    assignment.role,
    "grade" in assignment ? assignment.grade : "",
    "classroomId" in assignment ? assignment.classroomId : "",
    "subject" in assignment ? assignment.subject : "",
  ]);
}

export function canReadSubject(
  actor: PlatformState["actor"],
  classroom: Pick<Classroom, "id" | "grade">,
  subject?: string,
) {
  if (actor.role === "ADMIN") return true;
  if (actor.role !== "TEACHER") return false;
  return (actor.teachingAssignments ?? []).some((assignment) => {
    switch (assignment.role) {
      case "SCHOOL_ADMIN":
        return true;
      case "GRADE_DIRECTOR":
        return assignment.grade === classroom.grade;
      case "HOMEROOM":
        return assignment.classroomId === classroom.id;
      case "SUBJECT_TEACHER":
        return (
          assignment.classroomId === classroom.id &&
          (subject === undefined || assignment.subject === subject)
        );
    }
  });
}

/** Teaching a subject defines the marking pool; management visibility alone does not. */
export function canReviewSubject(
  actor: PlatformState["actor"],
  assessment: Pick<Assessment, "reviewScope" | "classroomIds">,
  classroom: Pick<Classroom, "id" | "grade">,
  subject: string,
  teachingClassrooms: Pick<Classroom, "id" | "grade">[],
) {
  if (!assessment.classroomIds.includes(classroom.id)) return false;
  if (actor.role === "ADMIN") return true;
  if (actor.role !== "TEACHER") return false;
  return (actor.teachingAssignments ?? []).some(
    (assignment) =>
      assignment.role === "SUBJECT_TEACHER" &&
      assignment.subject === subject &&
      (assessment.reviewScope === "GRADE"
        ? teachingClassrooms.some(
            (c) => c.id === assignment.classroomId && c.grade === classroom.grade,
          )
        : assessment.reviewScope === "CLASSROOM" && assignment.classroomId === classroom.id),
  );
}
