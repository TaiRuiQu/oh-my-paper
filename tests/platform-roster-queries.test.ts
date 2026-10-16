import { beforeEach, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Assessment, Classroom, PlatformState } from "@/contracts/platform";
import { loadInternalState } from "@/server/platform/queries";
import { getActor } from "@/server/platform/access";
import { confirmedRoster } from "./assessment-roster-fixture";

vi.mock("@/server/platform/access", async (original) => ({
  ...(await original<typeof import("@/server/platform/access")>()),
  getActor: vi.fn(),
}));
const classroom: Classroom = {
  id: "class",
  ownerId: "teacher",
  name: "原班级",
  stage: "高中",
  cohort: "2027届",
  students: [
    {
      id: "student",
      userId: "account",
      classroomId: "class",
      name: "本人",
      studentNumber: "000001",
    },
    {
      id: "peer",
      userId: "peer-account",
      classroomId: "class",
      name: "不应泄露的同学姓名",
      studentNumber: "000002",
    },
  ],
};
const date = new Date("2026-10-15T00:00:00Z");
let assessment: Assessment;
beforeEach(() => {
  const base = {
    id: "exam",
    ownerId: "teacher",
    name: "考试",
    kind: "EXAM" as const,
    reviewScope: "CLASSROOM" as const,
    classroomIds: ["class"],
    published: true,
    createdAt: date.toISOString(),
    papers: [
      {
        paperId: "math",
        subject: "数学",
        gradingMode: "SINGLE" as const,
        arbitrationThreshold: 2,
        conversion: { enabled: false, bands: [] },
      },
      {
        paperId: "english",
        subject: "英语",
        gradingMode: "SINGLE" as const,
        arbitrationThreshold: 2,
        conversion: { enabled: false, bands: [] },
      },
    ],
  };
  assessment = { ...base, ...confirmedRoster(base, [classroom]) };
});
function database(actor: PlatformState["actor"]) {
  vi.mocked(getActor).mockResolvedValue(actor);
  const db = {
    classroom: { findMany: vi.fn(async () => [classroom]) },
    assessment: {
      findMany: vi.fn(async (input: { where: { rosterStatus?: string; published?: boolean } }) => {
        if (input.where.rosterStatus && assessment.rosterStatus !== input.where.rosterStatus)
          return [];
        return [{ ...assessment, createdAt: date }];
      }),
    },
    paper: {
      findMany: vi.fn(async () =>
        assessment.papers.map((paper) => ({
          ...paper,
          id: paper.paperId,
          ownerId: "teacher",
          name: paper.subject,
          kind: "EXAM",
          grade: "高中一年级",
          instructions: "",
          layout: { paperSize: "A4", columns: 1 },
          items: [],
          createdAt: date,
          updatedAt: date,
        })),
      ),
    },
    question: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
    scanSubmission: { findMany: vi.fn(async () => []) },
    review: { findMany: vi.fn(async () => []) },
    reviewEvent: { findMany: vi.fn(async () => []) },
    cardTemplate: { findMany: vi.fn(async () => []) },
    user: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
  };
  return { db, client: db as unknown as PrismaClient };
}

it.each([
  ["ADMIN", "admin", [], true],
  ["TEACHER", "teacher", [{ role: "HOMEROOM", classroomId: "class" }], true],
  [
    "TEACHER",
    "teacher",
    [{ role: "SUBJECT_TEACHER", classroomId: "class", subject: "数学" }],
    false,
  ],
  ["TEACHER", "other", [{ role: "HOMEROOM", classroomId: "class" }], false],
] as const)(
  "computes complete management authority before scoping %s %s papers",
  async (role, id, assignments, canManage) => {
    const actor = {
      id,
      role,
      name: "教师",
      teachingAssignments: [...assignments],
    } as PlatformState["actor"];
    const { client } = database(actor);
    const state = await loadInternalState({ id }, client);
    expect(state.assessments[0].canManage).toBe(canManage);
    if (assignments[0]?.role === "SUBJECT_TEACHER") {
      expect(state.assessments[0].papers.map((paper) => paper.paperId)).toEqual(["math"]);
      expect(
        state.assessments[0].participants.every((participant) => participant.subjects.length === 1),
      ).toBe(true);
    }
  },
);

it("returns only the student's own participant snapshots while using full peers solely for server ranks", async () => {
  const { client } = database({ id: "account", role: "STUDENT", name: "本人" });
  const state = await loadInternalState({ id: "account" }, client);
  expect(state.assessments[0].participants.map((participant) => participant.studentId)).toEqual([
    "student",
  ]);
  expect(JSON.stringify(state)).not.toContain("不应泄露的同学姓名");
  expect(state.assessments[0].canManage).toBe(false);
});

it("requires confirmed historical reconstruction even when the old assessment was already published", async () => {
  assessment.rosterStatus = "NEEDS_REVIEW";
  const { db, client } = database({ id: "account", role: "STUDENT", name: "本人" });
  const state = await loadInternalState({ id: "account" }, client);
  expect(db.assessment.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({ published: true, rosterStatus: "CONFIRMED" }),
    }),
  );
  expect(state.assessments).toEqual([]);
  expect(state.analytics.results).toEqual([]);
});
