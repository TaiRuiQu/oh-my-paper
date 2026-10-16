import { beforeEach, expect, it, vi } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import type { PlatformState } from "@/contracts/platform";
import type { SetSummaryRow, SummaryRow } from "@/server/platform/practice/context";
const mocks = vi.hoisted(() => ({ actor: vi.fn() }));
vi.mock("@/server/platform/access", async (original) => ({
  ...(await original<object>()),
  getActor: mocks.actor,
}));
import {
  loadPracticeSets,
  loadPracticeSources,
  loadPracticeSessions,
  loadPracticeReviews,
  loadPracticeEvidence,
} from "@/server/platform/practice/service";
const id = (letter: string) =>
  `${letter.repeat(8)}-${letter.repeat(4)}-4${letter.repeat(3)}-8${letter.repeat(3)}-${letter.repeat(12)}`;
const t = (day: number) => new Date(`2026-11-${day.toString().padStart(2, "0")}T00:00:00Z`);
const classroom = { id: "class", ownerId: "teacher", name: "一班", stage: "高中", cohort: "2026" };
const student = {
  id: "student",
  classroomId: "class",
  userId: "learner",
  name: "学生",
  studentNumber: "001",
  classroom,
};
let actor: PlatformState["actor"];
function setRow(
  key: string,
  day: number,
): SetSummaryRow & { classroom: typeof classroom & { students: { userId: string }[] } } {
  return {
    id: id(key),
    ownerId: "teacher",
    version: 1,
    name: `题集${key}`,
    subject: "数学",
    classroomId: "class",
    classroomName: "一班",
    status: "OPEN",
    publishedAt: t(day),
    owner: { name: "老师" },
    classroom: { ...classroom, students: [{ userId: "learner" }] },
  };
}
function sessionRow(key: string, day: number, attempt?: { key: string; day: number }): SummaryRow {
  return {
    id: id(key),
    version: 1,
    sourceKind: "SET",
    setId: "set",
    name: `练习${key}`,
    subject: "数学",
    identity: {
      studentId: "student",
      userId: "learner",
      name: "学生",
      studentNumber: "001",
      classroomId: "class",
      classroomName: "一班",
      stage: "高中",
      cohort: "2026",
    },
    userId: "learner",
    status: attempt ? "SUBMITTED" : "DRAFT",
    createdAt: t(day),
    currentAttemptId: attempt ? id(attempt.key) : null,
    reviewRequestedAt: null,
    student,
    _count: { attempts: attempt ? 1 : 0 },
    currentAttempt: attempt
      ? {
          id: id(attempt.key),
          sessionId: id(key),
          sequence: 1,
          submittedAt: t(attempt.day),
          attemptFingerprint: "a".repeat(64),
          contentFingerprint: "b".repeat(64),
          eligibility: [],
          evaluations: [],
        }
      : null,
  };
}
type Row = Record<string, unknown>;
const object = (value: unknown): Row =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : {};
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
    const test = object(filter);
    if ("lt" in test)
      return actual instanceof Date && test.lt instanceof Date
        ? actual.getTime() < test.lt.getTime()
        : typeof actual === "string" && typeof test.lt === "string" && actual < test.lt;
    if ("not" in test) return actual !== test.not;
    if ("some" in test)
      return Array.isArray(actual) && actual.some((entry) => matches(entry, test.some));
    return matches(actual, filter);
  });
}
function orderValue(row: unknown, order: unknown): unknown {
  const [entry] = Object.entries(object(order));
  if (!entry) return undefined;
  const [key, direction] = entry;
  return typeof direction === "string" ? object(row)[key] : orderValue(object(row)[key], direction);
}
function delegate<T extends object>(initial: T[]) {
  const rows = [...initial];
  const read = (input: unknown) => {
    const args = object(input);
    let result = rows.filter((row) => matches(row, args.where));
    const orders = Array.isArray(args.orderBy) ? args.orderBy : [args.orderBy];
    result.sort((a, b) => {
      for (const order of orders) {
        const av = orderValue(a, order),
          bv = orderValue(b, order);
        const left = av instanceof Date ? av.getTime() : String(av ?? ""),
          right = bv instanceof Date ? bv.getTime() : String(bv ?? "");
        if (left !== right) return left < right ? 1 : -1;
      }
      return 0;
    });
    if (typeof args.take === "number") result = result.slice(0, args.take);
    return result;
  };
  return {
    rows,
    findMany: vi.fn(async (input: unknown) => read(input)),
    findFirst: vi.fn(async (input: unknown) => read(input)[0] ?? null),
  };
}
function database() {
  const sets = delegate([setRow("0", 19), setRow("f", 17), setRow("b", 18), setRow("a", 18)]);
  const papers = delegate([
    ...["0", "f", "b", "a"].map((key, i) => ({
      id: id(key),
      ownerId: "teacher",
      kind: "HOMEWORK",
      subject: "数学",
      name: `试卷${key}`,
      updatedAt: t([19, 17, 18, 18][i]),
    })),
  ]);
  const sessions = delegate([
    sessionRow("0", 19, { key: "d", day: 17 }),
    sessionRow("f", 17, { key: "1", day: 19 }),
    sessionRow("b", 18, { key: "c", day: 18 }),
    sessionRow("a", 18, { key: "a", day: 18 }),
  ]);
  return {
    practiceSet: sets,
    paper: papers,
    practiceSession: sessions,
    schoolTerm: {
      findFirst: vi.fn(async () => ({ timezone: "Asia/Shanghai" })),
    },
    classroomStudent: {
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => student),
      findFirst: vi.fn(async () => student),
    },
    $queryRaw: vi.fn<(input: unknown) => Promise<unknown[]>>(async (_input: unknown) => {
      void _input;
      return [];
    }),
  };
}
let fixture: ReturnType<typeof database>, db: Prisma.TransactionClient;
beforeEach(() => {
  actor = {
    id: "teacher",
    name: "老师",
    role: "TEACHER",
    teachingAssignments: [{ role: "SUBJECT_TEACHER", classroomId: "class", subject: "数学" }],
  };
  mocks.actor.mockImplementation(async () => actor);
  fixture = database();
  db = fixture as unknown as Prisma.TransactionClient;
});
it("sets use newest publication then UUID ties and traverse without gaps or duplicates", async () => {
  const first = await loadPracticeSets(actor, { limit: 2 }, db);
  expect(first.sets.map((r) => r.id)).toEqual([id("0"), id("b")]);
  expect(first.nextBeforeId).toBe(id("b"));
  const second = await loadPracticeSets(actor, { limit: 2, beforeId: first.nextBeforeId }, db);
  expect(second.sets.map((r) => r.id)).toEqual([id("a"), id("f")]);
  expect(second.nextBeforeId).toBeNull();
  expect(new Set([...first.sets, ...second.sets].map((r) => r.id)).size).toBe(4);
});
it("a new publication with the smallest UUID still appears on the first page", async () => {
  fixture.practiceSet.rows.push(setRow("1", 20));
  expect((await loadPracticeSets(actor, { limit: 1 }, db)).sets[0].id).toBe(id("1"));
});
it("paper source pagination has its own updatedAt cursor independent of set publication", async () => {
  const first = await loadPracticeSources(actor, { limit: 2 }, db);
  expect(first.publishPapers.map((r) => r.id)).toEqual([id("0"), id("b")]);
  const second = await loadPracticeSources(
    actor,
    { limit: 2, beforeId: id("b"), paperBeforeId: id("b") },
    db,
  );
  expect(second.publishPapers.map((r) => r.id)).toEqual([id("a"), id("f")]);
  expect(second.sets.map((r) => r.id)).toEqual([id("a"), id("f")]);
  expect(second.nextPaperBeforeId).toBeNull();
});
it("paper edits appear by updatedAt even when the UUID is older", async () => {
  fixture.paper.rows.find((r) => r.id === id("f"))!.updatedAt = t(20);
  expect((await loadPracticeSources(actor, { limit: 1 }, db)).publishPapers[0].id).toBe(id("f"));
});
it("sessions seek by creation time and use UUID only within a timestamp tie", async () => {
  const first = await loadPracticeSessions(actor, { limit: 2 }, db);
  const second = await loadPracticeSessions(actor, { limit: 2, beforeId: first.nextBeforeId }, db);
  expect([...first.sessions, ...second.sessions].map((r) => r.id)).toEqual([
    id("0"),
    id("b"),
    id("a"),
    id("f"),
  ]);
  expect(second.nextBeforeId).toBeNull();
});
it("review queues order and seek by immutable current attempt, not session age or UUID", async () => {
  const first = await loadPracticeReviews(actor, { limit: 2 }, db);
  expect(first.attempts.map((r) => r.attempt.id)).toEqual([id("1"), id("c")]);
  expect(first.nextBeforeId).toBe(id("c"));
  const second = await loadPracticeReviews(actor, { limit: 2, beforeId: first.nextBeforeId }, db);
  expect(second.attempts.map((r) => r.attempt.id)).toEqual([id("a"), id("d")]);
  expect(second.nextBeforeId).toBeNull();
});
it("a new submission from an old session moves to the front of the review queue", async () => {
  fixture.practiceSession.rows[0].currentAttempt!.submittedAt = t(20);
  expect((await loadPracticeReviews(actor, { limit: 1 }, db)).attempts[0].attempt.id).toBe(id("d"));
});
it.each(["sets", "papers", "sessions", "reviews"])(
  "rejects %s cursors after permission revocation",
  async (kind) => {
    actor = { ...actor, teachingAssignments: [] };
    if (kind === "sets")
      await expect(loadPracticeSets(actor, { beforeId: id("0") }, db)).rejects.toMatchObject({
        status: 404,
      });
    if (kind === "papers") {
      actor = { ...actor, id: "other" };
      await expect(
        loadPracticeSources(actor, { paperBeforeId: id("0") }, db),
      ).rejects.toMatchObject({ status: 404 });
    }
    if (kind === "sessions")
      await expect(loadPracticeSessions(actor, { beforeId: id("0") }, db)).rejects.toMatchObject({
        status: 404,
      });
    if (kind === "reviews")
      await expect(loadPracticeReviews(actor, { beforeId: id("d") }, db)).rejects.toMatchObject({
        status: 404,
      });
  },
);
it("rejects cursors from another filter and a session UUID in the attempt queue", async () => {
  await expect(
    loadPracticeSets(actor, { subject: "英语", beforeId: id("0") }, db),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    loadPracticeSessions(actor, { setId: "other-set", beforeId: id("0") }, db),
  ).rejects.toMatchObject({ status: 404 });
  await expect(loadPracticeReviews(actor, { beforeId: id("0") }, db)).rejects.toMatchObject({
    status: 404,
  });
  await expect(
    loadPracticeSources(actor, { paperBeforeId: "non-paper-id" }, db),
  ).rejects.toMatchObject({ status: 404 });
});
it("students cannot use another student's session as a cursor", async () => {
  actor = { id: "other-student", name: "另一人", role: "STUDENT", teachingAssignments: [] };
  await expect(loadPracticeSessions(actor, { beforeId: id("0") }, db)).rejects.toMatchObject({
    status: 404,
  });
});
it("evidence resolves its timestamp only inside the current effective authorized scope", async () => {
  const cursor = { id: id("b"), recordedAt: t(18) };
  const raw = fixture.$queryRaw;

  raw
    .mockResolvedValueOnce([cursor])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{}])
    .mockResolvedValueOnce([{ count: 0n }]);
  await loadPracticeEvidence(actor, { studentId: "student", beforeId: cursor.id, limit: 2 }, db);
  const queries = raw.mock.calls.map(([sql]) => sql as Prisma.Sql);
  expect(queries[0].sql).toContain("e.id=?");
  expect(queries[0].sql).toContain("MAX(newer.version)");
  expect(queries[0].values).toContain("class");
  expect(queries[1].sql).toContain('ORDER BY e."recordedAt" DESC,e.id DESC');
  expect(queries[1].sql).toContain('e."recordedAt" < ? OR (e."recordedAt" = ? AND e.id < ?)');
  expect(queries[1].values.filter((v) => v instanceof Date)).toEqual([
    cursor.recordedAt,
    cursor.recordedAt,
  ]);
});
it("rejects absent, wrong-kind and inaccessible evidence cursors instead of returning an empty page", async () => {
  await expect(
    loadPracticeEvidence(actor, { studentId: "student", beforeId: "session-id" }, db),
  ).rejects.toMatchObject({ status: 404 });
  expect(fixture.$queryRaw).toHaveBeenCalledTimes(1);
});
it("evidence pages traverse recorded time and same-time UUID ties without loss or duplication", async () => {
  const evidence = [
    { id: id("0"), recordedAt: t(19) },
    { id: id("f"), recordedAt: t(17) },
    { id: id("b"), recordedAt: t(18) },
    { id: id("a"), recordedAt: t(18) },
  ];
  fixture.$queryRaw.mockImplementation(async (input) => {
    const query = input as Prisma.Sql;
    if (query.sql.startsWith('SELECT e.id,e."recordedAt"'))
      return evidence.filter((e) => query.values.includes(e.id));
    if (query.sql.startsWith("SELECT COUNT")) return [{}];
    expect(query.sql).toContain('ORDER BY e."recordedAt" DESC,e.id DESC');
    const timestamp = query.values.find((value) => value instanceof Date) as Date | undefined;
    const cursorId = query.values.find(
      (value) => typeof value === "string" && evidence.some((e) => e.id === value),
    );
    if (timestamp)
      expect(query.sql).toContain('e."recordedAt" < ? OR (e."recordedAt" = ? AND e.id < ?)');
    const page = evidence
      .filter(
        (e) =>
          !timestamp ||
          e.recordedAt < timestamp ||
          (e.recordedAt.getTime() === timestamp.getTime() &&
            typeof cursorId === "string" &&
            e.id < cursorId),
      )
      .sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime() || b.id.localeCompare(a.id))
      .slice(0, 3);
    return page.map((e) => ({
      ...e,
      attemptId: `attempt-${e.id}`,
      sessionId: `session-${e.id}`,
      itemId: "item",
      partId: "",
      subject: "数学",
      knowledgeTags: [],
      judgment: "CORRECT",
      source: "SELF",
      eligibility: "UNEXPOSED_IN_SYSTEM",
      evaluationId: e.id,
      evaluationVersion: 1,
    }));
  });
  const first = await loadPracticeEvidence(actor, { studentId: "student", limit: 2 }, db);
  expect(first.items.map((e) => e.evaluationId)).toEqual([id("0"), id("b")]);
  expect(first.nextBeforeId).toBe(id("b"));
  const next = await loadPracticeEvidence(
    actor,
    { studentId: "student", limit: 2, beforeId: first.nextBeforeId },
    db,
  );
  expect(next.items.map((e) => e.evaluationId)).toEqual([id("a"), id("f")]);
  expect(next.nextBeforeId).toBeNull();
});
