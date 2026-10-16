import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import type {
  Assessment,
  BankQuestion,
  Classroom,
  Paper,
  Review,
  ScanSubmission,
} from "@/contracts/platform";
import { buildAnalytics } from "@/server/platform/analytics";
import { commandSchema } from "@/server/platform/schemas";
import { executeAssessmentsCommand } from "@/server/platform/commands/assessments";
import { executeClassroomsCommand } from "@/server/platform/commands/classrooms";
import { reconcileRosterConfiguration } from "@/server/platform/assessment-roster";
import { rosterPublicationReadiness, rosterStudentsForPaper } from "@/lib/assessment-roster";

function fixture() {
  const question: BankQuestion = {
    id: "question",
    ownerId: "teacher",
    subject: "数学",
    grade: "高中一年级",
    type: "SUBJECTIVE",
    difficulty: 0.5,
    knowledgeTags: ["函数"],
    createdAt: "",
    updatedAt: "",
    content: {
      stem: "计算",
      options: [],
      answers: ["1"],
      explanation: "",
      rubric: "",
      parts: [],
      images: [],
    },
  };
  const paper: Paper = {
    id: "paper",
    ownerId: "teacher",
    name: "数学卷",
    subject: "数学",
    grade: "高中一年级",
    kind: "EXAM",
    instructions: "",
    layout: { paperSize: "A4", columns: 1 },
    createdAt: "",
    updatedAt: "",
    items: [
      {
        id: "item",
        position: 0,
        questionId: question.id,
        score: 10,
        section: "计算",
        snapshot: question,
      },
    ],
  };
  const classroom: Classroom = {
    id: "class",
    ownerId: "teacher",
    name: "现在的班名",
    stage: "高中",
    cohort: "2027届",
    students: [
      {
        id: "student",
        classroomId: "class",
        userId: "account",
        name: "现在的姓名",
        studentNumber: "000001",
      },
      { id: "other", classroomId: "class", userId: null, name: "小红", studentNumber: "000002" },
      {
        id: "new",
        classroomId: "class",
        userId: null,
        name: "后加入学生",
        studentNumber: "000003",
      },
    ],
  };
  const assessment: Assessment = {
    id: "exam",
    ownerId: "teacher",
    name: "数学考试",
    kind: "EXAM",
    reviewScope: "CLASSROOM",
    classroomIds: ["class"],
    published: false,
    createdAt: "",
    rosterRevision: 1,
    rosterStatus: "CONFIRMED",
    papers: [
      {
        paperId: "paper",
        subject: "数学",
        gradingMode: "SINGLE",
        arbitrationThreshold: 2,
        conversion: { enabled: false, bands: [] },
      },
    ],
    participants: [
      {
        id: "participant",
        studentId: "student",
        classroomId: "class",
        classroomName: "原班名",
        name: "原姓名",
        studentNumber: "000001",
        stage: "高中",
        cohort: "2027届",
        subjects: [{ paperId: "paper", status: "REQUIRED", reason: "" }],
      },
      {
        id: "other-participant",
        studentId: "other",
        classroomId: "class",
        classroomName: "原班名",
        name: "小红",
        studentNumber: "000002",
        stage: "高中",
        cohort: "2027届",
        subjects: [{ paperId: "paper", status: "ABSENT", reason: "请假缺考" }],
      },
    ],
  };
  const submission: ScanSubmission = {
    id: "submission",
    ownerId: "teacher",
    assessmentId: "exam",
    paperId: "paper",
    studentId: "student",
    templateId: null,
    kind: "WORKBOOK",
    status: "GRADED",
    sourceFiles: [],
    answers: [{ itemId: "item", text: "1", images: [] }],
    alignment: null,
    createdAt: "",
  };
  const review: Review = {
    id: "review",
    version: 1,
    submissionId: "submission",
    itemId: "item",
    reviewerId: "teacher",
    round: "FIRST",
    score: 10,
    feedback: "正确",
    source: "HUMAN",
    createdAt: "",
  };
  const input = {
    questions: [question],
    papers: [paper],
    classrooms: [classroom],
    assessments: [assessment],
    submissions: [submission],
    reviews: [review],
  };
  return { assessment, classroom, paper, input };
}

