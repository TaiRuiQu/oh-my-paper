import { beforeEach, expect, it, vi } from "vitest";
import { confirmedRoster } from "./assessment-roster-fixture";
import type {
  Assessment,
  BankQuestion,
  Paper,
  PlatformState,
  Review,
  ScanSubmission,
} from "@/contracts/platform";
import { buildAnalytics } from "@/server/platform/analytics";
import { projectReviewVisibility } from "@/server/platform/review-visibility";
import { scopePageState, loadPageState } from "@/server/platform/page-state";
import { loadState, loadInternalState } from "@/server/platform/queries";
import { loadScopedAnalytics } from "@/server/platform/scoped-analytics";
import { gradingContext } from "@/server/platform/grading";
import { getDb } from "@/server/db/client";
import { getActor } from "@/server/platform/access";

vi.mock("@/server/db/client", () => ({ getDb: vi.fn() }));
vi.mock("@/server/platform/access", async (original) => ({
  ...(await original<typeof import("@/server/platform/access")>()),
  getActor: vi.fn(),
}));
const secret = "FIRST_SECRET_KEPT_SERVER_SIDE";
const question = {
  id: "question",
  ownerId: "A",
  type: "MIXED",
  subject: "数学",
  grade: "高中一年级",
  difficulty: 0.5,
  knowledgeTags: ["盲评标签"],
  createdAt: "",
  updatedAt: "",
  content: {
    stem: "计算",
    options: [],
    images: [],
    answers: [],
    explanation: "解析",
    rubric: "评分标准",
    parts: [
      {
        id: "part",
        type: "SUBJECTIVE",
        stem: "小问",
        score: 10,
        options: [],
        answers: ["4"],
        explanation: "",
        rubric: "",
        knowledgeTags: ["盲评小问"],
      },
    ],
  },
} as BankQuestion;
const paper = {
  id: "paper",
  ownerId: "A",
  name: "数学卷",
  kind: "EXAM",
  subject: "数学",
  grade: "高中一年级",
  instructions: "",
  layout: { paperSize: "A4", columns: 1 },
  createdAt: "",
  updatedAt: "",
  items: [{ id: "item", questionId: question.id, score: 10, section: "", snapshot: question }],
} as Paper;
const assessment = {
  rosterRevision: 1,
  rosterStatus: "CONFIRMED",
  participants: [],
  id: "exam",
  ownerId: "A",
  name: "期中",
  kind: "EXAM",
  classroomIds: ["class"],
  published: false,
  reviewScope: "CLASSROOM",
  createdAt: "",
  papers: [
    {
      paperId: "paper",
      subject: "数学",
      gradingMode: "DOUBLE",
      arbitrationThreshold: 1,
      conversion: { enabled: false, bands: [] },
      questionRules: {},
    },
  ],
} as Assessment;
const classroom = {
  id: "class",
  ownerId: "A",
  name: "一班",
  stage: "高中",
  cohort: "2027届",
  students: [
    { id: "student", classroomId: "class", name: "学生", studentNumber: "000001", userId: "S" },
  ],
} as PlatformState["classrooms"][number];
const submission = {
  id: "submission",
  ownerId: "A",
  assessmentId: "exam",
  paperId: "paper",
  studentId: "student",
  templateId: null,
  kind: "CARD",
  status: "REVIEW",
  sourceFiles: [],
  answers: [{ itemId: "item", text: "作答", images: [] }],
  alignment: null,
  createdAt: "",
} as ScanSubmission;
const first = {
  id: "first",
  version: 1,
  submissionId: "submission",
  itemId: "item",
  reviewerId: "A",
  round: "FIRST",
  source: "HUMAN",
  score: 7.25,
  feedback: secret,
  partScores: [{ partId: "part", score: 7.25, feedback: `${secret}_PART` }],
  createdAt: "",
} as Review;
const second = {
  ...first,
  id: "second",
  reviewerId: "B",
  round: "SECOND",
  score: 4,
  feedback: "SECOND_PRIVATE",
  partScores: [{ partId: "part", score: 4, feedback: "SECOND_PART" }],
} as Review;

