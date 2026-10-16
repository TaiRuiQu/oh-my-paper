import { z } from "zod";
import type { Paper, PlatformState } from "./platform";
import {
  homeworkAnswerSchema,
  homeworkImageUrlSchema,
  type HomeworkAnswer,
  type HomeworkFrozenPaper,
  type HomeworkStudentPaper,
} from "./homework";

const id = z.string().min(1).max(128);
const version = z.number().int().positive();
const baseline = z.number().int().nonnegative();
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const reason = z.string().trim().min(1).max(2000);
const images = z
  .array(homeworkImageUrlSchema)
  .max(100)
  .refine((v) => new Set(v).size === v.length, "图片不能重复。");
const answers = z
  .array(homeworkAnswerSchema)
  .max(500)
  .refine((v) => new Set(v.map((a) => a.itemId)).size === v.length, "作答题目不能重复。");
export const practiceJudgments = ["CORRECT", "PARTIAL", "INCORRECT", "UNSURE", "SKIPPED"] as const;
export type PracticeJudgment = (typeof practiceJudgments)[number];
export const practiceEligibilityKinds = [
  "UNEXPOSED_IN_SYSTEM",
  "REPEAT",
  "ANSWER_AVAILABLE",
  "UNKNOWN",
] as const;
export type PracticeEligibility = (typeof practiceEligibilityKinds)[number];
export const practiceEvaluationSchema = z
  .strictObject({
    summary: z.string().trim().max(10000),
    items: z
      .array(
        z.strictObject({
          itemId: id,
          judgment: z.enum(practiceJudgments),
          feedback: z.string().max(10000),
          parts: z
            .array(
              z.strictObject({
                partId: id,
                judgment: z.enum(practiceJudgments),
                feedback: z.string().max(10000),
              }),
            )
            .max(100),
        }),
      )
      .min(1)
      .max(500),
  })
  .superRefine((value, ctx) => {
    if (new Set(value.items.map((i) => i.itemId)).size !== value.items.length)
      ctx.addIssue({ code: "custom", message: "核对题目不能重复。" });
    for (const item of value.items) {
      if (new Set(item.parts.map((p) => p.partId)).size !== item.parts.length)
        ctx.addIssue({ code: "custom", message: "核对小问不能重复。" });
      for (const entry of [item, ...item.parts])
        if ((entry.judgment === "SKIPPED" || entry.judgment === "UNSURE") && !entry.feedback.trim())
          ctx.addIssue({ code: "custom", message: "待核验或跳过必须说明原因，不能计为零分。" });
    }
  });