describe("immutable assessment participation", () => {
  it("uses participant identity and class snapshots rather than changed current students", () => {
    const { assessment, input } = fixture();
    input.classrooms[0].students = input.classrooms[0].students.filter(
      (student) => student.id !== "student",
    );
    const result = buildAnalytics(input);
    expect(result.results).toHaveLength(2);
    expect(result.results.find((row) => row.studentId === "student")).toMatchObject({
      studentName: "原姓名",
      classroomName: "原班名",
      total: 10,
    });
    expect(result.results.some((row) => row.studentId === "new")).toBe(false);
    expect(result.students.some((row) => row.studentId === "new")).toBe(false);
    expect(result.students.find((row) => row.studentId === "student")?.subjects).toHaveLength(1);
    expect(rosterPublicationReadiness(assessment, result.results)).toMatchObject({
      ready: true,
      expected: 2,
      unfinished: [],
    });
  });

  it.each(["ABSENT", "EXEMPT"] as const)(
    "publishes confirmed %s without inventing zero scores or ranks",
    (status) => {
      const { assessment, input } = fixture();
      assessment.participants[1].subjects[0].status = status;
      assessment.papers[0].conversion = {
        enabled: true,
        bands: [{ upperPercent: 100, min: 30, max: 100 }],
      };
      const analytics = buildAnalytics(input);
      expect(analytics.results.find((row) => row.studentId === "other")).toMatchObject({
        total: null,
        rank: null,
        subjects: [
          { participationStatus: status, rawScore: null, score: null, rank: null, grades: [] },
        ],
      });
      expect(analytics.results[0].subjects[0].score).toBe(100);
      expect(rosterStudentsForPaper(assessment, "paper").map((student) => student.id)).toEqual([
        "student",
      ]);
      expect(rosterPublicationReadiness(assessment, analytics.results).ready).toBe(true);
    },
  );

  it("blocks incomplete required scoring and unconfirmed reconstructed rosters", () => {
    const { assessment, input } = fixture();
    assessment.participants[1].subjects[0] = {
      paperId: "paper",
      status: "REQUIRED",
      reason: "恢复参加",
    };
    expect(rosterPublicationReadiness(assessment, buildAnalytics(input).results)).toMatchObject({
      ready: false,
      expected: 2,
    });
    assessment.participants[1].subjects[0].status = "EXEMPT";
    assessment.rosterStatus = "NEEDS_REVIEW";
    const unconfirmed = buildAnalytics(input);
    expect(rosterPublicationReadiness(assessment, unconfirmed.results).ready).toBe(false);
    expect(unconfirmed.results[0]).toMatchObject({
      total: null,
      rank: null,
      classRank: null,
      totalRestricted: true,
    });
    expect(unconfirmed.results[0].subjects[0]).toMatchObject({ rawScore: 10, rank: null });
  });

  it("retains original answers and grades while withdrawing a participant from statistics", () => {
    const { assessment, input } = fixture();
    assessment.participants[0].subjects[0] = {
      paperId: "paper",
      status: "WITHDRAWN",
      reason: "本次名单误报",
    };
    const before = structuredClone({ submissions: input.submissions, reviews: input.reviews });
    const analytics = buildAnalytics(input);
    expect(analytics.results.map((row) => row.studentId)).toEqual(["other"]);
    expect({ submissions: input.submissions, reviews: input.reviews }).toEqual(before);
  });

  it("does not total-rank students with an exempt subject", () => {
    const { assessment, input, paper } = fixture();
    input.papers.push({ ...paper, id: "second", subject: "英语" });
    assessment.papers.push({ ...assessment.papers[0], paperId: "second", subject: "英语" });
    for (const participant of assessment.participants)
      participant.subjects.push({ paperId: "second", status: "EXEMPT", reason: "批准免考" });
    const analytics = buildAnalytics(input);
    expect(analytics.results[0]).toMatchObject({ total: null, rank: null, classRank: null });
    expect(analytics.results[0].subjects[0].score).toBe(10);
    expect(rosterPublicationReadiness(assessment, analytics.results).ready).toBe(true);
  });
});