function fixture(actorId = "B", reviews: Review[] = [first]): PlatformState {
  const state = {
    actor: {
      id: actorId,
      name: actorId,
      role: actorId === "ADMIN" ? "ADMIN" : actorId === "S" ? "STUDENT" : "TEACHER",
      teachingAssignments:
        actorId === "homeroom"
          ? [{ role: "HOMEROOM", classroomId: "class" }]
          : actorId === "director"
            ? [{ role: "GRADE_DIRECTOR", stage: "高中", cohort: "2027届" }]
            : actorId === "school-admin"
              ? [{ role: "SCHOOL_ADMIN" }]
              : actorId === "ADMIN" || actorId === "S"
                ? []
                : [{ role: "SUBJECT_TEACHER", classroomId: "class", subject: "数学" }],
    },
    questions: [question],
    questionCount: 1,
    papers: [paper],
    classrooms: [classroom],
    assessments: [assessment],
    templates: [],
    submissions: [submission],
    reviews,
    reviewHistory: reviews.flatMap((review) => [
      review,
      { ...review, id: `${review.id}-old`, feedback: `${review.feedback}_HISTORY` },
    ]),
    users: [],
  } as unknown as PlatformState;
  state.assessments = state.assessments.map((entry) => ({
    ...entry,
    ...confirmedRoster(entry, state.classrooms),
  }));
  state.analytics = buildAnalytics(state);
  return state;
}
function assertNoSecret(state: unknown) {
  const json = JSON.stringify(state);
  expect(json).not.toContain(secret);
  expect(json).not.toContain("7.25");
}
let active = fixture();
let db: ReturnType<typeof getDb>;
beforeEach(() => {
  vi.clearAllMocks();
  active = fixture();
  const date = new Date("2026-10-15T00:00:00.000Z");
  const fake = {
    classroom: {
      findMany: vi.fn(async () => active.classrooms),
      findUnique: vi.fn(async () => active.classrooms[0]),
    },
    assessment: {
      findMany: vi.fn(async () =>
        active.assessments.map((entry) => ({ ...entry, createdAt: date })),
      ),
    },
    paper: {
      findMany: vi.fn(async () =>
        active.papers.map((entry) => ({ ...entry, createdAt: date, updatedAt: date })),
      ),
    },
    question: {
      findMany: vi.fn(async () =>
        active.questions.map((entry) => ({ ...entry, createdAt: date, updatedAt: date })),
      ),
      count: vi.fn(async () => 1),
    },
    scanSubmission: {
      findMany: vi.fn(async () =>
        active.submissions.map((entry) => ({ ...entry, active: true, createdAt: date })),
      ),
    },
    review: {
      findMany: vi.fn(async () => active.reviews.map((entry) => ({ ...entry, createdAt: date }))),
    },
    reviewEvent: {
      findMany: vi.fn(async () =>
        active.reviewHistory!.map((entry) => ({ ...entry, createdAt: date })),
      ),
    },
    cardTemplate: { findMany: vi.fn(async () => []) },
    user: { findMany: vi.fn(async () => []) },
  };
  db = fake as unknown as ReturnType<typeof getDb>;
  vi.mocked(getDb).mockReturnValue(db);
  vi.mocked(getActor).mockImplementation(async (id) => fixture(id).actor);
});

function inactiveHomework() {
  active = structuredClone(fixture("B"));
  active.assessments[0].kind = "HOMEWORK";
  active.papers[0].kind = "HOMEWORK";
  const date = new Date("2026-10-15T00:00:00Z");
  Object.assign(db.paper, {
    findMany: vi.fn(async (query?: { where?: { id?: { in?: string[] } } }) => {
      const ids = query?.where?.id?.in;
      return active.papers
        .filter((entry) => !ids || ids.includes(entry.id))
        .map((entry) => ({ ...entry, createdAt: date, updatedAt: date }));
    }),
  });
  const old = { ...submission, active: false, createdAt: date };
  const current = { ...old, id: "new-submission", active: true };
  Object.assign(db.scanSubmission, {
    findMany: vi.fn(async (query?: { where?: { OR?: { id?: string; active?: boolean }[] } }) => {
      const where = query?.where;
      return [old, current].filter((row) => {
        const requested = where?.OR?.some((entry) => entry.id === row.id);
        return row.active || requested;
      });
    }),
  });
  return old;
}

