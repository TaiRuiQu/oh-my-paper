import { z } from "zod";
import { schoolDateSchema, type SchoolLesson } from "./school";
import type { PlatformState } from "./platform";
const id = z.string().min(1).max(128);
const version = z.number().int().nonnegative();
const reason = z.string().trim().min(1).max(2000);
export const attendanceStatuses = [
  "UNMARKED",
  "PRESENT",
  "LATE",
  "ABSENT",
  "EXCUSED",
  "LEFT_EARLY",
] as const;
export type AttendanceStatus = (typeof attendanceStatuses)[number];
export const teachingSessionStatuses = [
  "NOT_STARTED",
  "IN_PROGRESS",
  "COMPLETED",
  "INTERRUPTED",
  "CANCELLED",
] as const;
export type TeachingSessionStatus = (typeof teachingSessionStatuses)[number];
export const teachingPlanSchema = z
  .strictObject({
    title: z.string().trim().min(1).max(200),
    objectives: z.string().trim().min(1).max(10000),
    keyPoints: z.string().max(10000),
    difficulties: z.string().max(10000),
    activities: z
      .array(
        z.strictObject({
          id,
          title: z.string().trim().min(1).max(200),
          minutes: z.number().int().min(1).max(480),
          teacherActions: z.string().max(10000),
          studentActions: z.string().max(10000),
          assessment: z.string().max(10000),
        }),
      )
      .max(50),
    materials: z
      .array(
        z.strictObject({
          id,
          title: z.string().trim().min(1).max(200),
          kind: z.enum(["TEXT", "ASSET", "QUESTION"]),
          content: z.string().max(20000),
          url: z
            .string()
            .regex(/^\/api\/platform\/assets\/[a-f0-9-]{36}$/)
            .optional(),
          questionId: id.optional(),
        }),
      )
      .max(50),
    boardPlan: z.string().max(10000),
    assessmentPlan: z.string().max(10000),
    notes: z.string().max(20000),
  })
  .superRefine((plan, ctx) => {
    for (const entries of [plan.activities, plan.materials])
      if (new Set(entries.map((entry) => entry.id)).size !== entries.length)
        ctx.addIssue({ code: "custom", message: "活动或材料编号不能重复。" });
    for (const material of plan.materials)
      if (
        (material.kind === "ASSET" && !material.url) ||
        (material.kind === "QUESTION" && !material.questionId)
      )
        ctx.addIssue({ code: "custom", message: "图片材料须指定本站图片，题目材料须指定题目。" });
  });
