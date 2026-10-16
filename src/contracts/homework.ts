import { z } from "zod";
import { schoolDateSchema, schoolTimezoneSchema } from "./school";
import type {
  Paper,
  PaperItem,
  DocumentTextBlock,
  ParticipationStatus,
  PlatformState,
  QuestionType,
  SubmissionAnswer,
} from "./platform";

const id = z.string().min(1).max(128);
const version = z.number().int().positive();
const draftVersion = z.number().int().nonnegative();
const reason = z.string().trim().min(1).max(2000);
const instant = z.iso.datetime({ offset: true });
/** School civil time, never interpreted in the browser/server machine timezone. */
export const homeworkDueLocalSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/)
  .refine((value) => schoolDateSchema.safeParse(value.slice(0, 10)).success, "截止日期无效");
export const homeworkImageUrlSchema = z
  .string()
  .regex(
    /^\/api\/platform\/assets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,
    "请选择本站已上传图片。",
  );
const imageUrls = z
  .array(homeworkImageUrlSchema)
  .max(30)
  .refine((urls) => new Set(urls).size === urls.length, "图片不能重复。");
export const homeworkAnswerSchema = z.strictObject({
  itemId: id,
  text: z.string().max(100000),
  images: imageUrls,
});
const answers = z
  .array(homeworkAnswerSchema)
  .max(500)
  .refine((rows) => new Set(rows.map((row) => row.itemId)).size === rows.length, "题目不能重复。");
export type HomeworkAnswer = z.infer<typeof homeworkAnswerSchema>;

export const homeworkAssignmentStatuses = ["ISSUED", "CLOSED", "CANCELLED"] as const;
export type HomeworkAssignmentStatus = (typeof homeworkAssignmentStatuses)[number];
export const homeworkCollectionStatuses = ["NOT_SUBMITTED", "SUBMITTED", "RETURNED"] as const;
export type HomeworkCollectionStatus = (typeof homeworkCollectionStatuses)[number];
export const homeworkListQuerySchema = z.strictObject({
  status: z.enum(homeworkAssignmentStatuses).optional(),
  assessmentId: id.optional(),
  beforeId: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export const homeworkHistoryQuerySchema = z.strictObject({
  workId: id.optional(),
  beforeId: id.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
const issuePaper = z.strictObject({
  paperId: id,
  expectedUpdatedAt: instant,
  studentImageUrls: z
    .array(homeworkImageUrlSchema)
    .max(100)
    .refine((urls) => new Set(urls).size === urls.length, "图片不能重复。"),
  items: z
    .array(z.strictObject({ itemId: id, studentImageUrls: imageUrls }))
    .min(1)
    .max(500)
    .refine(
      (rows) => new Set(rows.map((row) => row.itemId)).size === rows.length,
      "题目不能重复。",
    ),
});
export const homeworkCommandSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("homework.issue"),
    assessmentId: id,
    expectedRosterRevision: version,
    expectedPapers: z
      .array(issuePaper)
      .min(1)
      .max(20)
      .refine(
        (rows) => new Set(rows.map((row) => row.paperId)).size === rows.length,
        "作业卷不能重复。",
      ),
    instructions: z.string().trim().max(10000),
    dueLocal: homeworkDueLocalSchema,
    timezone: schoolTimezoneSchema,
    allowLate: z.boolean(),
  }),
  z.strictObject({
    type: z.literal("homework.settings"),
    assignmentId: id,
    expectedVersion: version,
    instructions: z.string().trim().max(10000),
    dueLocal: homeworkDueLocalSchema,
    allowLate: z.boolean(),
    reason,
  }),
  ...(["homework.close", "homework.reopen", "homework.cancel"] as const).map((type) =>
    z.strictObject({ type: z.literal(type), assignmentId: id, expectedVersion: version, reason }),
  ),
  z.strictObject({
    type: z.literal("homework.roster.sync"),
    assignmentId: id,
    expectedVersion: version,
    expectedRosterRevision: version,
    reason,
  }),
  z.strictObject({
    type: z.literal("homework.draft.save"),
    workId: id,
    expectedVersion: version,
    expectedDraftVersion: draftVersion,
    answers,
  }),
  z.strictObject({
    type: z.literal("homework.submit"),
    workId: id,
    expectedVersion: version,
    expectedDraftVersion: draftVersion,
    expectedAssignmentVersion: version,
    expectedRosterRevision: version,
    requestId: z.uuid(),
  }),
  z.strictObject({
    type: z.literal("homework.return"),
    workId: id,
    expectedVersion: version,
    expectedAttemptId: id,
    reason,
  }),
  z.strictObject({
    type: z.literal("homework.deadline.extend"),
    workId: id,
    expectedVersion: version,
    dueLocal: homeworkDueLocalSchema,
    reason,
  }),
]);
export type HomeworkCommand = z.infer<typeof homeworkCommandSchema>;

/** Persistence/teacher-only publication snapshot. Never send this structure to students. */
export type HomeworkFrozenPaper = {
  paper: Paper;
  studentImageUrls: string[];
  studentImageUrlsByItem: Record<string, string[]>;
};

export type HomeworkIssuePreview = {
  assessmentId: string;
  name: string;
  timezone: string;
  rosterRevision: number;
  rosterStatus: "CONFIRMED" | "NEEDS_REVIEW";
  papers: {
    id: string;
    name: string;
    updatedAt: string;
    subject: string;
    instructions: string;
    textBlocks: Pick<DocumentTextBlock, "id" | "text" | "beforeQuestionId">[];
    allowedStudentImageUrls: string[];
    suggestedStudentImageUrls: string[];
    items: (PaperItem & {
      suggestedStudentImageUrls: string[];
      allowedStudentImageUrls: string[];
    })[];
  }[];
  canIssue: boolean;
  blockReasons: string[];
};

