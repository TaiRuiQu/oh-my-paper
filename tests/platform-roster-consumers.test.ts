import { beforeEach, expect, it, vi } from "vitest";
import type {
  Assessment,
  Paper,
  ParticipationStatus,
  PlatformState,
  ScanSubmission,
} from "@/contracts/platform";
import type { Prisma } from "@/generated/prisma/client";
import type { GradingInput } from "@/server/platform/grading";
import { gradingContext } from "@/server/platform/grading";
import { executeSubmissionsCommand } from "@/server/platform/commands/submissions";
import { executeReviewsCommand } from "@/server/platform/commands/reviews";

const actor: PlatformState["actor"] = { id: "teacher", name: "教师", role: "ADMIN" };
const participant = {
  id: "participant",
  studentId: "old-student",
  name: "考试时姓名",
  studentNumber: "123456",
  classroomId: "old-class",
  classroomName: "原班级",
  stage: "高中",
  cohort: "2027届",
  subjects: [{ paperId: "paper", status: "REQUIRED" as ParticipationStatus, reason: "" }],
};
let assessment: Assessment;
const paper = {
  id: "paper",
  ownerId: "teacher",
  name: "作业",
  kind: "HOMEWORK",
  subject: "数学",
  grade: "高中一年级",
  instructions: "",
  createdAt: "",
  updatedAt: "",
  layout: { paperSize: "A4", columns: 1 },
  items: [
    {
      id: "item",
      position: 0,
      questionId: "question",
      score: 10,
      section: "",
      snapshot: {
        id: "question",
        ownerId: "teacher",
        grade: "高中一年级",
        difficulty: 0.5,
        knowledgeTags: [],
        createdAt: "",
        updatedAt: "",
        type: "SUBJECTIVE",
        subject: "数学",
        content: {
          stem: "求解",
          options: [],
          images: [],
          answers: ["4"],
          rubric: "",
          explanation: "",
          parts: [],
        },
      },
    },
  ],
} as Paper;
const submission = {
  id: "submission",
  ownerId: "teacher",
  assessmentId: "assessment",
  paperId: "paper",
  studentId: "old-student",
  templateId: null,
  kind: "WORKBOOK",
  status: "PENDING",
  sourceFiles: [],
  answers: [{ itemId: "item", text: "4", images: [] }],
  createdAt: "",
  alignment: null,
  active: true,
} as ScanSubmission;
const request: GradingInput = {
  assessmentId: "assessment",
  rosterRevision: 3,
  classroomId: "old-class",
  paperId: "paper",
  assetUrls: [],
  studentIds: [],
};
let db: Prisma.TransactionClient;
let mocks: ReturnType<typeof database>;
function database() {
  return {
    assessment: { findUnique: vi.fn(async () => assessment) },
    homeworkAssignment: { findUnique: vi.fn(async () => null) },
    classroom: {
      findUnique: vi.fn(async () => ({
        id: "old-class",
        ownerId: "teacher",
        stage: "高中",
        cohort: "2027届",
      })),
      findMany: vi.fn(async () => []),
    },
    classroomStudent: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
    paper: {
      findUniqueOrThrow: vi.fn(async () => ({
        ...paper,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    },
    scanSubmission: {
      findFirst: vi.fn(async () => null),
      findUnique: vi.fn(async () => null as ScanSubmission | null),
      create: vi
        .fn<(input: unknown) => Promise<{ id: string }>>()
        .mockResolvedValue({ id: "new-submission" }),
      update: vi.fn(async () => ({ id: "submission" })),
    },
    platformAsset: { findUnique: vi.fn() },
    review: {
      count: vi.fn(async () => 0),
      findMany: vi.fn(async () => []),
      create: vi.fn(async () => ({ id: "saved-review" })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    reviewEvent: { create: vi.fn() },
    aiJob: {
      findUnique: vi.fn(async () => ({
        id: "job",
        kind: "GRADE",
        userId: "teacher",
        status: "RUNNING",
        input: { ...request },
      })),
    },
  };
}
function state(): PlatformState {
  return {
    actor,
    questions: [],
    papers: [paper],
    assessments: [assessment],
    templates: [],
    reviews: [],
    submissions: [submission],
    users: [],
    classrooms: [
      {
        id: "old-class",
        name: "已重命名班级",
        ownerId: "teacher",
        stage: "高中",
        cohort: "2027届",
        students: [
          {
            id: "new-student",
            userId: null,
            name: "后来加入的学生",
            classroomId: "old-class",
            studentNumber: "123456",
          },
        ],
      },
    ],
    analytics: { results: [], knowledge: [], students: [], classrooms: [] },
  } as PlatformState;
}
function saveSubmission(studentId = "old-student", rosterRevision = 3) {
  return executeSubmissionsCommand(db, actor, {
    type: "submission.save",
    submission: {
      assessmentId: "assessment",
      rosterRevision,
      paperId: "paper",
      studentId,
      kind: "WORKBOOK",
      sourceFiles: [],
      answers: submission.answers,
    },
  });
}
function saveReview(source: "HUMAN" | "AI" = "HUMAN") {
  mocks.scanSubmission.findUnique.mockResolvedValue(submission);
  return executeReviewsCommand(
    db,
    actor,
    {
      type: "review.save",
      review: {
        expectedVersion: 0,
        submissionId: "submission",
        itemId: "item",
        round: "FIRST",
        score: 8,
        feedback: "批改",
      },
    },
    { source, ...(source === "AI" ? { jobId: "job" } : {}) },
  );
}
beforeEach(() => {
  assessment = {
    id: "assessment",
    ownerId: "teacher",
    name: "数学作业",
    kind: "HOMEWORK",
    reviewScope: "CLASSROOM",
    classroomIds: ["old-class"],
    published: false,
    rosterRevision: 3,
    rosterStatus: "CONFIRMED",
    participants: [
      { ...participant, subjects: participant.subjects.map((entry) => ({ ...entry })) },
    ],
    createdAt: "",
    papers: [
      {
        paperId: "paper",
        subject: "数学",
        gradingMode: "SINGLE",
        arbitrationThreshold: 2,
        conversion: { enabled: false, bands: [] },
      },
    ],
  };
  mocks = database();
  db = mocks as unknown as Prisma.TransactionClient;
});

it("uses the confirmed participant snapshot despite live class changes and does not persist the input revision on the submission", async () => {
  await expect(saveSubmission()).resolves.toEqual({ id: "new-submission" });
  expect(mocks.classroomStudent.findUnique).not.toHaveBeenCalled();
  expect(mocks.scanSubmission.create.mock.calls[0]?.[0]).not.toHaveProperty("data.rosterRevision");
  const context = await gradingContext(db, state(), request);
  expect(
    context.classroom.students.map((student) => [student.id, student.name, student.studentNumber]),
  ).toEqual([["old-student", "考试时姓名", "123456"]]);
  expect(context.pending.map((entry) => entry.studentId)).toEqual(["old-student"]);
});

it.each(["ABSENT", "EXEMPT", "WITHDRAWN"] as const)(
  "rejects manual and AI consumer paths for %s",
  async (status) => {
    assessment.participants[0].subjects[0].status = status;
    await expect(saveSubmission()).rejects.toThrow("缺考、免考或退出");
    await expect(saveReview()).rejects.toThrow("缺考、免考或退出");
    await expect(saveReview("AI")).rejects.toThrow("缺考、免考或退出");
    await expect(gradingContext(db, state(), request)).rejects.toThrow("没有需要批改的应考学生");
    expect(mocks.scanSubmission.create).not.toHaveBeenCalled();
    expect(mocks.review.create).not.toHaveBeenCalled();
  },
);

it("does not admit a newly enrolled live student or match a removed participant by reused card number", async () => {
  await expect(saveSubmission("new-student")).rejects.toThrow("记录不存在或无权访问");
  await expect(
    gradingContext(db, state(), { ...request, studentIds: ["new-student"] }),
  ).rejects.toThrow("应考名单");
});

it("requires confirmation before scan submissions, human reviews and AI grading", async () => {
  assessment.rosterStatus = "NEEDS_REVIEW";
  await expect(saveSubmission()).rejects.toThrow("核对确认");
  await expect(saveReview()).rejects.toThrow("核对确认");
  await expect(gradingContext(db, state(), request)).rejects.toThrow("核对并确认");
});

it("rejects stale submission and AI grading revisions before any write", async () => {
  await expect(saveSubmission("old-student", 2)).rejects.toThrow("名单已更新");
  await expect(gradingContext(db, state(), { ...request, rosterRevision: 2 })).rejects.toThrow(
    "名单已更新",
  );
  expect(mocks.scanSubmission.create).not.toHaveBeenCalled();
});

it("does not let an old AI job bypass its version by supplying the current submission version", async () => {
  mocks.aiJob.findUnique.mockResolvedValue({
    id: "job",
    kind: "GRADE",
    userId: "teacher",
    status: "RUNNING",
    input: { ...request, rosterRevision: 2 },
  });
  await expect(
    executeSubmissionsCommand(
      db,
      actor,
      {
        type: "submission.save",
        submission: {
          assessmentId: "assessment",
          rosterRevision: 3,
          paperId: "paper",
          studentId: "old-student",
          kind: "WORKBOOK",
          sourceFiles: [],
          answers: submission.answers,
        },
      },
      { source: "AI", jobId: "job" },
    ),
  ).rejects.toThrow("AI 批改期间已更新");
  await expect(saveReview("AI")).rejects.toThrow("AI 批改期间已更新");
  expect(mocks.scanSubmission.create).not.toHaveBeenCalled();
  expect(mocks.review.create).not.toHaveBeenCalled();
});

it("retains complete-review occupancy checks when the participant snapshot is valid", async () => {
  const full = state();
  full.reviews = [
    {
      id: "other",
      version: 1,
      submissionId: "submission",
      itemId: "item",
      reviewerId: "other-teacher",
      round: "FIRST",
      score: 8,
      feedback: "hidden",
      createdAt: "",
    },
  ];
  await expect(
    gradingContext(db, full, { ...request, submissionIds: ["submission"] }),
  ).rejects.toThrow("已有评分");
});