it("returns a separately authorized inactive homework without adding it to active queues or analytics", async () => {
  inactiveHomework();
  const baseline = await loadPageState({ id: "B" }, "homework", true);
  const visible = await loadPageState({ id: "B" }, "homework", true, "submission");
  expect(visible.submissions.map((row) => row.id)).toEqual(["new-submission"]);
  expect(visible.requestedReview?.submission.id).toBe("submission");
  expect(visible.analytics).toEqual(baseline.analytics);
  expect(visible.reviews).toEqual([]);
  expect(visible.requestedReview?.reviews).toEqual([]);
  expect(visible.requestedReview?.reviewHistory).toEqual([]);
  expect(visible.requestedReview?.reviewAssignments?.[0]).toMatchObject({
    blind: true,
    rounds: [{ round: "FIRST", reviewerId: "A", source: "HUMAN" }],
  });
  expect(
    visible.requestedReview?.reviewAssignments?.[0].availableRounds.every(
      (round) => !!round.reason,
    ),
  ).toBe(true);
  assertNoSecret(visible);
  assertNoSecret(scopePageState(visible, "homework"));
  expect(baseline.requestedReview).toBeUndefined();
});

it("preserves only the current reviewer's already authorized blind mark and history for an inactive submission", async () => {
  inactiveHomework();
  const visible = await loadPageState({ id: "A" }, "homework", true, "submission");
  expect(visible.requestedReview?.reviews[0].feedback).toBe(secret);
  expect(visible.requestedReview?.reviewHistory).toHaveLength(2);
  expect(visible.submissions.map((row) => row.id)).toEqual(["new-submission"]);
  expect(visible.reviews).toEqual([]);
});

it.each(["homeroom", "revoked"])(
  "does not return inactive source data or saved scores without current marking permission (%s)",
  async (id) => {
    inactiveHomework();
    if (id === "revoked")
      vi.mocked(getActor).mockResolvedValue({
        id: "B",
        name: "B",
        role: "TEACHER",
        teachingAssignments: [],
      });
    const visible = await loadPageState({ id }, "homework", true, "submission");
    expect(visible.requestedReview).toBeUndefined();
    expect(visible.submissions).toEqual([]);
    expect(visible.papers).toEqual([]);
    assertNoSecret(visible);
  },
);

it("does not fall back to a different inactive ID and rejects historical reads outside reviewing areas or from students", async () => {
  inactiveHomework();
  expect(
    (await loadPageState({ id: "B" }, "homework", true, "not-found")).requestedReview,
  ).toBeUndefined();
  await expect(loadPageState({ id: "B" }, "homework", false, "submission")).rejects.toMatchObject({
    status: 400,
  });
  await expect(loadPageState({ id: "B" }, "questions", false, "submission")).rejects.toMatchObject({
    status: 400,
  });
  await expect(loadPageState({ id: "S" }, "homework", true, "submission")).rejects.toMatchObject({
    status: 403,
  });
});

it.each(["B", "C", "ADMIN", "homeroom", "director", "school-admin"])(
  "hides a first mark and all historical/part-score feedback from %s",
  (id) => {
    const full = fixture(id);
    const visible = projectReviewVisibility(full);
    assertNoSecret(visible);
    expect(visible.reviews).toEqual([]);
    expect(visible.reviewHistory).toEqual([]);
    expect(visible.reviewAssignments?.[0]).toMatchObject({
      submissionId: "submission",
      itemId: "item",
      blind: true,
      rounds: [{ round: "FIRST", reviewerId: "A", source: "HUMAN" }],
    });
    if (["homeroom", "director", "school-admin"].includes(id)) {
      expect(
        visible.reviewAssignments?.[0].availableRounds.every(
          (entry) => entry.reason === "当前教学身份无本题阅卷权限",
        ),
      ).toBe(true);
    } else {
      expect(
        visible.reviewAssignments?.[0].availableRounds.find((entry) => entry.round === "FIRST")
          ?.reason,
      ).toContain("其他教师");
      expect(
        visible.reviewAssignments?.[0].availableRounds.find((entry) => entry.round === "SECOND")
          ?.reason,
      ).toBeNull();
    }
    const grade = visible.analytics.results[0].subjects[0].grades[0];
    expect(grade).toMatchObject({ score: null, feedback: "", status: "SECOND" });
    expect(grade).not.toHaveProperty("partScores");
    expect(grade).not.toHaveProperty("calculation");
    expect(visible.analytics.knowledge).toEqual([]);
    expect(visible.analytics.students[0].wrongQuestions).toEqual([]);
    expect(full.reviews[0].feedback).toBe(secret);
  },
);