function commandDb() {
  const { assessment, classroom } = fixture();
  const participantRows = assessment.participants.map((participant) => ({
    ...participant,
    assessmentId: assessment.id,
    subjects: participant.subjects.map((subject) => ({
      ...subject,
      id: `${participant.id}-${subject.paperId}`,
      participantId: participant.id,
    })),
  }));
  const db = {
    $queryRaw: vi.fn(),
    assessment: {
      findUnique: vi.fn().mockResolvedValue({ ...assessment, participants: participantRows }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn().mockResolvedValue({ id: "created" }),
      update: vi.fn().mockResolvedValue({ id: "exam" }),
    },
    classroom: {
      findMany: vi.fn().mockResolvedValue([classroom]),
      findUnique: vi.fn().mockResolvedValue(classroom),
    },
    classroomStudent: {
      findMany: vi.fn().mockResolvedValue(classroom.students),
      findUnique: vi.fn().mockResolvedValue(classroom.students[0]),
      delete: vi.fn(),
    },
    assessmentParticipant: {
      findMany: vi.fn().mockResolvedValue(participantRows),
      count: vi.fn().mockResolvedValue(1),
      create: vi.fn().mockImplementation(async ({ data }) => ({
        id: "added",
        ...data,
        subjects: data.subjects.create,
      })),
    },
    teachingParticipant: { count: vi.fn().mockResolvedValue(0) },
    practiceSession: { count: vi.fn().mockResolvedValue(0) },
    assessmentParticipantSubject: { update: vi.fn(), create: vi.fn() },
    assessmentRosterEvent: { create: vi.fn() },
    scanSubmission: { count: vi.fn().mockResolvedValue(0) },
    homeworkAssignment: { findUnique: vi.fn(async () => null) },
    user: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ id: "account", role: "STUDENT", email: "student@example.test" }),
    },
    paper: { findMany: vi.fn().mockResolvedValue(fixture().input.papers) },
  };
  return { db, assessment, classroom, transaction: db as unknown as Prisma.TransactionClient };
}
const admin = { id: "admin", name: "管理员", role: "ADMIN" } as const;
function rosterCommand(extra: Record<string, unknown> = {}) {
  return commandSchema.parse({
    type: "assessment.roster.update",
    id: "exam",
    expectedRevision: 1,
    reason: "核对本次名单",
    changes: [
      {
        participantId: "other-participant",
        paperId: "paper",
        status: "EXEMPT",
        reason: "批准免考",
      },
    ],
    ...extra,
  });
}