export type PracticeEvaluationInput = z.infer<typeof practiceEvaluationSchema>;
export const practiceGradeInputSchema = z.strictObject({
  attemptId: id,
  sessionId: id.optional(),
  expectedEvaluationVersion: baseline,
  attemptFingerprint: fingerprint,
  contentFingerprint: fingerprint,
});
export type PracticeGradeInput = z.infer<typeof practiceGradeInputSchema>;
export const practiceSourcesQuerySchema = z.strictObject({
  classroomId: id.optional(),
  subject: z.string().max(40).optional(),
  beforeId: id.optional(),
  paperBeforeId: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export const practiceSessionsQuerySchema = z.strictObject({
  studentId: id.optional(),
  setId: id.optional(),
  status: z.enum(["DRAFT", "SUBMITTED"]).optional(),
  beforeId: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export const practiceReviewsQuerySchema = z.strictObject({
  classroomId: id.optional(),
  subject: z.string().max(40).optional(),
  beforeId: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export const practiceHistoryQuerySchema = z
  .strictObject({
    beforeId: id.optional(),
    attemptId: id.optional(),
    evaluationId: id.optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .refine((q) => !q.evaluationId || !!q.attemptId, "定位评价记录必须同时指定提交轮次。")
  .refine((q) => !q.attemptId || !q.beforeId, "定位提交轮次时不能同时使用历史分页游标。");
export const practiceEvidenceQuerySchema = z.strictObject({
  studentId: id.optional(),
  subject: z.string().max(40).optional(),
  beforeId: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export const practiceCommandSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("practice.set.publish"),
    requestId: z.uuid(),
    paperId: id,
    classroomId: id,
    expectedPaperUpdatedAt: z.iso.datetime({ offset: true }),
    name: z.string().trim().min(1).max(200),
    studentImageUrls: images,
    items: z
      .array(z.strictObject({ itemId: id, studentImageUrls: images }))
      .min(1)
      .max(500)
      .refine(
        (items) => new Set(items.map((item) => item.itemId)).size === items.length,
        "题目不能重复。",
      ),
  }),
  z.strictObject({
    type: z.literal("practice.set.close"),
    setId: id,
    expectedVersion: version,
    reason,
  }),
  z.strictObject({
    type: z.literal("practice.start"),
    source: z.discriminatedUnion("kind", [
      z.strictObject({
        kind: z.literal("SET"),
        setId: id,
        expectedVersion: version,
        studentId: id,
      }),
      z.strictObject({
        kind: z.literal("REPLAY"),
        paperId: id,
        expectedPaperUpdatedAt: z.iso.datetime({ offset: true }),
        studentId: id,
      }),
    ]),
    requestId: z.uuid(),
  }),
  z.strictObject({
    type: z.literal("practice.draft.save"),
    sessionId: id,
    expectedVersion: version,
    expectedDraftVersion: baseline,
    answers,
  }),
  z.strictObject({
    type: z.literal("practice.submit"),
    sessionId: id,
    expectedVersion: version,
    expectedDraftVersion: baseline,
    requestId: z.uuid(),
  }),
  z.strictObject({
    type: z.literal("practice.retry"),
    sessionId: id,
    expectedVersion: version,
    copyPreviousAnswers: z.boolean(),
  }),
  z.strictObject({
    type: z.literal("practice.reference.reveal"),
    sessionId: id,
    expectedVersion: version,
    itemIds: z
      .array(id)
      .min(1)
      .max(500)
      .refine((ids) => new Set(ids).size === ids.length, "题目不能重复。"),
    reason: z.string().trim().max(2000),
  }),
  z.strictObject({
    type: z.literal("practice.self-assess"),
    attemptId: id,
    expectedEvaluationVersion: baseline,
    evaluation: practiceEvaluationSchema,
  }),
  /** Human review request. AI uses the separate PRACTICE_GRADE queue with practiceGradeInputSchema. */
  z.strictObject({
    type: z.literal("practice.review.request"),
    attemptId: id,
    expectedEvaluationVersion: baseline,
    message: z.string().trim().max(2000),
  }),
  z.strictObject({
    type: z.literal("practice.review.confirm"),
    attemptId: id,
    expectedEvaluationVersion: baseline,
    candidateId: id.nullable(),
    evaluation: practiceEvaluationSchema,
    reason,
  }),
]);
export type PracticeCommand = z.infer<typeof practiceCommandSchema>;
export type PracticeFrozenPaper = HomeworkFrozenPaper;
export type PracticeStudentPaper = HomeworkStudentPaper;
export type PracticeAnswer = HomeworkAnswer;
export type PracticeIdentity = {
  studentId: string;
  userId: string;
  name: string;
  studentNumber: string;
  classroomId: string;
  classroomName: string;
  stage: string;
  cohort: string;
};
export type PracticeItemEligibility = {
  itemId: string;
  originalQuestionId: string;
  promptFingerprint: string;
  eligibility: PracticeEligibility;
  reasons: string[];
};
export type PracticeSet = {
  id: string;
  version: number;
  name: string;
  subject: string;
  classroomId: string;
  classroomName: string;
  status: "OPEN" | "CLOSED";
  publishedAt: string;
  ownerName: string;
  itemCount: number;
  canStart: boolean;
  canClose: boolean;
  blockReasons: string[];
};
export type PracticePaperSource = {
  id: string;
  name: string;
  subject: string;
  updatedAt: string;
  itemCount: number;
};
export type PracticeSources = {
  actor: PlatformState["actor"];
  sets: PracticeSet[];
  replayPapers: PracticePaperSource[];
  publishPapers: PracticePaperSource[];
  ownStudents: PracticeIdentity[];
  canPublish: boolean;
  nextBeforeId: string | null;
  nextPaperBeforeId: string | null;
};
export type PracticeSets = {
  actor: PlatformState["actor"];
  sets: PracticeSet[];
  nextBeforeId: string | null;
};
export type PracticeSetPreview = {
  actor: PlatformState["actor"];
  paper: Paper;
  studentPaper: PracticeStudentPaper;
  allowedStudentImageUrls: string[];
  suggestedStudentImageUrls: string[];
  items: {
    itemId: string;
    allowedStudentImageUrls: string[];
    suggestedStudentImageUrls: string[];
  }[];
  classrooms: { id: string; name: string; stage: string; cohort: string }[];
  canPublish: boolean;
  blockReasons: string[];
};
export type PracticeSetDetail = {
  actor: PlatformState["actor"];
  set: PracticeSet;
  fullPaper: Paper | null;
  studentPaper: PracticeStudentPaper;
};
export type PracticeSessionSummary = {
  id: string;
  version: number;
  sourceKind: "SET" | "REPLAY";
  setId: string | null;
  name: string;
  subject: string;
  student: PracticeIdentity;
  status: "DRAFT" | "SUBMITTED";
  createdAt: string;
  submittedAt: string | null;
  attemptCount: number;
  currentAttemptId: string | null;
  reviewRequestedAt: string | null;
  feedbackState: "NONE" | "WAITING" | "AI_CANDIDATE" | "SELF" | "TEACHER_CONFIRMED";
};
export type PracticeAttemptSummary = {
  id: string;
  sessionId: string;
  sequence: number;
  submittedAt: string;
  attemptFingerprint: string;
  contentFingerprint: string;
  evaluationVersion: number;
  eligibility: PracticeItemEligibility[];
  canSelfAssess: boolean;
  canRequestReview: boolean;
  canRequestAi: boolean;
  canConfirmReview: boolean;
  blockReasons: string[];
};
export type PracticeEvaluation = {
  id: string;
  attemptId: string;
  version: number;
  source: "SELF" | "AI_CANDIDATE" | "TEACHER_CONFIRMED";
  actorId: string;
  actorName: string;
  createdAt: string;
  candidateId: string | null;
  aiJobId: string | null;
  evaluation: PracticeEvaluationInput;
};
export type PracticeReference = {
  items: {
    itemId: string;
    answers: string[];
    explanation: string;
    rubric: string;
    images: string[];
    parts: { partId: string; answers: string[]; explanation: string; rubric: string }[];
  }[];
};
export type PracticeSessionCapabilities = {
  canSaveDraft: boolean;
  canUpload: boolean;
  canSubmit: boolean;
  canRetry: boolean;
  canRevealReference: boolean;
  canViewHistory: boolean;
  blockReasons: string[];
};
export type PracticeSessions = {
  actor: PlatformState["actor"];
  sessions: PracticeSessionSummary[];
  nextBeforeId: string | null;
};
export type PracticeSessionDetail = {
  actor: PlatformState["actor"];
  /** School timezone for rendering submission/receipt timestamps, same source as the homework domain. */
  timezone: string;
  session: PracticeSessionSummary;
  papers: PracticeStudentPaper[];
  draft: { version: number; answers: PracticeAnswer[]; updatedAt: string | null } | null;
  currentAttempt: PracticeAttemptSummary | null;
  evaluations: PracticeEvaluation[];
  reference: PracticeReference | null;
  revealedItemIds: string[];
  eligibility: PracticeItemEligibility[];
  capabilities: PracticeSessionCapabilities;
};
/** Teachers receive immutable submitted answers, never the session's current draft. */
export type PracticeAttemptDetail = {
  actor: PlatformState["actor"];
  /** School timezone for rendering submission/evaluation timestamps, same source as the homework domain. */
  timezone: string;
  session: PracticeSessionSummary;
  attempt: PracticeAttemptSummary;
  papers: PracticeStudentPaper[];
  answers: PracticeAnswer[];
  reference: PracticeReference | null;
  evaluations: PracticeEvaluation[];
};
export type PracticeReviews = {
  actor: PlatformState["actor"];
  /** School timezone for rendering review-request timestamps, same source as the homework domain. */
  timezone: string;
  attempts: { session: PracticeSessionSummary; attempt: PracticeAttemptSummary }[];
  nextBeforeId: string | null;
};
export type PracticeEvent = {
  id: string;
  sessionId: string | null;
  setId: string | null;
  type: string;
  actorName: string;
  createdAt: string;
  reason: string;
  changes: string[];
};
export type PracticeHistory = {
  sessionId: string;
  /** School timezone for rendering event/attempt timestamps, same source as the homework domain. */
  timezone: string;
  events: PracticeEvent[];
  attempts: PracticeAttemptDetail[];
  nextBeforeId: string | null;
};
export type PracticeEvidenceItem = {
  attemptId: string;
  sessionId: string;
  itemId: string;
  partId: string | null;
  subject: string;
  knowledgeTags: string[];
  judgment: PracticeJudgment;
  source: PracticeEvaluation["source"];
  eligibility: PracticeEligibility;
  evaluationId: string;
  evaluationVersion: number;
  recordedAt: string;
};
export type PracticeEvidence = {
  actor: PlatformState["actor"];
  /** School timezone for rendering evidence timestamps, same source as the homework domain. */
  timezone: string;
  studentId: string;
  items: PracticeEvidenceItem[];
  summary: {
    submittedAttempts: number;
    distinctQuestions: number;
    unexposedQuestions: number;
    repeatedOrAssistedQuestions: number;
    selfAssessed: number;
    aiCandidates: number;
    teacherConfirmed: number;
    lastEvidenceAt: string | null;
  };
  nextBeforeId: string | null;
};
export type PracticeCommandResult = {
  id: string;
  version: number;
  setId?: string;
  sessionId?: string;
  attemptId?: string;
  sequence?: number;
  draftVersion?: number;
  evaluationId?: string;
  evaluationVersion?: number;
  reference?: PracticeReference;
};
export type PracticeAssetUploadResult = { id: string; url: string };
/** Private AI-only context. Never expose through the student read API or job projection. */
export type PracticeAiContext = {
  actor: PlatformState["actor"];
  sessionId: string;
  setId: string | null;
  subject: string;
  attemptId: string;
  evaluationVersion: number;
  attemptFingerprint: string;
  contentFingerprint: string;
  paper: Paper;
  answers: PracticeAnswer[];
  eligibility: PracticeItemEligibility[];
};
