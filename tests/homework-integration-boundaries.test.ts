import { beforeEach, expect, it, vi } from "vitest";
import type {
  Assessment,
  BankQuestion,
  Classroom,
  Paper,
  PlatformState,
} from "@/contracts/platform";
import type { ScanSubmission, Review } from "@/generated/prisma/client";
import type { Db } from "@/server/platform/access";
import { confirmedRoster } from "./assessment-roster-fixture";
import { resolveHomeworkDeadline } from "@/lib/homework-time";

const mocks = vi.hoisted(() => ({ actor: vi.fn(), db: {} as Record<string, unknown> }));
vi.mock("@/server/db/client", () => ({ getDb: () => mocks.db }));
vi.mock("@/server/platform/access", async (original) => ({
  ...(await original<object>()),
  getActor: mocks.actor,
}));
import { loadInternalState } from "@/server/platform/queries";
import { gradingContext } from "@/server/platform/grading";
import { executeReviewsCommand } from "@/server/platform/commands/reviews";
import { createGradingFeatures } from "@/server/platform/ai/grading";

const date = new Date("2026-10-15T00:00:00Z");
const question: BankQuestion = {
  id: "question",
  ownerId: "teacher",
  type: "SUBJECTIVE",
  subject: "数学",
  grade: "高中一年级",
  difficulty: 0.5,
  knowledgeTags: ["函数"],
  createdAt: date.toISOString(),
  updatedAt: date.toISOString(),
  content: {
    stem: "计算",
    options: [],
    images: [],
    parts: [],
    answers: ["4"],
    explanation: "解析",
    rubric: "标准",
  },
};
const paper: Paper = {
  id: "paper",
  ownerId: "teacher",
  name: "作业",
  kind: "HOMEWORK",
  subject: "数学",
  grade: "高中一年级",
  instructions: "",
  layout: { paperSize: "A4", columns: 1 },
  createdAt: date.toISOString(),
  updatedAt: date.toISOString(),
  items: [
    {
      id: "item",
      questionId: question.id,
      position: 0,
      score: 10,
      section: "",
      snapshot: question,
    },
  ],
};
const classroom: Classroom = {
  id: "class",
  ownerId: "teacher",
  name: "一班",
  stage: "高中",
  cohort: "2027届",
  students: ["own", "peer"].map((id) => ({
    id,
    classroomId: "class",
    name: id,
    studentNumber: id,
    userId: id === "own" ? "S" : "P",
  })),
};
const assessmentBase: Omit<Assessment, "rosterRevision" | "rosterStatus" | "participants"> = {
  id: "assessment",
  ownerId: "teacher",
  name: "作业安排",
  kind: "HOMEWORK",
  reviewScope: "CLASSROOM",
  classroomIds: ["class"],
  published: true,
  createdAt: date.toISOString(),
  papers: [
    {
      paperId: paper.id,
      subject: "数学",
      gradingMode: "SINGLE",
      arbitrationThreshold: 1,
      conversion: { enabled: false, bands: [] },
      questionRules: {},
    },
  ],
};
const assessment: Assessment = {
  ...assessmentBase,
  ...confirmedRoster(assessmentBase, [classroom]),
};
function submission(
  id: string,
  studentId: string,
  active: boolean,
  attemptNumber: number,
): ScanSubmission {
  return {
    id,
    studentId,
    active,
    attemptNumber,
    ownerId: studentId,
    assessmentId: "assessment",
    paperId: "paper",
    templateId: null,
    kind: "WORKBOOK",
    status: "GRADED",
    sourceFiles: [],
    answers: [{ itemId: "item", text: id, images: [] }],
    alignment: null,
    createdAt: date,
  };
}
const submissions = [
  submission("old-own", "own", false, 1),
  submission("old-peer", "peer", false, 1),
  submission("new-own", "own", true, 2),
  submission("new-peer", "peer", true, 2),
];
const reviews: Review[] = submissions.map((submission, index) => ({
  id: `review-${submission.id}`,
  version: 1,
  submissionId: submission.id,
  itemId: "item",
  reviewerId: "teacher",
  round: "FIRST",
  score: [1, 10, 6, 4][index],
  feedback: submission.id,
  source: "HUMAN",
  aiJobId: null,
  partScores: [],
  createdAt: date,
}));
function fixture() {
  return {
    classroom: {
      findMany: vi.fn(async () => [classroom]),
      findUnique: vi.fn(async () => classroom),
    },
    assessment: { findMany: vi.fn(async () => [{ ...assessment, createdAt: date }]) },
    paper: { findMany: vi.fn(async () => [{ ...paper, createdAt: date, updatedAt: date }]) },
    question: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
    scanSubmission: {
      findMany: vi.fn(
        async (query: { where?: { active?: boolean; studentId?: { in: string[] } } }) =>
          submissions.filter(
            (row) =>
              (query.where?.active === undefined || row.active === query.where.active) &&
              (!query.where?.studentId || query.where.studentId.in.includes(row.studentId)),
          ),
      ),
      findUnique: vi.fn(async () => submissions[0]),
    },
    review: {
      findMany: vi.fn(async (query: { where: { submissionId: { in: string[] } } }) =>
        reviews.filter((row) => query.where.submissionId.in.includes(row.submissionId)),
      ),
    },
    reviewEvent: { findMany: vi.fn(async () => []), create: vi.fn() },
    cardTemplate: { findMany: vi.fn(async () => []) },
    user: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
    homeworkAssignment: { findUnique: vi.fn(async () => ({ id: "online-assignment" })) },
  };
}
let dbMocks: ReturnType<typeof fixture>;
let db: Db;
beforeEach(() => {
  vi.clearAllMocks();
  dbMocks = fixture();
  mocks.db = dbMocks;
  db = dbMocks as unknown as Db;
  mocks.actor.mockResolvedValue({ id: "S", name: "学生", role: "STUDENT" });
});