export type TeachingPlan = z.infer<typeof teachingPlanSchema>;
const mark = z.strictObject({
  participantId: id,
  status: z.enum(attendanceStatuses),
  reason: z.string().trim().max(2000),
});
export const teachingListQuerySchema = z.object({
  termId: id.optional(),
  startDate: schoolDateSchema.optional(),
  endDate: schoolDateSchema.optional(),
  status: z.enum(teachingSessionStatuses).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  beforeId: id.optional(),
});
export const teachingHistoryQuerySchema = z.object({
  beforeVersion: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const teachingCommandSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("teaching.session.prepare"),
    termId: id,
    slotId: id,
    originalDate: schoolDateSchema,
    publicationId: id,
  }),
  z.strictObject({
    type: z.literal("teaching.session.rebind"),
    sessionId: id,
    expectedVersion: version,
    publicationId: id,
    reason,
  }),
  z.strictObject({
    type: z.literal("teaching.plan.save"),
    sessionId: id,
    expectedVersion: version,
    expectedPlanVersion: version,
    expectedBindingVersion: version,
    plan: teachingPlanSchema,
  }),
  z.strictObject({
    type: z.literal("teaching.plan.confirm"),
    sessionId: id,
    expectedVersion: version,
    planVersion: version,
  }),
  z.strictObject({
    type: z.literal("teaching.roster.confirm"),
    sessionId: id,
    expectedVersion: version,
    fingerprint: z.string().length(64),
  }),
  z.strictObject({
    type: z.literal("teaching.roster.update"),
    sessionId: id,
    expectedVersion: version,
    fingerprint: z.string().length(64),
    addStudentIds: z.array(id).max(1000),
    excludeParticipantIds: z.array(id).max(1000),
    restoreParticipantIds: z.array(id).max(1000).default([]),
    reason,
  }),
  z.strictObject({
    type: z.literal("teaching.attendance.save"),
    sessionId: id,
    expectedVersion: version,
    marks: z.array(mark).min(1).max(1000),
  }),
  z.strictObject({
    type: z.literal("teaching.session.start"),
    sessionId: id,
    expectedVersion: version,
  }),
  z.strictObject({
    type: z.literal("teaching.session.finish"),
    sessionId: id,
    expectedVersion: version,
    summary: z.string().trim().min(1).max(20000),
    reflection: z.string().trim().min(1).max(20000),
  }),
  z.strictObject({
    type: z.literal("teaching.session.interrupt"),
    sessionId: id,
    expectedVersion: version,
    reason,
  }),
  z.strictObject({
    type: z.literal("teaching.session.resume"),
    sessionId: id,
    expectedVersion: version,
    reason,
  }),
  z.strictObject({
    type: z.literal("teaching.session.cancel"),
    sessionId: id,
    expectedVersion: version,
    reason,
  }),
  z.strictObject({
    type: z.literal("teaching.session.correct"),
    sessionId: id,
    expectedVersion: version,
    reason,
    summary: z.string().trim().max(20000).optional(),
    reflection: z.string().trim().max(20000).optional(),
    marks: z.array(mark).max(1000).default([]),
  }),
]);
export type TeachingCommand = z.infer<typeof teachingCommandSchema>;
export type TeachingBinding = {
  publicationId: string;
  publicationRevision: number;
  timezone: string;
  lessonIds: string[];
  lessons: SchoolLesson[];
};
export type TeachingPlanVersion = {
  id: string;
  version: number;
  source: "HUMAN" | "AI";
  aiJobId: string | null;
  actorName: string;
  createdAt: string;
  bindingVersion: number;
  plan: TeachingPlan;
};
export type TeachingParticipant = {
  id: string;
  studentId: string;
  name: string;
  studentNumber: string;
  classroomId: string;
  classroomName: string;
  rosterStatus: "EXPECTED" | "EXCLUDED";
  rosterReason: string;
  attendance: AttendanceStatus;
  attendanceReason: string;
};
export type TeachingSession = {
  id: string;
  termId: string;
  slotId: string;
  originalDate: string;
  version: number;
  bindingVersion: number;
  status: TeachingSessionStatus;
  binding: TeachingBinding;
  planVersion: number;
  confirmedPlanVersion: number | null;
  plan: TeachingPlanVersion | null;
  rosterFingerprint: string | null;
  rosterConfirmed: boolean;
  participants: TeachingParticipant[];
  summary: string;
  reflection: string;
  startedAt: string | null;
  finishedAt: string | null;
  interruptedAt: string | null;
  currentSchedule: TeachingBinding | null;
  scheduleChanged: boolean;
  canPrepare: boolean;
  canRebind: boolean;
  canCancel: boolean;
  canManageRoster: boolean;
  canTakeAttendance: boolean;
  canStart: boolean;
  canFinish: boolean;
  canCorrect: boolean;
  blockReasons: string[];
};
export type TeachingSessions = {
  actor: PlatformState["actor"];
  canManage: boolean;
  sessions: TeachingSession[];
  nextBeforeId: string | null;
};
export type TeachingRosterPreview = {
  sessionId: string;
  fingerprint: string;
  candidates: {
    studentId: string;
    name: string;
    studentNumber: string;
    classroomId: string;
    classroomName: string;
  }[];
  addedStudentIds: string[];
  removedParticipantIds: string[];
};
export type TeachingHistory = {
  sessionId: string;
  events: {
    id: string;
    version: number;
    type: string;
    actorName: string;
    createdAt: string;
    reason: string;
    snapshot: TeachingSession;
  }[];
  plans: TeachingPlanVersion[];
  nextBeforeVersion: number | null;
};
export type TeachingCommandResult = { id: string; version: number; planVersion?: number };
export const lessonPrepareInputSchema = z.strictObject({
  sessionId: id,
  publicationId: id,
  expectedVersion: version,
  expectedPlanVersion: version,
  expectedBindingVersion: version,
  requirements: z.string().trim().max(10000),
});