/** No answer, explanation, rubric, teacher metadata or unselected media reaches this DTO. */
export type HomeworkStudentPaper = {
  id: string;
  name: string;
  subject: string;
  instructions: string;
  textBlocks: Pick<DocumentTextBlock, "id" | "text" | "beforeQuestionId">[];
  studentImageUrls: string[];
  items: {
    id: string;
    position: number;
    score: number;
    section: string;
    type: QuestionType;
    stem: string;
    options: { label: string; text: string }[];
    parts: {
      id: string;
      type: Exclude<QuestionType, "MIXED">;
      stem: string;
      options: { label: string; text: string }[];
      score: number;
    }[];
    studentImageUrls: string[];
  }[];
};
export type HomeworkAssignmentCapabilities = {
  canManage: boolean;
  canClose: boolean;
  canReopen: boolean;
  canCancel: boolean;
  canSyncRoster: boolean;
  canViewHistory: boolean;
  blockReasons: string[];
};
export type HomeworkAssignment = {
  id: string;
  assessmentId: string;
  name: string;
  version: number;
  status: HomeworkAssignmentStatus;
  issuedAt: string;
  dueLocal: string;
  dueAt: string;
  timezone: string;
  allowLate: boolean;
  instructions: string;
  resultsPublished: boolean;
  /** Last explicitly synchronized Assessment roster revision, not the live class roster. */
  rosterRevision: number;
  currentRosterRevision: number;
  rosterNeedsSync: boolean;
  papers: HomeworkStudentPaper[];
  capabilities: HomeworkAssignmentCapabilities;
};
export type HomeworkAttemptSummary = {
  id: string;
  scanSubmissionId: string;
  sequence: number;
  submittedAt: string;
  late: boolean;
  source: "STUDENT" | "TEACHER";
  status: "SUBMITTED" | "RETURNED";
  returnedAt: string | null;
  returnReason: string;
};
export type HomeworkWorkCapabilities = {
  canSaveDraft: boolean;
  canSubmit: boolean;
  canUpload: boolean;
  canReturn: boolean;
  canExtend: boolean;
  canViewAttemptHistory: boolean;
  blockReasons: string[];
};
export type HomeworkWork = {
  id: string;
  participantSubjectId: string;
  paperId: string;
  version: number;
  studentId: string;
  name: string;
  studentNumber: string;
  classroomId: string;
  classroomName: string;
  participationStatus: ParticipationStatus;
  participationReason: string;
  collectionStatus: HomeworkCollectionStatus;
  dueAt: string;
  dueLocal: string;
  deadlineOverride: { dueAt: string; dueLocal: string; reason: string } | null;
  overdue: boolean;
  currentAttempt: HomeworkAttemptSummary | null;
  capabilities: HomeworkWorkCapabilities;
};
export type HomeworkStudentWork = HomeworkWork & {
  draft: { version: number; answers: HomeworkAnswer[]; updatedAt: string | null };
};
export type HomeworkCollectionCounts = {
  required: number;
  submitted: number;
  notSubmitted: number;
  returned: number;
  late: number;
  exempt: number;
  absent: number;
  withdrawn: number;
};
export type HomeworkAssignmentDetail =
  | {
      view: "TEACHER";
      actor: PlatformState["actor"];
      assignment: HomeworkAssignment;
      fullPapers: Paper[];
      works: HomeworkWork[];
      counts: HomeworkCollectionCounts;
    }
  | {
      view: "STUDENT";
      actor: PlatformState["actor"];
      assignment: HomeworkAssignment;
      works: HomeworkStudentWork[];
    };
export type HomeworkAssignmentSummary = Omit<HomeworkAssignment, "papers">;
export type HomeworkAssignments =
  | {
      view: "TEACHER";
      actor: PlatformState["actor"];
      assignments: (HomeworkAssignmentSummary & { counts: HomeworkCollectionCounts })[];
      nextBeforeId: string | null;
    }
  | {
      view: "STUDENT";
      actor: PlatformState["actor"];
      assignments: (HomeworkAssignmentSummary & { works: HomeworkWork[] })[];
      nextBeforeId: string | null;
    };
export type HomeworkAttempt = HomeworkAttemptSummary & {
  workId: string;
  paperId: string;
  paperName: string;
  /** Owner-only request token is deliberately absent from outbound attempt DTOs. */
  /** Every frozen paper item in its original order, including items omitted at submission. */
  answers: (Pick<SubmissionAnswer, "itemId" | "text" | "images"> & {
    questionNumber: number;
    submitted: boolean;
  })[];
};
export type HomeworkEvent = {
  id: string;
  assignmentId: string;
  workId: string | null;
  type: HomeworkCommand["type"];
  actorId: string;
  actorName: string;
  createdAt: string;
  reason: string;
  /** Server-projected human-readable changes; never raw drafts, grades or arbitrary audit JSON. */
  changes: string[];
};
export type HomeworkHistory = {
  assignmentId: string;
  events: HomeworkEvent[];
  /** Only attempts associated with this event page, scoped to the current actor. */
  attempts: HomeworkAttempt[];
  nextBeforeId: string | null;
};
export type HomeworkCommandResult = {
  /** Assignment ID, including when the accepted command changed one work item. */
  id: string;
  version: number;
  workId?: string;
  workVersion?: number;
  draftVersion?: number;
  attemptId?: string;
  sequence?: number;
};
export type HomeworkAssetUploadResult = { id: string; url: string };
