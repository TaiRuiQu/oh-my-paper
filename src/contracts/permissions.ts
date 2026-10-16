import { z } from "zod";
import {
  SCHOOL_STAGES,
  SUBJECTS,
  type Assessment,
  type Classroom,
  type PlatformState,
} from "./platform";

const classroomId = z.string().min(1).max(100);
export const teachingAssignmentSchema = z.discriminatedUnion("role", [
  z.strictObject({ role: z.literal("SCHOOL_ADMIN") }),
  z.strictObject({
    role: z.literal("GRADE_DIRECTOR"),
    stage: z.enum(SCHOOL_STAGES),
    cohort: z.string().trim().min(1).max(80),
  }),
  z.strictObject({ role: z.literal("HOMEROOM"), classroomId }),
  z.strictObject({ role: z.literal("SUBJECT_TEACHER"), classroomId, subject: z.enum(SUBJECTS) }),
]);
export type TeachingAssignment = z.infer<typeof teachingAssignmentSchema>;
export const teachingPermissionsCommandSchema = z.strictObject({
  type: z.literal("user.permissions"),
  id: z.string().min(1),
  expectedVersion: z.number().int().nonnegative(),
  reason: z.string().trim().min(1).max(2000),
  assignments: z
    .array(teachingAssignmentSchema)
    .max(200)
    .superRefine((rows, ctx) => {
      const keys = rows.map(assignmentKey);
      if (new Set(keys).size !== keys.length)
        ctx.addIssue({ code: "custom", message: "不能重复分配相同的教学身份。" });
    }),
});
export const teachingRoleCommandSchema = z.strictObject({
  type: z.literal("user.role"),
  id: z.string().min(1),
  role: z.enum(["ADMIN", "TEACHER", "STUDENT"]),
  expectedVersion: z.number().int().nonnegative(),
  reason: z.string().trim().min(1).max(2000),
});
export type TeachingPermissionsCommand =
  z.infer<typeof teachingPermissionsCommandSchema> | z.infer<typeof teachingRoleCommandSchema>;
export const teachingPermissionsHistoryQuerySchema = z.strictObject({
  beforeId: z.string().min(1).max(128).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type TeachingPermissionsSnapshot = {
  role: "ADMIN" | "TEACHER" | "STUDENT";
  assignments: TeachingAssignment[];
};
export type TeachingPermissionsHistory = {
  user: {
    id: string;
    name: string;
    role: TeachingPermissionsSnapshot["role"];
    permissionsVersion: number;
  };
  events: {
    id: string;
    type: "user.permissions" | "user.role" | "classroom.save";
    version: number;
    actorId: string;
    actorName: string;
    targetId: string;
    targetName: string;
    before: TeachingPermissionsSnapshot;
    after: TeachingPermissionsSnapshot;
    reason: string;
    createdAt: string;
  }[];
  nextBeforeId: string | null;
};
export const TEACHING_ROLES = {
  SCHOOL_ADMIN: "学校总管理",
  GRADE_DIRECTOR: "年级主任",
  HOMEROOM: "班主任",
  SUBJECT_TEACHER: "任课老师",
} as const;

export function assignmentKey(assignment: TeachingAssignment) {
  return JSON.stringify([
    assignment.role,
    "stage" in assignment ? assignment.stage : "",
    "cohort" in assignment ? assignment.cohort : "",
    "classroomId" in assignment ? assignment.classroomId : "",
    "subject" in assignment ? assignment.subject : "",
  ]);
}

export function canReadSubject(
  actor: PlatformState["actor"],
  classroom: Pick<Classroom, "id" | "stage" | "cohort">,
  subject?: string,
) {
  if (actor.role === "ADMIN") return true;
  if (actor.role !== "TEACHER") return false;
  return (actor.teachingAssignments ?? []).some((assignment) => {
    switch (assignment.role) {
      case "SCHOOL_ADMIN":
        return true;
      case "GRADE_DIRECTOR":
        return assignment.stage === classroom.stage && assignment.cohort === classroom.cohort;
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
  classroom: Pick<Classroom, "id" | "stage" | "cohort">,
  subject: string,
  teachingClassrooms: Pick<Classroom, "id" | "stage" | "cohort">[],
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
            (c) =>
              c.id === assignment.classroomId &&
              c.stage === classroom.stage &&
              c.cohort === classroom.cohort,
          )
        : assessment.reviewScope === "CLASSROOM" && assignment.classroomId === classroom.id),
  );
}
