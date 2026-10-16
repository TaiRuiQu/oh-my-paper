import { beforeEach, expect, it, vi } from "vitest";
import type { PlatformState } from "@/contracts/platform";
import { enqueueAiJob } from "@/server/platform/ai-jobs";

const mocks = vi.hoisted(() => ({
  internal: vi.fn(),
  publicState: vi.fn(),
  create: vi.fn(),
  actor: vi.fn(),
  db: vi.fn(),
}));
vi.mock("@/server/platform/queries", () => ({ loadInternalState: mocks.internal }));
vi.mock("@/server/platform/service", () => ({
  getActor: mocks.actor,
  loadState: mocks.publicState,
}));
vi.mock("@/server/db/client", () => ({ getDb: mocks.db }));
vi.mock("@/server/platform/ai/runner", () => ({ runAiTask: vi.fn() }));

const input = {
  assessmentId: "assessment",
  rosterRevision: 3,
  classroomId: "class",
  paperId: "paper",
  assetUrls: [],
  studentIds: [],
};
function state(): PlatformState {
  return {
    actor: { id: "teacher", name: "教师", role: "ADMIN" },
    assessments: [
      {
        id: "assessment",
        kind: "HOMEWORK",
        published: false,
        reviewScope: "CLASSROOM",
        classroomIds: ["class"],
        rosterRevision: 3,
        rosterStatus: "CONFIRMED",
        participants: [
          {
            id: "participant",
            studentId: "student",
            name: "快照姓名",
            studentNumber: "000001",
            classroomId: "class",
            classroomName: "一班",
            stage: "高中",
            cohort: "2027届",
            subjects: [{ paperId: "paper", status: "REQUIRED", reason: "" }],
          },
        ],
        papers: [{ paperId: "paper", subject: "数学" }],
      },
    ],
    classrooms: [{ id: "class", students: [] }],
    papers: [{ id: "paper", items: [{ id: "item" }] }],
    templates: [],
    reviews: [],
    submissions: [
      { id: "submission", assessmentId: "assessment", paperId: "paper", studentId: "student" },
    ],
  } as unknown as PlatformState;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.actor.mockResolvedValue({ id: "teacher", name: "教师", role: "ADMIN" });
  mocks.internal.mockResolvedValue(state());
  mocks.create.mockResolvedValue({ id: "job" });
  const tx = {
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    aiJob: { count: vi.fn(async () => 0), create: mocks.create },
    homeworkAssignment: { findUnique: vi.fn(async () => null) },
    classroom: {
      findUnique: vi.fn(async () => ({ id: "class" })),
      findMany: vi.fn(async () => []),
    },
  };
  mocks.db.mockReturnValue({
    ...tx,
    aiModel: { findFirst: vi.fn(async () => ({ id: "model" })) },
    $transaction: async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx),
  });
});
const enqueue = () => enqueueAiJob("teacher", { kind: "GRADE", modelId: "model", input });

it("checks the same roster version both before and under the creation lock", async () => {
  await expect(enqueue()).resolves.toEqual({ id: "job" });
  expect(mocks.internal).toHaveBeenCalledTimes(2);
  expect(mocks.publicState).not.toHaveBeenCalled();
  expect(mocks.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ input: expect.objectContaining({ rosterRevision: 3 }) }),
    }),
  );
});

it("rejects a stale submitted version before creating a task", async () => {
  const changed = state();
  changed.assessments[0].rosterRevision = 4;
  mocks.internal.mockResolvedValue(changed);
  await expect(enqueue()).rejects.toThrow("名单已更新");
  expect(mocks.create).not.toHaveBeenCalled();
});

it("does not enqueue when the roster changes between initial validation and the queue transaction", async () => {
  const changed = state();
  changed.assessments[0].rosterRevision = 4;
  mocks.internal.mockResolvedValueOnce(state()).mockResolvedValueOnce(changed);
  await expect(enqueue()).rejects.toThrow("名单已更新");
  expect(mocks.create).not.toHaveBeenCalled();
});

it("rejects unconfirmed reconstruction detected under the queue lock", async () => {
  const changed = state();
  changed.assessments[0].rosterStatus = "NEEDS_REVIEW";
  mocks.internal.mockResolvedValueOnce(state()).mockResolvedValueOnce(changed);
  await expect(enqueue()).rejects.toThrow("核对并确认");
  expect(mocks.create).not.toHaveBeenCalled();
});

it("rechecks complete internal review occupancy when hidden first marking arrives during enqueue", async () => {
  const changed = state();
  changed.reviews = [
    {
      id: "other-first",
      version: 1,
      submissionId: "submission",
      itemId: "item",
      round: "FIRST",
      reviewerId: "other",
      score: 8,
      feedback: "hidden",
      createdAt: "",
    },
  ];
  mocks.internal.mockResolvedValueOnce(state()).mockResolvedValueOnce(changed);
  await expect(enqueue()).rejects.toThrow("先录入待批改作答");
  expect(mocks.create).not.toHaveBeenCalled();
});