it("lets the first reviewer read their own mark but excludes it from blind aggregates", () => {
  const visible = projectReviewVisibility(fixture("A"));
  expect(visible.reviews[0].score).toBe(7.25);
  expect(visible.reviewHistory).toHaveLength(2);
  assertNoSecret(visible.analytics);
  expect(visible.analytics.results[0].total).toBeNull();
});

it.each(["A", "B", "C", "ADMIN"])(
  "opens completed human double marking and arbitration to authorized %s",
  (id) => {
    const visible = projectReviewVisibility(fixture(id, [first, second]));
    expect(visible.reviewAssignments?.[0].blind).toBe(false);
    expect(visible.reviews).toHaveLength(2);
    expect(visible.reviewHistory).toHaveLength(4);
    expect(visible.reviews[0].feedback).toBe(secret);
    expect(visible.analytics.results[0].subjects[0].grades[0].status).toBe("ARBITRATION");
    expect(
      visible.reviewAssignments?.[0].availableRounds.find((entry) => entry.round === "ARBITRATION")
        ?.reason === null,
    ).toBe(id === "C" || id === "ADMIN");
  },
);

it.each(["AI", "same reviewer", "second only"])(
  "does not release independent marks for %s",
  (condition) => {
    const reviews =
      condition === "AI"
        ? [{ ...first, source: "AI" as const }, second]
        : condition === "same reviewer"
          ? [first, { ...second, reviewerId: "A" }]
          : [second];
    const visible = projectReviewVisibility(fixture("C", reviews));
    expect(visible.reviewAssignments?.[0].blind).toBe(true);
    expect(visible.reviews).toEqual([]);
    expect(visible.analytics.results[0].subjects[0].score).toBeNull();
    expect(visible.analytics.knowledge).toEqual([]);
    expect(visible.analytics.students[0].wrongQuestions).toEqual([]);
  },
);

it("keeps single marking and published student behavior", () => {
  const single = fixture();
  single.assessments = [
    { ...assessment, papers: [{ ...assessment.papers[0], gradingMode: "SINGLE" }] },
  ];
  single.analytics = buildAnalytics(single);
  expect(projectReviewVisibility(single).reviews[0].feedback).toBe(secret);
  const published = fixture("S", [first, second]);
  published.assessments = [{ ...assessment, published: true }];
  const visible = projectReviewVisibility(published);
  expect(visible.reviews).toEqual([]);
  expect(visible.reviewAssignments).toEqual([]);
  expect(visible.analytics).toEqual(published.analytics);
});

it("protects per-item double rules even when the paper's default is single", () => {
  const full = fixture();
  full.assessments = [
    {
      ...assessment,
      papers: [
        {
          ...assessment.papers[0],
          gradingMode: "SINGLE",
          questionRules: {
            item: { doubleReview: true, arbitrationEnabled: true, maxDifference: 1 },
          },
        },
      ],
    },
  ];
  full.analytics = buildAnalytics(full);
  assertNoSecret(projectReviewVisibility(full));
});

it.each(["workspace", "questions", "exams", "homework", "admin"] as const)(
  "preserves isolation through repeated %s page scoping",
  (area) => {
    const full = fixture("ADMIN");
    const visible = projectReviewVisibility(full);
    const scoped = scopePageState(visible, area);
    assertNoSecret(scoped);
    if (area === "homework") expect(scoped.reviewAssignments).toEqual([]);
    else expect(scoped.reviewAssignments?.[0].rounds).toHaveLength(1);
  },
);

