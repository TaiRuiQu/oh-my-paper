import { beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { PlatformState } from "@/contracts/platform";
import type { TeachingBinding } from "@/contracts/teaching";
import type { SessionRow } from "@/server/platform/teaching/context";
const mocks = vi.hoisted(() => ({ actor: vi.fn() }));
vi.mock("@/server/platform/access", async (original) => ({
  ...(await original<object>()),
  getActor: mocks.actor,
}));
import { loadTeachingSessions } from "@/server/platform/teaching/service";
const id = (key: string) =>
  `${key.repeat(8)}-${key.repeat(4)}-4${key.repeat(3)}-8${key.repeat(3)}-${key.repeat(12)}`;
const day = (n: number) => new Date(`2026-11-${String(n).padStart(2, "0")}T00:00:00Z`);
let actor: PlatformState["actor"], rows: SessionRow[], bindings: Map<string, TeachingBinding>;
function record(
  key: string,
  n: number,
  options: {
    owner?: string;
    assigned?: string;
    status?: string;
    actualDate?: string;
    termId?: string;
    differentClass?: boolean;
  } = {},
): SessionRow {
  const owner = options.owner ?? "teacher",
    teacher = options.assigned ?? owner;
  const binding: TeachingBinding = {
    publicationId: `pub-${key}`,
    publicationRevision: 1,
    timezone: "Asia/Shanghai",
    lessonIds: [`lesson-${key}`],
    lessons: [
      {
        id: `snapshot-${key}`,
        termId: options.termId ?? "term",
        offeringId: "offering",
        slotId: key,
        originalDate: "2026-11-01",
        date: "2026-11-01",
        startTime: "08:00",
        endTime: "08:40",
        periodNames: ["第一节"],
        courseId: "math",
        courseName: "数学",
        classroomId: "class",
        classroomName: "一班",
        teacherId: owner,
        teacherName: owner,
        roomId: null,
        roomName: null,
        status: "SCHEDULED",
        reason: "",
      },
    ],
  };
  const latest = structuredClone(binding);
  latest.lessons[0].teacherId = teacher;
  if (options.actualDate) latest.lessons[0].date = options.actualDate;
  if (options.differentClass) latest.lessons[0].classroomId = "other-class";
  bindings.set(key, latest);
  return {
    id: id(key),
    termId: options.termId ?? "term",
    slotId: key,
    originalDate: "2026-11-01",
    teacherId: owner,
    version: 1,
    bindingVersion: 1,
    status: options.status ?? "NOT_STARTED",
    binding: z.json().parse(binding),
    planVersion: 0,
    confirmedPlanVersion: null,
    rosterFingerprint: null,
    rosterConfirmed: false,
    summary: "",
    reflection: "",
    startedAt: options.status === "IN_PROGRESS" || options.status === "COMPLETED" ? day(1) : null,
    finishedAt: options.status === "COMPLETED" ? day(2) : null,
    interruptedAt: null,
    createdAt: day(n),
    participants: [],
    plans: [],
  };
}
type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as ObjectValue)
    : {};
}
function matches(value: unknown, where: unknown): boolean {
  const row = object(value);
  return Object.entries(object(where)).every(([key, filter]) => {
    if (key === "AND")
      return (Array.isArray(filter) ? filter : [filter]).every((part) => matches(row, part));
    if (key === "OR")
      return (Array.isArray(filter) ? filter : []).some((part) => matches(row, part));
    const actual = row[key];
    if (filter instanceof Date)
      return actual instanceof Date && actual.getTime() === filter.getTime();
    if (filter === null || typeof filter !== "object") return actual === filter;
    const condition = object(filter);
    if ("lt" in condition)
      return actual instanceof Date && condition.lt instanceof Date
        ? actual < condition.lt
        : String(actual) < String(condition.lt);
    if ("gte" in condition || "lte" in condition)
      return (
        (!condition.gte || String(actual) >= String(condition.gte)) &&
        (!condition.lte || String(actual) <= String(condition.lte))
      );
    if ("not" in condition) return actual !== condition.not;
    if ("some" in condition)
      return Array.isArray(actual) && actual.some((item) => matches(item, condition.some));
    return matches(actual, filter);
  });
}
function database() {
  const queryRows = (input: unknown) => {
    const q = object(input);
    return rows
      .map((row) => ({ ...row, lessons: [{ lesson: { date: "2026-11-01" } }] }))
      .filter((row) => matches(row, q.where))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))
      .slice(0, typeof q.take === "number" ? q.take : undefined);
  };
  return {
    teachingSession: {
      findMany: vi.fn(async (input: unknown) =>
        queryRows(input).map(({ id, createdAt }) => ({ id, createdAt })),
      ),
      findFirst: vi.fn(async (input: unknown) => queryRows(input)[0] ?? null),
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          rows.find((row) => row.id === where.id) ?? null,
      ),
    },
    schoolTerm: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        publishedRevision: 1,
        archived: false,
      })),
      findMany: vi.fn(async (input: unknown) =>
        [...new Set(rows.map((row) => row.termId))]
          .map((id) => ({ id, publishedRevision: 1 }))
          .filter((term) => matches(term, object(input).where)),
      ),
    },
    schoolPublication: {
      findMany: vi.fn(async (input: unknown) =>
        [...bindings]
          .map(([slot, binding]) => ({
            id: binding.publicationId,
            termId: rows.find((row) => row.slotId === slot)!.termId,
            revision: 1,
            lessons: binding.lessons
              .map((lesson) => ({
                teacherId: lesson.teacherId,
                date: lesson.date,
                snapshot: lesson,
              }))
              .filter((lesson) =>
                matches(lesson, object(object(object(input).include).lessons).where),
              ),
          }))
          .filter((publication) => matches(publication, object(input).where)),
      ),
      findUnique: vi.fn(async ({ where }: { where: { termId_revision: { termId: string } } }) => {
        const lessons = [...bindings]
          .filter(([slot]) =>
            rows.some((row) => row.slotId === slot && row.termId === where.termId_revision.termId),
          )
          .flatMap(([, binding]) =>
            binding.lessons.map((lesson, index) => ({
              id: binding.lessonIds[index],
              snapshot: lesson,
            })),
          );
        return { id: "publication", revision: 1, timezone: "Asia/Shanghai", lessons };
      }),
    },
  };
}
let fixture: ReturnType<typeof database>, db: Prisma.TransactionClient;
beforeEach(() => {
  bindings = new Map();
  rows = [];
  actor = { id: "teacher", role: "TEACHER", name: "教师", teachingAssignments: [] };
  mocks.actor.mockImplementation(async () => actor);
  fixture = database();
  db = fixture as unknown as Prisma.TransactionClient;
});
async function pages(limit = 2) {
  const result: string[][] = [];
  let beforeId: string | undefined;
  for (let page = 0; page < 10; page++) {
    const value = await loadTeachingSessions(actor, { limit, beforeId }, db);
    result.push(value.sessions.map((session) => session.id));
    if (!value.nextBeforeId) return result;
    beforeId = value.nextBeforeId;
  }
  throw new Error("cursor did not finish");
}
it("orders reverse UUID chronology and ties over three pages without duplicates or missing rows", async () => {
  rows = [
    record("f", 1),
    record("e", 2),
    record("d", 3),
    record("b", 4),
    record("c", 4),
    record("a", 5),
  ];
  expect(await pages()).toEqual([
    [id("a"), id("c")],
    [id("b"), id("d")],
    [id("e"), id("f")],
  ]);
  for (const [query] of fixture.teachingSession.findMany.mock.calls) {
    expect(query).toMatchObject({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, createdAt: true },
      take: 3,
    });
    expect(object(query).include).toBeUndefined();
  }
  const second = object(fixture.teachingSession.findMany.mock.calls[1][0]);
  expect(second.where).toMatchObject({
    AND: expect.arrayContaining([
      { OR: [{ createdAt: { lt: day(4) } }, { createdAt: day(4), id: { lt: id("c") } }] },
    ]),
  });
});
it.each(["missing", "foreign", "term", "status", "date", "revoked"])(
  "rejects a %s cursor with 404 under the current filters and authorization",
  async (kind) => {
    rows = [
      record("a", 3),
      record("b", 2, {
        owner: kind === "foreign" ? "other" : "teacher",
        assigned: kind === "revoked" ? "other" : kind === "foreign" ? "other" : "teacher",
        termId: kind === "term" ? "other-term" : "term",
        status: kind === "status" ? "COMPLETED" : "NOT_STARTED",
        actualDate: kind === "date" ? "2026-11-02" : undefined,
      }),
    ];
    await expect(
      loadTeachingSessions(
        actor,
        {
          beforeId: kind === "missing" ? "not-a-session" : id("b"),
          termId: "term",
          status: "NOT_STARTED",
          startDate: "2026-11-01",
          endDate: "2026-11-01",
        },
        db,
      ),
    ).rejects.toMatchObject({ status: 404 });
  },
);
it("scans beyond lost-assignment and changed-class candidates to fill a visible page", async () => {
  rows = [
    record("a", 9, { assigned: "other" }),
    record("b", 8, { differentClass: true }),
    record("c", 7),
    record("d", 6),
    record("e", 5),
  ];
  expect(await pages()).toEqual([[id("c"), id("d")], [id("e")]]);
  expect(fixture.teachingSession.findMany.mock.calls.length).toBeGreaterThan(2);
});
it("keeps the actual historical teacher and prevents a newly assigned teacher from receiving the started record", async () => {
  rows = [
    record("a", 3, { status: "IN_PROGRESS", assigned: "substitute" }),
    record("b", 2, { status: "COMPLETED", assigned: "substitute" }),
  ];
  expect((await loadTeachingSessions(actor, {}, db)).sessions.map((row) => row.id)).toEqual([
    id("a"),
    id("b"),
  ]);
  actor = { ...actor, id: "substitute" };
  expect((await loadTeachingSessions(actor, {}, db)).sessions).toEqual([]);
  await expect(loadTeachingSessions(actor, { beforeId: id("a") }, db)).rejects.toMatchObject({
    status: 404,
  });
});
it("continues past old-date candidates and uses the moved actual lesson date for cursor validation", async () => {
  rows = [
    record("a", 5, { actualDate: "2026-11-02" }),
    record("b", 4, { actualDate: "2026-11-02" }),
    record("c", 3),
    record("d", 2),
    record("e", 1),
  ];
  const first = await loadTeachingSessions(
    actor,
    { limit: 2, startDate: "2026-11-01", endDate: "2026-11-01" },
    db,
  );
  expect(first.sessions.map((row) => row.id)).toEqual([id("c"), id("d")]);
  const second = await loadTeachingSessions(
    actor,
    { limit: 2, beforeId: first.nextBeforeId!, startDate: "2026-11-01", endDate: "2026-11-01" },
    db,
  );
  expect(second.sessions.map((row) => row.id)).toEqual([id("e")]);
  expect(second.nextBeforeId).toBeNull();
});
it("allows a current school manager to page all authorized records and rejects a student's request", async () => {
  rows = [record("a", 1, { owner: "other" })];
  actor = { ...actor, teachingAssignments: [{ role: "SCHOOL_ADMIN" }] };
  expect((await loadTeachingSessions(actor, {}, db)).sessions[0].id).toBe(id("a"));
  actor = { ...actor, role: "STUDENT" };
  await expect(loadTeachingSessions(actor, {}, db)).rejects.toMatchObject({ status: 403 });
});
