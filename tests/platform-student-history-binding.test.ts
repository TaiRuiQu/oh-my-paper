import { expect, it, vi } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import type { Assessment, BankQuestion, Paper, PlatformState } from "@/contracts/platform";
import { confirmedRoster } from "./assessment-roster-fixture";
import { executeClassroomsCommand } from "@/server/platform/commands/classrooms";
import { loadState } from "@/server/platform/queries";
vi.mock("@/server/auth/accounts", () => ({
  lockAccounts: vi.fn(),
  insertAccount: vi.fn(),
  nextStudentNumber: vi.fn(),
}));
const date = new Date("2026-11-11T00:00:00Z");
const question: BankQuestion = {
  id: "question",
  ownerId: "owner",
  subject: "数学",
  grade: "高中一年级",
  type: "SUBJECTIVE",
  difficulty: 0.5,
  knowledgeTags: [],
  createdAt: date.toISOString(),
  updatedAt: date.toISOString(),
  content: {
    stem: "计算",
    answers: ["4"],
    explanation: "解答",
    rubric: "满分",
    options: [],
    parts: [],
    images: [],
  },
};
const paper: Paper = {
  id: "paper",
  ownerId: "owner",
  name: "已发布数学卷",
  kind: "EXAM",
  subject: "数学",
  grade: "高中一年级",
  instructions: "",
  layout: { paperSize: "A4", columns: 1 },
  items: [
    {
      id: "item",
      questionId: question.id,
      snapshot: question,
      position: 0,
      section: "",
      score: 10,
    },
  ],
  createdAt: date.toISOString(),
  updatedAt: date.toISOString(),
};
function fixture(initialUserId: string | null = "original") {
  let student = {
    id: "student",
    classroomId: "class",
    name: "小明",
    studentNumber: "123456",
    userId: initialUserId,
  };
  const classroom = () => ({
    id: "class",
    ownerId: "owner",
    name: "一班",
    stage: "高中",
    cohort: "2027届",
    students: [{ ...student, userId: student.userId }],
  });
  const config: Pick<Assessment, "id" | "classroomIds" | "papers"> = {
    id: "assessment",
    classroomIds: ["class"],
    papers: [
      {
        paperId: "paper",
        subject: "数学",
        gradingMode: "SINGLE",
        arbitrationThreshold: 1,
        conversion: { enabled: false, bands: [] },
        questionRules: {},
      },
    ],
  };
  const assessment = {
    ...config,
    ownerId: "owner",
    name: "旧考试",
    kind: "EXAM",
    reviewScope: "CLASSROOM",
    published: true,
    ...confirmedRoster(config, [classroom()]),
    createdAt: date,
    homeworkAssignment: null,
  };
  const submission = {
    id: "submission",
    ownerId: "owner",
    studentId: "student",
    assessmentId: "assessment",
    paperId: "paper",
    templateId: null,
    kind: "MANUAL",
    status: "REVIEWED",
    answers: [{ itemId: "item", text: "本人旧答卷", images: [] }],
    sourceFiles: [],
    alignment: null,
    attemptNumber: 1,
    active: true,
    createdAt: date,
  };
  const review = {
    id: "review",
    version: 1,
    submissionId: "submission",
    itemId: "item",
    reviewerId: "owner",
    round: "FIRST",
    source: "HUMAN",
    score: 8,
    feedback: "原学生专属反馈",
    partScores: [],
    aiJobId: null,
    createdAt: date,
  };
  const api = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        name: where.id,
        role: where.id === "owner" ? "TEACHER" : "STUDENT",
        permissionsVersion: 0,
        teachingAssignments: [],
        username: where.id === "original" ? "123456" : "654321",
        email: `${where.id}@accounts.invalid`,
      })),
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.map((id) => ({
          id,
          username: id === "original" ? "123456" : "654321",
          email: `${id}@accounts.invalid`,
        })),
      ),
    },
    classroom: {
      findUnique: vi.fn(async () => classroom()),
      findMany: vi.fn(
        async ({
          where,
        }: {
          where: { students?: { some: { userId: string } }; id?: { in: string[] } };
        }) =>
          (!where.students || student.userId === where.students.some.userId) &&
          (!where.id || where.id.in.includes("class"))
            ? [classroom()]
            : [],
      ),
    },
    classroomStudent: {
      findUnique: vi.fn(async () => student),
      findFirst: vi.fn(async () => null),
      update: vi.fn(async ({ data }: { data: Partial<typeof student> }) => {
        student = { ...student, ...data };
        return student;
      }),
    },
    assessmentParticipant: { count: vi.fn(async () => 1) },
    teachingParticipant: { count: vi.fn(async () => 0) },
    practiceSession: { count: vi.fn(async () => 0) },
    assessment: {
      findMany: vi.fn(
        async ({
          where,
        }: {
          where: { participants: { some: { student: { userId: string } } } };
        }) => (student.userId === where.participants.some.student.userId ? [assessment] : []),
      ),
    },
    paper: {
      findMany: vi.fn(async ({ where }: { where: { OR: { id?: { in: string[] } }[] } }) =>
        where.OR.some((condition) => condition.id?.in.includes("paper"))
          ? [{ ...paper, readingAssetUrls: [], createdAt: date, updatedAt: date }]
          : [],
      ),
    },
    question: { findMany: vi.fn(async () => []) },
    scanSubmission: {
      count: vi.fn(async () => 1),
      findMany: vi.fn(async ({ where }: { where: { assessmentId: { in: string[] } } }) =>
        where.assessmentId.in.includes("assessment") ? [submission] : [],
      ),
    },
    review: {
      findMany: vi.fn(async ({ where }: { where: { submissionId: { in: string[] } } }) =>
        where.submissionId.in.includes("submission") ? [review] : [],
      ),
    },
  };
  return { api, db: api as unknown as Prisma.TransactionClient };
}
const owner: PlatformState["actor"] = { id: "owner", role: "TEACHER", name: "班级创建者" };
it("keeps real published history accessible to the original managed account and inaccessible to the rejected replacement", async () => {
  const f = fixture();
  const before = await loadState({ id: "original" }, f.db);
  expect(before.analytics.results[0]?.subjects[0]?.grades[0]?.feedback).toBe("原学生专属反馈");
  expect((await loadState({ id: "replacement" }, f.db)).submissions).toEqual([]);
  await expect(
    executeClassroomsCommand(f.db, owner, {
      type: "student.save",
      student: {
        id: "student",
        classroomId: "class",
        name: "小明",
        studentNumber: "123456",
        userId: "replacement",
      },
    }),
  ).rejects.toMatchObject({ status: 409 });
  const after = await loadState({ id: "original" }, f.db),
    other = await loadState({ id: "replacement" }, f.db);
  expect(after.submissions.map((row) => row.id)).toEqual(["submission"]);
  expect(after.analytics.results).toEqual(before.analytics.results);
  expect(other.assessments).toEqual([]);
  expect(other.submissions).toEqual([]);
  expect(other.reviews).toEqual([]);
  expect(other.papers).toEqual([]);
  expect(JSON.stringify(other)).not.toContain("原学生专属反馈");
  expect(f.api.classroomStudent.update).not.toHaveBeenCalled();
});
it("lets a genuinely unbound historical identity receive its first account without changing its frozen report", async () => {
  const f = fixture(null);
  expect((await loadState({ id: "replacement" }, f.db)).assessments).toEqual([]);
  await executeClassroomsCommand(f.db, owner, {
    type: "student.save",
    student: {
      id: "student",
      classroomId: "class",
      name: "小明",
      studentNumber: "123456",
      userId: "replacement",
    },
  });
  const after = await loadState({ id: "replacement" }, f.db);
  expect(after.analytics.results[0]?.subjects[0]?.grades[0]?.feedback).toBe("原学生专属反馈");
  expect(after.assessments[0].participants[0]).toMatchObject({
    name: "小明",
    studentNumber: "123456",
    classroomId: "class",
  });
  expect((await loadState({ id: "original" }, f.db)).reviews).toEqual([]);
  expect(f.api.classroomStudent.update.mock.calls[0][0].data).toMatchObject({
    userId: "replacement",
    name: "小明",
    studentNumber: "123456",
  });
});