it("sanitizes official subject replacement and all learning aggregates after projection", () => {
  const full = fixture();
  const subject = full.analytics.results[0].subjects[0];
  subject.score = subject.rawScore = 7.25;
  subject.rank = 1;
  Object.assign(subject.grades[0], {
    score: 7.25,
    feedback: secret,
    calculation: `评分${secret}`,
    partScores: first.partScores,
  });
  full.analytics.results[0].total = 7.25;
  const safe = projectReviewVisibility(full);
  assertNoSecret(safe);
  expect(safe.analytics.results[0].subjects[0].rawScore).toBeNull();
  expect(safe.analytics.classrooms[0].average).toBeNull();
});

it("uses complete internal state but projects loadState and SSR's loadPageState", async () => {
  expect((await loadInternalState({ id: "B" }, db)).reviews[0].feedback).toBe(secret);
  assertNoSecret(await loadState({ id: "B" }, db));
  for (const reviewing of [false, true]) {
    const visible = await loadPageState({ id: "B" }, "exams", reviewing);
    assertNoSecret(visible);
    expect(visible.reviewAssignments?.[0].blind).toBe(true);
    if (reviewing) expect(visible.analytics.students).toEqual([]);
  }
});

it.each([
  {},
  { assessmentId: "exam" },
  { classroomId: "class" },
  { studentId: "student" },
  { kind: "EXAM" as const },
])("does not restore hidden marks through scoped analytics %j", async (scope) => {
  assertNoSecret(await loadScopedAnalytics({ id: "B" }, scope));
});

it("keeps GRADE's occupied-answer rejection based on internal reviews", async () => {
  const full = await loadInternalState({ id: "B" }, db, { reviewing: true });
  expect(full.reviews[0].reviewerId).toBe("A");
  await expect(
    gradingContext(db, full, {
      assessmentId: "exam",
      rosterRevision: 1,
      classroomId: "class",
      paperId: "paper",
      assetUrls: [],
      studentIds: [],
      submissionIds: ["submission"],
    }),
  ).rejects.toThrow("已有评分");
});