it("excludes returned attempts both from own results and the private peer aggregation used for authentic ranks", async () => {
  const state = await loadInternalState({ id: "S" }, db);
  expect(state.submissions.map((row) => row.id)).toEqual(["new-own"]);
  expect(state.reviews).toEqual([]);
  expect(dbMocks.review.findMany.mock.calls[0][0].where.submissionId.in).toEqual(["new-own"]);
  const result = state.analytics.results.find((row) => row.studentId === "own")!;
  expect(result.total).toBe(6);
  expect(result.rank).toBe(1);
  expect(result.subjects[0].rank).toBe(1);
  expect(state.analytics.results.some((row) => row.studentId === "peer")).toBe(false);
  expect(dbMocks.scanSubmission.findMany.mock.calls).toHaveLength(2);
  for (const [query] of dbMocks.scanSubmission.findMany.mock.calls)
    expect(query.where?.active).toBe(true);
});

it("rejects an inactive attempt before a human/AI review can create any review event", async () => {
  await expect(
    executeReviewsCommand(
      db,
      { id: "teacher", name: "老师", role: "ADMIN" },
      {
        type: "review.save",
        review: {
          submissionId: "old-own",
          itemId: "item",
          round: "FIRST",
          expectedVersion: 0,
          score: 8,
          feedback: "不得写入",
          partScores: [],
        },
      },
      {},
    ),
  ).rejects.toMatchObject({ status: 409 });
  expect(dbMocks.review.findMany).not.toHaveBeenCalled();
  expect(dbMocks.reviewEvent.create).not.toHaveBeenCalled();
});

it("does not silently replace a frozen old AI submission ID with the currently active resubmission", async () => {
  const state = await loadInternalState({ id: "S" }, db);
  const grading: PlatformState = {
    ...state,
    actor: { id: "teacher", name: "教师", role: "ADMIN" },
    assessments: [{ ...state.assessments[0], published: false }],
    reviews: [],
  };
  const input = {
    assessmentId: "assessment",
    paperId: "paper",
    classroomId: "class",
    rosterRevision: 1,
    assetUrls: [],
    studentIds: [],
    submissionIds: ["old-own"],
  };
  await expect(gradingContext(db, grading, input)).rejects.toThrow("所选答卷不属于");
  const current = await gradingContext(db, grading, { ...input, submissionIds: ["new-own"] });
  expect(current.pending.map((row) => row.id)).toEqual(["new-own"]);
});

it("rejects a persisted online AI task with no fixed submission IDs before creating tools or adopting resubmissions", async () => {
  mocks.actor.mockResolvedValue({ id: "teacher", name: "教师", role: "ADMIN" });
  dbMocks.assessment.findMany.mockResolvedValue([
    { ...assessment, published: false, createdAt: date },
  ]);
  dbMocks.review.findMany.mockResolvedValue([]);
  await expect(
    createGradingFeatures({
      userId: "teacher",
      jobId: "old-job",
      input: {
        assessmentId: "assessment",
        paperId: "paper",
        classroomId: "class",
        rosterRevision: 1,
        assetUrls: [],
        studentIds: [],
      },
    }),
  ).rejects.toMatchObject({ status: 409, message: expect.stringContaining("固定提交轮次") });
});

/** Independent minute enumeration; no offset guessing or transition probing from the implementation. */
function matchingInstants(local: string, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const target = Date.parse(`${local}:00Z`);
  const matches: number[] = [];
  for (let minute = -26 * 60; minute <= 26 * 60; minute++) {
    const value = target + minute * 60000;
    const p = Object.fromEntries(
      formatter.formatToParts(value).map((part) => [part.type, part.value]),
    );
    if (`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}` === local) matches.push(value);
  }
  return matches;
}
it.each([
  ["2026-04-05T01:29", "Australia/Lord_Howe"],
  ["2026-04-05T01:30", "Australia/Lord_Howe"],
  ["2026-04-05T02:00", "Australia/Lord_Howe"],
  ["2026-10-04T02:30", "Australia/Lord_Howe"],
  ["2026-04-05T03:00", "Pacific/Chatham"],
  ["2026-09-27T03:00", "Pacific/Chatham"],
  ["2011-12-30T00:00", "Pacific/Apia"],
  ["2011-12-31T00:00", "Pacific/Apia"],
])("matches an exhaustive UTC minute search at the boundary %s in %s", (local, timezone) => {
  const matches = matchingInstants(local, timezone);
  if (matches.length === 1)
    expect(resolveHomeworkDeadline(local, timezone).getTime()).toBe(matches[0]);
  else
    expect(() => resolveHomeworkDeadline(local, timezone)).toThrow(
      matches.length ? "两次" : "不存在",
    );
});