describe("roster command validation and persistence", () => {
  it("creates initial participant snapshots and an audit event in the arrangement transaction", async () => {
    const { db, transaction, assessment } = commandDb();
    await executeAssessmentsCommand(
      transaction,
      admin,
      commandSchema.parse({
        type: "assessment.save",
        assessment: {
          name: "新考试",
          kind: "EXAM",
          reviewScope: "CLASSROOM",
          classroomIds: ["class"],
          papers: assessment.papers,
        },
      }),
    );
    expect(db.assessmentParticipant.create).toHaveBeenCalledTimes(3);
    expect(db.assessmentParticipant.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          assessmentId: "created",
          studentId: "student",
          name: "现在的姓名",
          classroomName: "现在的班名",
          studentNumber: "000001",
        }),
      }),
    );
    expect(db.assessmentRosterEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ assessmentId: "created", revision: 1, actorId: "admin" }),
      }),
    );
  });

  it("adds only explicitly selected new students and confirms reconstructed rosters explicitly", async () => {
    const { db, transaction, assessment } = commandDb();
    db.assessment.findUnique.mockResolvedValueOnce({ ...assessment, rosterStatus: "NEEDS_REVIEW" });
    await executeAssessmentsCommand(
      transaction,
      admin,
      rosterCommand({ changes: [], addStudentIds: ["new"], confirmReconstruction: true }),
    );
    expect(db.assessmentParticipant.create).toHaveBeenCalledOnce();
    expect(db.assessmentParticipant.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ studentId: "new", name: "后加入学生" }),
      }),
    );
    expect(db.assessment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { rosterRevision: 2, rosterStatus: "CONFIRMED" } }),
    );
  });

  it("does not regenerate an existing roster when saving unchanged class and subject scope", async () => {
    const { db, transaction, assessment } = commandDb();
    await executeAssessmentsCommand(
      transaction,
      admin,
      commandSchema.parse({
        type: "assessment.save",
        assessment: {
          id: "exam",
          name: "重命名考试",
          kind: "EXAM",
          reviewScope: "CLASSROOM",
          classroomIds: ["class"],
          papers: assessment.papers,
        },
      }),
    );
    expect(db.assessmentParticipant.create).not.toHaveBeenCalled();
    expect(db.assessmentParticipantSubject.update).not.toHaveBeenCalled();
    expect(db.assessmentRosterEvent.create).not.toHaveBeenCalled();
    expect(db.assessment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ rosterRevision: expect.anything() }),
      }),
    );
  });
  it("rejects missing reasons, duplicate changes, and empty operations", () => {
    expect(() => rosterCommand({ reason: " " })).toThrow();
    expect(() =>
      rosterCommand({
        changes: [{ participantId: "participant", paperId: "paper", status: "ABSENT", reason: "" }],
      }),
    ).toThrow();
    expect(() => rosterCommand({ changes: [] })).toThrow();
    const change = {
      participantId: "participant",
      paperId: "paper",
      status: "ABSENT",
      reason: "请假",
    };
    expect(() => rosterCommand({ changes: [change, change] })).toThrow();
  });

  it("records before/after subject states with a new revision and preserves submissions", async () => {
    const { db, transaction } = commandDb();
    await executeAssessmentsCommand(transaction, admin, rosterCommand());
    expect(db.assessmentParticipantSubject.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "EXEMPT", reason: "批准免考" } }),
    );
    expect(db.assessment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "exam", rosterRevision: 1, published: false },
        data: { rosterRevision: 2 },
      }),
    );
    expect(db.assessmentRosterEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          revision: 2,
          actorId: "admin",
          changes: expect.objectContaining({
            changes: [
              expect.objectContaining({
                before: expect.objectContaining({ status: "ABSENT" }),
                after: { status: "EXEMPT", reason: "批准免考" },
              }),
            ],
          }),
        }),
      }),
    );
    expect(db.scanSubmission.count).not.toHaveBeenCalled();
  });

  it.each(["published", "stale", "non-owner"])(
    "rejects %s changes before any writes",
    async (condition) => {
      const { db, transaction, assessment } = commandDb();
      if (condition === "published")
        db.assessment.findUnique.mockResolvedValueOnce({ ...assessment, published: true });
      await expect(
        executeAssessmentsCommand(
          transaction,
          condition === "non-owner" ? { id: "other", role: "TEACHER", name: "任课老师" } : admin,
          rosterCommand(condition === "stale" ? { expectedRevision: 99 } : {}),
        ),
      ).rejects.toThrow();
      expect(db.assessmentParticipantSubject.update).not.toHaveBeenCalled();
      expect(db.assessmentRosterEvent.create).not.toHaveBeenCalled();
    },
  );

  it.each(["assessment.rename", "assessment.publish"] as const)(
    "rejects %s when the owner has lost access to an original subject",
    async (type) => {
      const { db, transaction, assessment } = commandDb();
      db.assessment.findUnique.mockResolvedValueOnce({
        ...assessment,
        papers: [
          ...assessment.papers,
          { ...assessment.papers[0], paperId: "english", subject: "英语" },
        ],
      });
      const command = commandSchema.parse(
        type === "assessment.rename"
          ? { type, id: "exam", name: "新名称" }
          : { type, id: "exam", published: false },
      );
      await expect(
        executeAssessmentsCommand(
          transaction,
          {
            id: "teacher",
            role: "TEACHER",
            name: "原创建教师",
            teachingAssignments: [
              { role: "SUBJECT_TEACHER", classroomId: "class", subject: "数学" },
            ],
          },
          command,
        ),
      ).rejects.toThrow("无权访问");
      expect(db.assessment.update).not.toHaveBeenCalled();
    },
  );

  it("keeps existing withdrawn subject states when confirming a new configuration", async () => {
    const { db, transaction, assessment } = commandDb();
    const participant = {
      ...assessment.participants[0],
      subjects: [
        {
          id: "subject",
          participantId: "participant",
          paperId: "paper",
          status: "WITHDRAWN",
          reason: "此前已退出",
        },
      ],
    };
    db.assessmentParticipant.findMany.mockResolvedValueOnce([participant]);
    db.classroomStudent.findMany.mockResolvedValueOnce([fixture().classroom.students[0]]);
    await reconcileRosterConfiguration(
      transaction,
      "exam",
      ["class"],
      assessment.papers,
      ["student"],
      "调整安排",
    );
    expect(db.assessmentParticipantSubject.update).not.toHaveBeenCalled();
    expect(db.assessmentParticipantSubject.create).not.toHaveBeenCalled();
    expect(db.assessmentParticipant.create).not.toHaveBeenCalled();
  });

  it("retains an earlier withdrawal reason when an already withdrawn student remains unselected", async () => {
    const { db, transaction, assessment } = commandDb();
    const withdrawn = {
      ...assessment.participants[0],
      subjects: [
        {
          id: "old-withdrawal",
          participantId: "participant",
          paperId: "paper",
          status: "WITHDRAWN",
          reason: "原始退出原因",
        },
      ],
    };
    const active = {
      ...assessment.participants[1],
      subjects: [
        {
          id: "new-withdrawal",
          participantId: "other-participant",
          paperId: "paper",
          status: "REQUIRED",
          reason: "",
        },
      ],
    };
    db.assessmentParticipant.findMany.mockResolvedValueOnce([withdrawn, active]);
    db.classroomStudent.findMany.mockResolvedValueOnce([]);
    const changes = await reconcileRosterConfiguration(
      transaction,
      "exam",
      ["class"],
      assessment.papers,
      [],
      "本次范围调整",
    );
    expect(db.assessmentParticipantSubject.update).toHaveBeenCalledExactlyOnceWith({
      where: { id: "new-withdrawal" },
      data: { status: "WITHDRAWN", reason: "本次范围调整" },
    });
    expect(changes.before[0].subjects[0].reason).toBe("原始退出原因");
    expect(withdrawn.subjects[0].reason).toBe("原始退出原因");
  });

  it("protects classroom history even when the student never joined an assessment", async () => {
    const { db, transaction } = commandDb();
    db.assessmentParticipant.count.mockResolvedValue(0);
    db.teachingParticipant.count.mockResolvedValue(1);
    const previous = await db.classroomStudent.findUnique();
    await expect(
      executeClassroomsCommand(
        transaction,
        admin,
        commandSchema.parse({ type: "student.delete", id: "student" }),
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(db.classroomStudent.delete).not.toHaveBeenCalled();
    await expect(
      executeClassroomsCommand(
        transaction,
        admin,
        commandSchema.parse({
          type: "student.save",
          student: {
            id: "student",
            classroomId: "class",
            studentNumber: "000001",
            name: "另一位学生",
          },
        }),
      ),
    ).rejects.toThrow("身份资料不能直接修改");
    await expect(
      executeClassroomsCommand(
        transaction,
        admin,
        commandSchema.parse({
          type: "student.save",
          student: {
            id: "student",
            classroomId: "class",
            studentNumber: "000001",
            name: previous.name,
            userId: "another-account",
          },
        }),
      ),
    ).rejects.toThrow("身份不能更改");
  });

  it("protects independent practice identity including managed accounts with no formal history", async () => {
    const { db, transaction } = commandDb();
    db.assessmentParticipant.count.mockResolvedValue(0);
    db.practiceSession.count.mockResolvedValue(1);
    db.user.findUnique.mockResolvedValue({
      id: "account",
      role: "STUDENT",
      email: "managed@accounts.invalid",
    });
    const previous = await db.classroomStudent.findUnique();
    await expect(
      executeClassroomsCommand(
        transaction,
        admin,
        commandSchema.parse({ type: "student.delete", id: "student" }),
      ),
    ).rejects.toThrow("自主练习记录");
    expect(db.classroomStudent.delete).not.toHaveBeenCalled();
    await expect(
      executeClassroomsCommand(
        transaction,
        admin,
        commandSchema.parse({
          type: "student.save",
          student: {
            id: "student",
            classroomId: "class",
            studentNumber: previous.studentNumber,
            name: "另一位学生",
          },
        }),
      ),
    ).rejects.toThrow("身份资料不能直接修改");
    await expect(
      executeClassroomsCommand(
        transaction,
        admin,
        commandSchema.parse({
          type: "student.save",
          student: {
            id: "student",
            classroomId: "class",
            studentNumber: previous.studentNumber,
            name: previous.name,
            userId: "another-account",
          },
        }),
      ),
    ).rejects.toThrow("身份不能更改");
  });

  it("protects a participant without submissions from student deletion and identity changes", async () => {
    const { db, transaction } = commandDb();
    await expect(
      executeClassroomsCommand(
        transaction,
        admin,
        commandSchema.parse({ type: "student.delete", id: "student" }),
      ),
    ).rejects.toThrow("参试名单");
    expect(db.classroomStudent.delete).not.toHaveBeenCalled();
    await expect(
      executeClassroomsCommand(
        transaction,
        admin,
        commandSchema.parse({
          type: "student.save",
          student: { id: "student", classroomId: "class", studentNumber: "000001", name: "其他人" },
        }),
      ),
    ).rejects.toThrow("身份资料不能直接修改");
  });
});