it("keeps class and subject authorization unchanged across multi-class projection and report scopes", async () => {
  const class2 = {
    ...classroom,
    id: "class-2",
    name: "二班",
    students: [{ ...classroom.students[0], id: "student-2", classroomId: "class-2", userId: "S2" }],
  };
  const englishQuestion = { ...question, id: "english-question", subject: "英语" };
  const english = {
    ...paper,
    id: "english",
    subject: "英语",
    items: [
      {
        ...paper.items[0],
        id: "english-item",
        questionId: englishQuestion.id,
        snapshot: englishQuestion,
      },
    ],
  };
  const multiExam = {
    ...assessment,
    reviewScope: "GRADE" as const,
    classroomIds: ["class", "class-2"],
    papers: [
      ...assessment.papers,
      { ...assessment.papers[0], paperId: "english", subject: "英语" },
    ],
  };
  const class2Math = { ...submission, id: "class2-math", studentId: "student-2" };
  const englishSubmissions = [submission, class2Math].map((entry) => ({
    ...entry,
    id: `${entry.id}-english`,
    paperId: "english",
    answers: [{ itemId: "english-item", text: "English", images: [] }],
  }));
  const completeReviews = (target: ScanSubmission, feedback: string) =>
    [first, second].map((entry) => ({
      ...entry,
      id: `${target.id}-${entry.id}`,
      submissionId: target.id,
      itemId: target.paperId === "english" ? "english-item" : "item",
      score: 4,
      feedback,
      partScores: [{ partId: "part", score: 4, feedback }],
    }));
  active = {
    ...fixture(),
    classrooms: [classroom, class2],
    assessments: [multiExam],
    papers: [paper, english],
    submissions: [submission, class2Math, ...englishSubmissions],
    reviews: [
      first,
      ...completeReviews(class2Math, "CLASS2_ONLY_SECRET"),
      ...englishSubmissions.flatMap((entry) => completeReviews(entry, "ENGLISH_ONLY_SECRET")),
    ],
  };
  active.assessments = active.assessments.map((entry) => ({
    ...entry,
    ...confirmedRoster(entry, active.classrooms),
  }));
  active.reviewHistory = active.reviews;
  active.analytics = buildAnalytics(active);
  Object.assign(db.classroom, {
    findMany: vi.fn(async (input?: { where?: unknown }) => {
      const where = input?.where as { OR?: { id?: string }[]; id?: { in?: string[] } } | undefined;
      if (where?.OR)
        return active.classrooms.filter((entry) =>
          where.OR!.some((clause) => clause.id === entry.id),
        ) as never;
      if (where?.id?.in)
        return active.classrooms.filter((entry) => where.id!.in!.includes(entry.id)) as never;
      return active.classrooms as never;
    }),
  });
  Object.assign(db.paper, {
    findMany: vi.fn(async (input?: { where?: unknown }) => {
      const where = input?.where as
        { id?: { in?: string[] }; OR?: { ownerId?: string; id?: { in?: string[] } }[] } | undefined;
      return active.papers
        .filter(
          (entry) =>
            !where ||
            (where.id?.in
              ? where.id.in.includes(entry.id)
              : where.OR
                ? where.OR.some(
                    (clause) =>
                      clause.ownerId === entry.ownerId || clause.id?.in?.includes(entry.id),
                  )
                : true),
        )
        .map((entry) => ({ ...entry, createdAt: new Date(), updatedAt: new Date() })) as never;
    }),
  });
  vi.mocked(db.question.findMany).mockResolvedValue([]);
  Object.assign(db.review, {
    findMany: vi.fn(async (input?: { where?: unknown }) => {
      const allowed = (input?.where as { submissionId?: { in?: string[] } } | undefined)
        ?.submissionId?.in;
      return active.reviews
        .filter((entry) => !allowed || allowed.includes(entry.submissionId))
        .map((entry) => ({ ...entry, createdAt: new Date() })) as never;
    }),
  });
  Object.assign(db.reviewEvent, {
    findMany: vi.fn(async (input?: { where?: unknown }) => {
      const allowed = (input?.where as { submissionId?: { in?: string[] } } | undefined)
        ?.submissionId?.in;
      return active
        .reviewHistory!.filter((entry) => !allowed || allowed.includes(entry.submissionId))
        .map((entry) => ({ ...entry, createdAt: new Date() })) as never;
    }),
  });
  const loaded = await loadInternalState({ id: "B" }, db);
  const safe = await loadState({ id: "B" }, db);
  const ids = (state: PlatformState) => ({
    papers: state.papers.map((entry) => entry.id),
    submissions: state.submissions.map((entry) => entry.id),
    students: state.classrooms.flatMap((entry) => entry.students.map((student) => student.id)),
  });
  expect(ids(safe)).toEqual(ids(loaded));
  expect(ids(safe)).toEqual({
    papers: ["paper"],
    submissions: ["submission"],
    students: ["student"],
  });
  for (const view of [
    safe,
    scopePageState(safe, "exams"),
    await loadPageState({ id: "B" }, "exams"),
  ]) {
    assertNoSecret(view);
    expect(JSON.stringify(view)).not.toContain("CLASS2_ONLY_SECRET");
    expect(JSON.stringify(view)).not.toContain("ENGLISH_ONLY_SECRET");
    expect(
      view.analytics.results.every(
        (row) =>
          row.classroomId === "class" &&
          row.subjects.every((subject) => subject.paperId === "paper"),
      ),
    ).toBe(true);
  }
  for (const scope of [
    { assessmentId: "exam" },
    { classroomId: "class" },
    { studentId: "student" },
  ]) {
    const analytics = await loadScopedAnalytics({ id: "B" }, scope);
    assertNoSecret(analytics);
    expect(JSON.stringify(analytics)).not.toContain("CLASS2_ONLY_SECRET");
    expect(JSON.stringify(analytics)).not.toContain("ENGLISH_ONLY_SECRET");
  }
  await expect(loadScopedAnalytics({ id: "B" }, { classroomId: "class-2" })).rejects.toThrow(
    "班级不存在",
  );
  const marking = await loadPageState({ id: "B" }, "exams", true);
  expect(marking.submissions.map((entry) => entry.id)).toEqual(["submission", "class2-math"]);
  expect(marking.reviewAssignments?.map((entry) => entry.submissionId)).toEqual([
    "submission",
    "class2-math",
  ]);
  expect(JSON.stringify(marking)).toContain("CLASS2_ONLY_SECRET");
  expect(JSON.stringify(marking)).not.toContain("ENGLISH_ONLY_SECRET");
  expect(marking.analytics.students).toEqual([]);
  expect(marking.analytics.results.every((row) => row.total === null && row.rank === null)).toBe(
    true,
  );
});

