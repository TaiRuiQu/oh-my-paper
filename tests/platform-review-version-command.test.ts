import { beforeEach, expect, it, vi } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import type { PlatformState, Review } from "@/contracts/platform";
import { executeReviewsCommand } from "@/server/platform/commands/reviews";
import { commandSchema } from "@/server/platform/schemas";

vi.mock("@/server/platform/access", async (original) => ({
  ...(await original<object>()),
  assertCanUseAssessmentParticipant: vi.fn(async () => ({ classroomId: "class" })),
}));
const actor: PlatformState["actor"] = { id: "teacher", name: "教师", role: "TEACHER" };
const assessment = {
  id: "exam",
  published: false,
  kind: "HOMEWORK",
  rosterRevision: 1,
  rosterStatus: "CONFIRMED",
  participants: [],
  papers: [{ paperId: "paper", gradingMode: "DOUBLE", arbitrationThreshold: 2, subject: "数学" }],
};
const paper = {
  id: "paper",
  createdAt: new Date(),
  updatedAt: new Date(),
  items: [{ id: "item", score: 10, snapshot: { type: "SUBJECTIVE", content: { parts: [] } } }],
};
let rows: Review[], audit: unknown[], db: Prisma.TransactionClient;
let mocks: ReturnType<typeof database>;
function database() {
  return {
    scanSubmission: {
      findUnique: vi.fn(async () => ({
        id: "submission",
        active: true,
        assessmentId: "exam",
        paperId: "paper",
        studentId: "student",
        createdAt: new Date(),
      })),
      update: vi.fn(),
    },
    assessment: { findUnique: vi.fn(async () => ({ ...assessment, createdAt: new Date() })) },
    paper: { findUniqueOrThrow: vi.fn(async () => paper) },
    review: {
      findMany: vi.fn(async () => rows),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: "review", createdAt: new Date(), ...data };
        rows.push(row as unknown as Review);
        return row;
      }),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; version: number };
          data: Record<string, unknown>;
        }) => {
          const index = rows.findIndex((r) => r.id === where.id && r.version === where.version);
          if (index === -1) return { count: 0 };
          rows[index] = { ...rows[index], ...data };
          return { count: 1 };
        },
      ),
    },
    reviewEvent: {
      create: vi.fn(async (input: unknown) => {
        audit.push(input);
        return input;
      }),
    },
    aiJob: {
      findUnique: vi.fn(async () => ({
        id: "job",
        userId: "teacher",
        kind: "GRADE",
        status: "RUNNING",
        input: { assessmentId: "exam", paperId: "paper", classroomId: "class", rosterRevision: 1 },
      })),
    },
  };
}
const input = (expectedVersion: number, score = 8) => ({
  type: "review.save" as const,
  review: {
    submissionId: "submission",
    itemId: "item",
    round: "FIRST" as const,
    expectedVersion,
    score,
    feedback: `feedback${score}`,
  },
});
const save = (expectedVersion: number, score = 8, ai = false) =>
  executeReviewsCommand(
    db,
    actor,
    input(expectedVersion, score),
    ai ? { source: "AI", jobId: "job" } : {},
  );
beforeEach(() => {
  rows = [];
  audit = [];
  mocks = database();
  db = mocks as unknown as Prisma.TransactionClient;
});

it("requires an explicit nonnegative integer baseline in the public command", () => {
  expect(commandSchema.safeParse(input(0)).success).toBe(true);
  expect(commandSchema.safeParse(input(1)).success).toBe(true);
  const missing = input(0);
  delete (missing.review as { expectedVersion?: number }).expectedVersion;
  expect(commandSchema.safeParse(missing).success).toBe(false);
  expect(commandSchema.safeParse(input(-1)).success).toBe(false);
  expect(commandSchema.safeParse(input(1.5)).success).toBe(false);
});

it("creates version one and increments a matching baseline, recording only accepted versions", async () => {
  await expect(save(0)).resolves.toEqual({ id: "review", reviewVersion: 1 });
  await expect(save(1, 6)).resolves.toEqual({ id: "review", reviewVersion: 2 });
  expect(rows[0]).toMatchObject({ version: 2, score: 6 });
  expect(rows[0]).not.toHaveProperty("expectedVersion");
  expect(audit).toEqual([
    expect.objectContaining({ data: expect.objectContaining({ version: 1, score: 8 }) }),
    expect.objectContaining({ data: expect.objectContaining({ version: 2, score: 6 }) }),
  ]);
  expect(audit[0]).not.toHaveProperty("data.expectedVersion");
});

it("rejects both a stale absence baseline and a stale update without score, status, or audit writes", async () => {
  await save(0);
  await save(1, 6);
  mocks.review.create.mockClear();
  mocks.review.updateMany.mockClear();
  mocks.reviewEvent.create.mockClear();
  mocks.scanSubmission.update.mockClear();
  for (const stale of [0, 1]) await expect(save(stale, 9)).rejects.toMatchObject({ status: 409 });
  expect(rows[0]).toMatchObject({ version: 2, score: 6 });
  expect(mocks.review.create).not.toHaveBeenCalled();
  expect(mocks.review.updateMany).not.toHaveBeenCalled();
  expect(mocks.reviewEvent.create).not.toHaveBeenCalled();
  expect(mocks.scanSubmission.update).not.toHaveBeenCalled();
});

it("treats equal score and feedback as a new accepted version rather than bypassing concurrency", async () => {
  await save(0);
  await save(1);
  await expect(save(1)).rejects.toMatchObject({ status: 409 });
  expect(rows[0].version).toBe(2);
  expect(audit).toHaveLength(2);
});

it("checks compare-and-swap before appending an audit event", async () => {
  await save(0);
  mocks.reviewEvent.create.mockClear();
  mocks.scanSubmission.update.mockClear();
  mocks.review.updateMany.mockResolvedValueOnce({ count: 0 });
  await expect(save(1, 9)).rejects.toMatchObject({ status: 409 });
  expect(mocks.reviewEvent.create).not.toHaveBeenCalled();
  expect(mocks.scanSubmission.update).not.toHaveBeenCalled();
});

it("preserves ownership checks even when a caller knows the current version", async () => {
  await save(0);
  rows[0].reviewerId = "other";
  await expect(save(1)).rejects.toMatchObject({ status: 403 });
  expect(audit).toHaveLength(1);
});

it("binds AI to an unreviewed version zero and refuses to adopt an existing human or AI version", async () => {
  await expect(save(0, 8, true)).resolves.toMatchObject({ reviewVersion: 1 });
  expect(rows[0]).toMatchObject({ source: "AI", version: 1 });
  await expect(save(1, 9, true)).rejects.toMatchObject({ status: 409 });
  await expect(save(0, 9, true)).rejects.toMatchObject({ status: 409 });
  expect(rows[0].score).toBe(8);
  expect(audit).toHaveLength(1);
});

it("rejects AI even when only another round is occupied", async () => {
  await save(0);
  rows[0].round = "SECOND";
  rows[0].reviewerId = "other";
  await expect(save(0, 8, true)).rejects.toMatchObject({ status: 409 });
  expect(audit).toHaveLength(1);
});