it("keeps published full-mark and small-question feedback plus only the student's own answer in every read projection", async () => {
  active = fixture("S", [
    {
      ...first,
      score: 10,
      feedback: "OWN_FULL_FEEDBACK",
      partScores: [{ partId: "part", score: 10, feedback: "OWN_PART_FEEDBACK" }],
    },
  ]);
  active.assessments[0].published = true;
  active.assessments[0].papers[0].gradingMode = "SINGLE";
  active.classrooms[0].students.push({
    ...classroom.students[0],
    id: "peer",
    userId: "PEER",
    name: "PEER_NAME",
  });
  active.assessments[0].participants.push({
    ...active.assessments[0].participants[0],
    id: "peer-participant",
    studentId: "peer",
    name: "PEER_NAME",
  });
  active.submissions.push({
    ...submission,
    id: "peer-scan",
    studentId: "peer",
    answers: [{ itemId: "item", text: "PEER_ANSWER_SECRET", images: ["/PEER_IMAGE_SECRET"] }],
  });
  active.reviews.push({
    ...first,
    id: "peer-review",
    submissionId: "peer-scan",
    feedback: "PEER_FEEDBACK_SECRET",
    partScores: [{ partId: "part", score: 7.25, feedback: "PEER_PART_SECRET" }],
  });
  for (const visible of [
    await loadState({ id: "S" }, db),
    await loadPageState({ id: "S" }, "learning"),
  ]) {
    expect(visible.submissions.map((entry) => entry.studentId)).toEqual(["student"]);
    expect(visible.analytics.results[0].subjects[0].grades[0]).toMatchObject({
      score: 10,
      feedback: "OWN_FULL_FEEDBACK",
      partScores: [{ partId: "part", score: 10, feedback: "OWN_PART_FEEDBACK" }],
    });
    expect(visible.analytics.students[0].wrongQuestions).toEqual([]);
    expect(visible.reviews).toEqual([]);
    expect(visible.reviewHistory).toEqual([]);
    expect(JSON.stringify(visible)).not.toMatch(/PEER_(?:ANSWER|IMAGE|FEEDBACK|PART)_SECRET/);
  }
  const scoped = await loadScopedAnalytics(
    { id: "S" },
    { assessmentId: "exam", studentId: "student" },
  );
  expect(scoped.results[0].subjects[0].grades[0].feedback).toBe("OWN_FULL_FEEDBACK");
  expect(JSON.stringify(scoped)).not.toContain("PEER_FEEDBACK_SECRET");
  await expect(loadScopedAnalytics({ id: "S" }, { studentId: "peer" })).rejects.toMatchObject({
    status: 404,
  });
});

it.each(["unpublished", "unconfirmed"])(
  "requests no student answer or feedback from %s assessments",
  async (condition) => {
    active = fixture("S", [first]);
    active.assessments[0].published = condition === "unconfirmed";
    if (condition === "unconfirmed") active.assessments[0].rosterStatus = "NEEDS_REVIEW";
    const assessmentRead = vi.mocked(db.assessment.findMany).mockResolvedValue([]);
    vi.mocked(db.paper.findMany).mockResolvedValue([]);
    const visible = await loadState({ id: "S" }, db);
    expect(assessmentRead.mock.lastCall?.[0]?.where).toMatchObject({
      published: true,
      rosterStatus: "CONFIRMED",
      participants: { some: { student: { userId: "S" } } },
    });
    expect(visible.assessments).toEqual([]);
    expect(visible.submissions).toEqual([]);
    expect(visible.papers).toEqual([]);
    expect(visible.analytics.results).toEqual([]);
    expect(JSON.stringify(visible)).not.toContain(secret);
  },
);
