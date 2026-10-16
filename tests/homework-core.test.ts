import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import type { PlatformState, Paper } from "@/contracts/platform";
import type { AssignmentRow } from "@/server/platform/homework/context";
const mocks = vi.hoisted(() => ({ actor: vi.fn() }));
vi.mock("@/server/platform/access", async (original) => ({
  ...(await original<object>()),
  getActor: mocks.actor,
}));
import {
  executeHomeworkCommand,
  loadHomeworkAssignment,
  loadHomeworkAssignments,
  loadHomeworkHistory,
  loadHomeworkIssuePreview,
} from "@/server/platform/homework/service";
import { canReadHomeworkAsset } from "@/server/platform/homework/assets";
const prompt = "/api/platform/assets/11111111-1111-1111-1111-111111111111",
  solution = "/api/platform/assets/22222222-2222-2222-2222-222222222222",
  uploaded = "/api/platform/assets/33333333-3333-3333-3333-333333333333";
const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const now = new Date("2026-11-15T01:00:00Z");
let actor: PlatformState["actor"],
  row: AssignmentRow,
  events: Event[],
  db: Prisma.TransactionClient,
  fixture: ReturnType<typeof database>;
type Event = {
  id: string;
  assignmentId: string;
  workId: string | null;
  type: string;
  actorId: string;
  assignmentVersion: number;
  workVersion: number | null;
  reason: string;
  details: Record<string, unknown>;
  createdAt: Date;
  sequence: number;
};
const teacher = (): PlatformState["actor"] => ({
  id: "teacher",
  role: "TEACHER",
  name: "老师",
  teachingAssignments: [{ role: "SUBJECT_TEACHER", classroomId: "class1", subject: "数学" }],
});
const student = (): PlatformState["actor"] => ({
  id: "student-user",
  role: "STUDENT",
  name: "学生",
  teachingAssignments: [],
});
function paper(): Paper {
  return {
    id: "paper",
    ownerId: "teacher",
    name: "函数作业",
    kind: "HOMEWORK",
    subject: "数学",
    grade: "高中一年级",
    instructions: "独立完成",
    layout: { paperSize: "A4", columns: 1, fontSizePt: 12, lineHeight: 1.5 },
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    items: [
      {
        id: "item",
        questionId: "q",
        position: 1,
        score: 10,
        section: "解答",
        snapshot: {
          id: "q",
          ownerId: "teacher",
          subject: "数学",
          grade: "高中一年级",
          type: "MIXED",
          difficulty: 3,
          knowledgeTags: [],
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          content: {
            stem: `题面 ![图](${prompt})`,
            options: [],
            images: [prompt, solution],
            answers: ["SECRET_ANSWER"],
            explanation: "SECRET_EXPLANATION",
            rubric: "SECRET_RUBRIC",
            parts: [
              {
                id: "part",
                type: "BLANK",
                stem: "第一问",
                options: [],
                answers: ["SECRET_PART"],
                explanation: "SECRET_PART_EXPLANATION",
                rubric: "SECRET_PART_RUBRIC",
                score: 10,
                knowledgeTags: [],
              },
            ],
          },
        },
      },
    ],
  };
}
function initial(): AssignmentRow {
  const p = {
    id: "participant",
    assessmentId: "assessment",
    studentId: "student",
    classroomId: "class1",
    classroomName: "一班",
    name: "名单快照姓名",
    studentNumber: "001",
    stage: "高中",
    cohort: "2026",
    student: { userId: "student-user" },
    classroom: { id: "class1", stage: "高中", cohort: "2026" },
    subjects: [
      {
        id: "subject",
        participantId: "participant",
        paperId: "paper",
        status: "REQUIRED",
        reason: "",
      },
    ],
  };
  return {
    id: "assignment",
    assessmentId: "assessment",
    version: 1,
    status: "ISSUED",
    name: "函数作业",
    instructions: "独立完成",
    timezone: "Asia/Shanghai",
    dueLocal: "2026-11-16T18:00",
    dueAt: new Date("2026-11-16T10:00:00Z"),
    allowLate: false,
    rosterRevision: 1,
    papers: [{ paper: paper(), studentImageUrls: [], studentImageUrlsByItem: { item: [prompt] } }],
    issuedBy: "teacher",
    issuedAt: now,
    updatedAt: now,
    assessment: {
      id: "assessment",
      ownerId: "teacher",
      name: "函数作业",
      kind: "HOMEWORK",
      published: false,
      papers: [{ paperId: "paper", subject: "数学", weight: 1 }],
      classroomIds: ["class1"],
      rosterRevision: 1,
      rosterStatus: "CONFIRMED",
      reviewScope: "CLASSROOM",
      createdAt: now,
      participants: [p],
    },
    works: [
      {
        id: "work",
        assignmentId: "assignment",
        participantSubjectId: "subject",
        version: 1,
        draftVersion: 0,
        draftUpdatedAt: null,
        draftAnswers: [],
        collectionStatus: "NOT_SUBMITTED",
        dueAtOverride: null,
        dueLocalOverride: null,
        extensionReason: "",
        currentAttemptId: null,
        updatedAt: now,
        participantSubject: { ...p.subjects[0], participant: p },
        attempts: [],
      },
    ],
  } as unknown as AssignmentRow;
}
function matchEvent(event: Event, where: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(where)) {
    if (key === "AND") {
      if (!(value as Record<string, unknown>[]).every((entry) => matchEvent(event, entry)))
        return false;
    } else if (key === "OR") {
      if (!(value as Record<string, unknown>[]).some((entry) => matchEvent(event, entry)))
        return false;
    } else if (key === "details") {
      if (event.details.attemptId !== (value as { equals: string }).equals) return false;
    } else if (typeof value === "object" && value !== null) {
      const predicate = value as { in?: unknown[]; lt?: number };
      const actual = (event as unknown as Record<string, unknown>)[key];
      if (predicate.in && !predicate.in.includes(actual)) return false;
      if (predicate.lt !== undefined && !(Number(actual) < predicate.lt)) return false;
    } else if ((event as unknown as Record<string, unknown>)[key] !== value) return false;
  }
  return true;
}
function database() {
  const model = { ...paper(), createdAt: now, updatedAt: now };
  const updateWork = vi.fn(
    async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      const work = row.works.find((w) => w.id === args.where.id)!;
      for (const [key, value] of Object.entries(args.data)) {
        const target = work as unknown as Record<string, unknown>;
        target[key] =
          value && typeof value === "object" && "increment" in value
            ? Number(target[key]) + Number(value.increment)
            : value;
      }
      return work;
    },
  );
  const scans: Record<string, unknown>[] = [];
  const allAttempts = () => row.works.flatMap((work) => work.attempts);
  const store = {
    $queryRaw: vi.fn(async () => []),
    homeworkAssignment: {
      findFirst: vi.fn(async () => ({ id: row.id })),
      findUnique: vi.fn(async (args: { where: { id?: string; assessmentId?: string } }) =>
        args.where.id === row.id || args.where.assessmentId === row.assessmentId ? row : null,
      ),
      findMany: vi.fn(async (args: Record<string, unknown>) => {
        void args;
        return [row];
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(row, data);
        return row;
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const { version, ...rest } = data;
        Object.assign(row, rest);
        if (version) row.version++;
        return row;
      }),
    },
    homeworkWork: {
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          row.works.find((w) => w.id === where.id) ?? null,
      ),
      update: updateWork,
      create: vi.fn(
        async ({ data }: { data: { assignmentId: string; participantSubjectId: string } }) => {
          const p = row.assessment.participants.find((p) =>
            p.subjects.some((s) => s.id === data.participantSubjectId),
          )!;
          const work = {
            ...row.works[0],
            ...data,
            id: `work${row.works.length + 1}`,
            participantSubject: {
              ...p.subjects.find((s) => s.id === data.participantSubjectId)!,
              participant: p,
            },
            attempts: [],
            currentAttemptId: null,
          };
          row.works.push(work as AssignmentRow["works"][number]);
          return work;
        },
      ),
    },
    homeworkAttempt: {
      findUnique: vi.fn(
        async ({ where }: { where: { workId_requestId: { workId: string; requestId: string } } }) =>
          allAttempts().find(
            (attempt) =>
              attempt.workId === where.workId_requestId.workId &&
              attempt.requestId === where.workId_requestId.requestId,
          ) ?? null,
      ),
      findMany: vi.fn(
        async ({ where }: { where: { id: { in: string[] }; workId: { in: string[] } } }) =>
          allAttempts().filter(
            (attempt) =>
              where.id.in.includes(attempt.id) && where.workId.in.includes(attempt.workId),
          ),
      ),
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: { workId: string; submission: { sourceFiles: { has: string } } };
        }) =>
          allAttempts().find(
            (attempt) =>
              attempt.workId === where.workId &&
              (
                (scans.find((scan) => scan.id === attempt.submissionId)?.sourceFiles as string[]) ??
                []
              ).includes(where.submission.sourceFiles.has),
          ) ?? null,
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const work = row.works.find((w) => w.id === data.workId)!;
        const submission = scans.find((scan) => scan.id === data.submissionId)!;
        const attempt = {
          ...data,
          id: `attempt${work.attempts.length + 1}`,
          submittedAt: new Date(),
          submission,
        };
        work.attempts.unshift(
          attempt as unknown as AssignmentRow["works"][number]["attempts"][number],
        );
        return attempt;
      }),
    },
    homeworkAsset: {
      findUnique: vi.fn(async ({ where }: { where: { assetId: string } }) =>
        where.assetId === uploaded.split("/").at(-1)
          ? { workId: "work", work: { assignmentId: row.id } }
          : null,
      ),
      findMany: vi.fn(async () => [
        {
          workId: "work",
          assetId: uploaded.split("/").at(-1),
          uploadedBy: "student-user",
          asset: { ownerId: "student-user" },
        },
      ]),
    },
    homeworkEvent: {
      findMany: vi.fn(async (args: { where: Record<string, unknown>; take?: number }) =>
        [...events]
          .reverse()
          .filter((event) => matchEvent(event, args.where))
          .slice(0, args.take),
      ),
      findFirst: vi.fn(
        async ({ where }: { where: Record<string, unknown> }) =>
          events.find((event) => matchEvent(event, where)) ?? null,
      ),
      create: vi.fn(async ({ data }: { data: Omit<Event, "id" | "createdAt" | "sequence"> }) => {
        const event = {
          ...data,
          id: `event${events.length + 1}`,
          createdAt: new Date(),
          sequence: events.length + 1,
        };
        events.push(event);
        return event;
      }),
    },
    scanSubmission: {
      count: vi.fn(async () => 0),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const scan = { ...data, id: `scan${scans.length + 1}` };
        scans.push(scan);
        return scan;
      }),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const scan = scans.find((s) => s.id === where.id)!;
          Object.assign(scan, data);
          return scan;
        },
      ),
      updateMany: vi.fn(async () => {
        scans.forEach((s) => {
          s.active = false;
        });
        return { count: scans.length };
      }),
    },
    assessment: {
      findUnique: vi.fn(async () => row.assessment),
      findUniqueOrThrow: vi.fn(async () => row.assessment),
    },
    paper: { findMany: vi.fn(async () => [model]), findUniqueOrThrow: vi.fn(async () => model) },
    platformAsset: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        ownerId: "teacher",
      })),
    },
    classroom: { findMany: vi.fn(async () => [{ id: "class1", stage: "高中", cohort: "2026" }]) },
    schoolTerm: { findFirst: vi.fn(async () => ({ timezone: "Asia/Shanghai" })) },
    user: {
      findMany: vi.fn(async () => [
        { id: "teacher", name: "老师" },
        { id: "student-user", name: "学生" },
      ]),
    },
  };
  return store;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  actor = student();
  mocks.actor.mockImplementation(async () => actor);
  row = initial();
  events = [];
  fixture = database();
  db = fixture as unknown as Prisma.TransactionClient;
});
afterEach(() => vi.useRealTimers());
const execute = (input: unknown) => executeHomeworkCommand({ id: actor.id }, input, { db });
const save = (text = "本人草稿") =>
  execute({
    type: "homework.draft.save",
    workId: "work",
    expectedVersion: row.works[0].version,
    expectedDraftVersion: row.works[0].draftVersion,
    answers: [{ itemId: "item", text, images: [uploaded] }],
  });
const submitInput = () => ({
  type: "homework.submit",
  workId: "work",
  expectedVersion: row.works[0].version,
  expectedDraftVersion: row.works[0].draftVersion,
  expectedAssignmentVersion: row.version,
  expectedRosterRevision: row.assessment.rosterRevision,
  requestId,
});
async function submitted() {
  await save();
  const input = submitInput();
  await execute(input);
  return input;
}
it("student receives only their own prompt and draft without answers, rubric, hidden media or teacher metadata", async () => {
  const result = await loadHomeworkAssignment(actor, row.id, db);
  const text = JSON.stringify(result);
  expect(result.view).toBe("STUDENT");
  expect(text).not.toContain("SECRET_");
  expect(text).not.toContain(solution);
  expect(text).not.toContain('"questionId"');
  expect(text).not.toContain('"ownerId"');
  expect(text).toContain(prompt);
  expect(result.works[0].name).toBe("名单快照姓名");
});
it("teacher cannot read unsubmitted draft content through detail, list or history", async () => {
  await save("PRIVATE_DRAFT");
  actor = teacher();
  for (const result of [
    await loadHomeworkAssignment(actor, row.id, db),
    await loadHomeworkAssignments(actor, {}, db),
    await loadHomeworkHistory(actor, row.id, {}, db),
  ])
    expect(JSON.stringify(result)).not.toContain("PRIVATE_DRAFT");
});
it("outsider and another student's reassigned account cannot read or write this work", async () => {
  actor = { ...student(), id: "outsider" };
  await expect(loadHomeworkAssignment(actor, row.id, db)).rejects.toMatchObject({ status: 404 });
  await expect(save()).rejects.toMatchObject({ status: 404 });
});
it("draft CAS refuses another browser's stale draft without extra event or update", async () => {
  await save();
  await expect(
    execute({
      type: "homework.draft.save",
      workId: "work",
      expectedVersion: 1,
      expectedDraftVersion: 0,
      answers: [],
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(fixture.homeworkWork.update).toHaveBeenCalledTimes(1);
  expect(events).toHaveLength(0);
});
it("draft rejects foreign item and work-unbound image", async () => {
  await expect(
    execute({
      type: "homework.draft.save",
      workId: "work",
      expectedVersion: 1,
      expectedDraftVersion: 0,
      answers: [{ itemId: "foreign", text: "", images: [] }],
    }),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    execute({
      type: "homework.draft.save",
      workId: "work",
      expectedVersion: 1,
      expectedDraftVersion: 0,
      answers: [{ itemId: "item", text: "", images: [solution] }],
    }),
  ).rejects.toMatchObject({ status: 404 });
  expect(fixture.homeworkWork.update).not.toHaveBeenCalled();
});
it("submit produces one immutable scan and retrying the exact receipt never adopts a new draft", async () => {
  const input = await submitted();
  const first = await execute(input);
  expect(first.sequence).toBe(1);
  expect(fixture.scanSubmission.create).toHaveBeenCalledTimes(1);
  expect(fixture.scanSubmission.create.mock.calls[0][0].data).toMatchObject({
    ownerId: "teacher",
    active: true,
    attemptNumber: 1,
    kind: "WORKBOOK",
    sourceFiles: [uploaded],
  });
  await expect(execute({ ...input, expectedDraftVersion: 99 })).rejects.toMatchObject({
    status: 409,
  });
  expect(events).toHaveLength(1);
});
it("return preserves the old receipt and reviews while resubmission makes a fresh scan ID with no inherited grades", async () => {
  await submitted();
  actor = teacher();
  await execute({
    type: "homework.return",
    workId: "work",
    expectedVersion: row.works[0].version,
    expectedAttemptId: "attempt1",
    reason: "补全步骤",
  });
  expect(row.works[0].attempts[0].submission.active).toBe(false);
  expect(row.works[0].currentAttemptId).toBe("attempt1");
  actor = student();
  await save("重交新作答");
  await execute({ ...submitInput(), requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" });
  expect(row.works[0].attempts).toHaveLength(2);
  expect(row.works[0].attempts[0].submissionId).toBe("scan2");
  expect(row.works[0].attempts[0].submission.active).toBe(true);
  expect(row.works[0].attempts[1].submission.active).toBe(false);
  const history = await loadHomeworkHistory(actor, row.id, { workId: "work" }, db);
  expect(history.attempts.map((a) => a.answers[0].text)).toEqual(["重交新作答", "本人草稿"]);
  expect(history.attempts.find((a) => a.sequence === 1)).toMatchObject({
    status: "RETURNED",
    returnReason: "补全步骤",
  });
});
it.each([["item2"], ["item2", "item"]])(
  "projects frozen paper question numbers for sparse or reversed answers %j",
  async (...itemIds) => {
    const frozen = row.papers as unknown as { paper: Paper }[];
    frozen[0].paper.items.push({
      ...structuredClone(frozen[0].paper.items[0]),
      id: "item2",
      position: 1,
    });
    await execute({
      type: "homework.draft.save",
      workId: "work",
      expectedVersion: row.works[0].version,
      expectedDraftVersion: row.works[0].draftVersion,
      answers: itemIds.map((itemId) => ({ itemId, text: `原始作答-${itemId}`, images: [] })),
    });
    await execute(submitInput());
    row.works[0].participantSubject.status = "EXEMPT";
    const history = await loadHomeworkHistory(actor, row.id, { workId: "work" }, db);
    expect(history.attempts[0]).toMatchObject({
      paperId: "paper",
      paperName: frozen[0].paper.name,
    });
    expect(history.attempts[0].answers).toEqual([
      {
        itemId: "item",
        questionNumber: 1,
        submitted: itemIds.includes("item"),
        text: itemIds.includes("item") ? "原始作答-item" : "",
        images: [],
      },
      { itemId: "item2", questionNumber: 2, submitted: true, text: "原始作答-item2", images: [] },
    ]);
    expect(JSON.stringify(history)).not.toContain("SECRET_ANSWER");
    expect(JSON.stringify(history)).not.toContain("SECRET_PART");
  },
);
it.each(["ABSENT", "EXEMPT", "WITHDRAWN"])(
  "%s blocks draft and submit even with a retained work",
  async (status) => {
    row.works[0].participantSubject.status = status;
    await expect(save()).rejects.toMatchObject({ status: 409 });
    expect((await loadHomeworkAssignment(actor, row.id, db)).works[0].capabilities.canSubmit).toBe(
      false,
    );
  },
);
it.each(["CLOSED", "CANCELLED"])(
  "%s retains own history but blocks all student writes",
  async (status) => {
    row.status = status;
    await expect(save()).rejects.toMatchObject({ status: 409 });
    expect((await loadHomeworkAssignment(actor, row.id, db)).works).toHaveLength(1);
  },
);
it("unconfirmed or unsynchronized roster blocks writes until explicit manager sync", async () => {
  row.assessment.rosterRevision++;
  await save();
  expect((await loadHomeworkAssignment(actor, row.id, db)).works[0].capabilities.canSubmit).toBe(
    false,
  );
  actor = teacher();
  await execute({
    type: "homework.roster.sync",
    assignmentId: row.id,
    expectedVersion: 1,
    expectedRosterRevision: 2,
    reason: "核对名单",
  });
  expect(row.rosterRevision).toBe(2);
  actor = student();
  await save();
  row.assessment.rosterStatus = "NEEDS_REVIEW";
  await expect(execute(submitInput())).rejects.toMatchObject({ status: 409 });
});
it("deadline uses server time, records late at receipt, and requires explicit extension when late is denied", async () => {
  row.dueAt = new Date(now.getTime() - 1);
  await expect(save()).rejects.toMatchObject({ status: 409 });
  row.allowLate = true;
  await submitted();
  expect(row.works[0].attempts[0].late).toBe(true);
});
it("returned after deadline is blocked until manager extends the work", async () => {
  await submitted();
  actor = teacher();
  await execute({
    type: "homework.return",
    workId: "work",
    expectedVersion: row.works[0].version,
    expectedAttemptId: "attempt1",
    reason: "重新作答",
  });
  row.dueAt = new Date(now.getTime() - 1);
  actor = student();
  await expect(save()).rejects.toMatchObject({ status: 409 });
  actor = teacher();
  await execute({
    type: "homework.deadline.extend",
    workId: "work",
    expectedVersion: row.works[0].version,
    dueLocal: "2026-11-17T18:00",
    reason: "退回后延期",
  });
  actor = student();
  await save();
});
it("read-only subject teacher can read submitted work but cannot return or manage collection", async () => {
  await submitted();
  actor = { ...teacher(), id: "reader" };
  const detail = await loadHomeworkAssignment(actor, row.id, db);
  expect(detail.assignment.capabilities.canManage).toBe(false);
  expect(detail.works[0].capabilities.canReturn).toBe(false);
  await expect(
    execute({
      type: "homework.return",
      workId: "work",
      expectedVersion: row.works[0].version,
      expectedAttemptId: "attempt1",
      reason: "改",
    }),
  ).rejects.toMatchObject({ status: 404 });
});
it("published results block manager changes and student edits", async () => {
  await submitted();
  row.assessment.published = true;
  actor = teacher();
  await expect(
    execute({
      type: "homework.return",
      workId: "work",
      expectedVersion: row.works[0].version,
      expectedAttemptId: "attempt1",
      reason: "改",
    }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    execute({ type: "homework.cancel", assignmentId: row.id, expectedVersion: 1, reason: "改" }),
  ).rejects.toMatchObject({ status: 409 });
});
it("current role revocation is rechecked inside the domain transaction", async () => {
  const old = actor.id;
  actor = { ...teacher(), id: old, teachingAssignments: [] };
  await expect(
    execute({ type: "homework.close", assignmentId: row.id, expectedVersion: 1, reason: "关" }),
  ).rejects.toMatchObject({ status: 404 });
  expect(fixture.$queryRaw).toHaveBeenCalled();
});
it("teacher asset access never includes a student draft, only immutable submitted evidence", async () => {
  await save();
  actor = teacher();
  expect(await canReadHomeworkAsset(actor, uploaded, db)).toBe(false);
  actor = student();
  await execute(submitInput());
  actor = teacher();
  expect(await canReadHomeworkAsset(actor, uploaded, db)).toBe(true);
  expect(await canReadHomeworkAsset(student(), solution, db)).toBe(false);
  expect(await canReadHomeworkAsset(student(), prompt, db)).toBe(true);
});
it("own history cursor cannot be used to probe a hidden global event", async () => {
  actor = teacher();
  await execute({
    type: "homework.roster.sync",
    assignmentId: row.id,
    expectedVersion: 1,
    expectedRosterRevision: 1,
    reason: "GLOBAL_SECRET",
  });
  actor = student();
  expect((await loadHomeworkHistory(actor, row.id, {}, db)).events).toHaveLength(0);
  await expect(
    loadHomeworkHistory(actor, row.id, { beforeId: events[0].id }, db),
  ).rejects.toMatchObject({ status: 409 });
});
it("stale assignment baseline cannot submit after a manager changes the deadline", async () => {
  await save();
  const command = submitInput();
  row.version++;
  await expect(execute(command)).rejects.toMatchObject({ status: 409 });
  expect(fixture.scanSubmission.create).not.toHaveBeenCalled();
  expect(events).toHaveLength(0);
});
it("issue preview blocks existing paper submissions and returns authoritative school timezone", async () => {
  actor = teacher();
  fixture.homeworkAssignment.findUnique.mockResolvedValue(null as unknown as AssignmentRow);
  fixture.scanSubmission.count.mockResolvedValue(1);
  const result = await loadHomeworkIssuePreview(actor, "assessment", db);
  expect(result.timezone).toBe("Asia/Shanghai");
  expect(result.canIssue).toBe(false);
  expect(result.blockReasons.join()).toContain("已有扫描");
});
it("issue freezes full paper privately and only approved prompt material in student projection", async () => {
  actor = teacher();
  fixture.homeworkAssignment.findUnique.mockResolvedValue(null as unknown as AssignmentRow);
  await execute({
    type: "homework.issue",
    assessmentId: "assessment",
    expectedRosterRevision: 1,
    expectedPapers: [
      {
        paperId: "paper",
        expectedUpdatedAt: now.toISOString(),
        studentImageUrls: [],
        items: [{ itemId: "item", studentImageUrls: [prompt] }],
      },
    ],
    instructions: "完成",
    dueLocal: "2026-11-18T18:00",
    timezone: "Asia/Shanghai",
    allowLate: false,
  });
  expect(fixture.homeworkAssignment.create).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(fixture.homeworkAssignment.create.mock.calls[0][0])).toContain(
    "SECRET_ANSWER",
  );
});
it("student and partial teacher cannot issue a homework assignment", async () => {
  await expect(loadHomeworkIssuePreview(actor, "assessment", db)).rejects.toMatchObject({
    status: 404,
  });
  actor = { ...teacher(), id: "reader" };
  await expect(loadHomeworkIssuePreview(actor, "assessment", db)).rejects.toMatchObject({
    status: 404,
  });
});
it("classroom cohort changes revoke the old grade director even though displayed participant snapshots remain old", async () => {
  actor = {
    id: "teacher",
    role: "TEACHER",
    name: "旧年级主任",
    teachingAssignments: [{ role: "GRADE_DIRECTOR", stage: "高中", cohort: "2026" }],
  };
  row.assessment.participants[0].classroom.cohort = "2027";
  row.works[0].participantSubject.participant.classroom.cohort = "2027";
  await expect(loadHomeworkAssignment(actor, row.id, db)).rejects.toMatchObject({ status: 404 });
  await expect(
    execute({ type: "homework.close", assignmentId: row.id, expectedVersion: 1, reason: "关闭" }),
  ).rejects.toMatchObject({ status: 404 });
  expect(await canReadHomeworkAsset(actor, prompt, db)).toBe(false);
});
it("a known student can preserve a draft during unsynced or unconfirmed roster while upload and submit remain paused", async () => {
  row.assessment.rosterRevision = 2;
  row.assessment.rosterStatus = "NEEDS_REVIEW";
  await save("待核对期间草稿");
  const detail = await loadHomeworkAssignment(actor, row.id, db);
  expect(detail.works[0].capabilities).toMatchObject({
    canSaveDraft: true,
    canSubmit: false,
    canUpload: false,
  });
  await expect(execute(submitInput())).rejects.toMatchObject({ status: 409 });
});
it("student global history shows deadline/close changes but never global roster notes", async () => {
  actor = teacher();
  await execute({
    type: "homework.settings",
    assignmentId: row.id,
    expectedVersion: 1,
    instructions: "补全步骤",
    dueLocal: "2026-11-18T18:00",
    allowLate: true,
    reason: "全班延期",
  });
  await execute({
    type: "homework.roster.sync",
    assignmentId: row.id,
    expectedVersion: 2,
    expectedRosterRevision: 1,
    reason: "PRIVATE_ROSTER_NOTE",
  });
  actor = student();
  const history = await loadHomeworkHistory(actor, row.id, {}, db);
  expect(history.events.map((event) => event.type)).toEqual(["homework.settings"]);
  expect(history.events[0].changes).toContain("截止时间：2026-11-16T18:00 → 2026-11-18T18:00");
  expect(history.events[0].changes).toContain("允许迟交：不允许 → 允许");
  expect(JSON.stringify(history)).not.toContain("PRIVATE_ROSTER_NOTE");
});
it.each(["CANCELLED", "WITHDRAWN"])(
  "%s revokes assignment prompt media but retains the student's submitted evidence",
  async (status) => {
    await submitted();
    if (status === "CANCELLED") row.status = status;
    else row.works[0].participantSubject.status = status;
    expect((await loadHomeworkAssignment(actor, row.id, db)).assignment.papers).toEqual([]);
    expect(await canReadHomeworkAsset(actor, prompt, db)).toBe(false);
    expect(await canReadHomeworkAsset(actor, uploaded, db)).toBe(true);
  },
);
it("receipt replay after return does not grant a later work or draft CAS baseline", async () => {
  const input = await submitted();
  actor = teacher();
  await execute({
    type: "homework.return",
    workId: "work",
    expectedVersion: row.works[0].version,
    expectedAttemptId: "attempt1",
    reason: "重交",
  });
  actor = student();
  await save("更新后的稿件");
  const replay = await execute(input);
  expect(replay.workVersion).toBe(input.expectedVersion + 1);
  expect(replay.draftVersion).toBe(input.expectedDraftVersion);
  expect(replay.workVersion).toBeLessThan(row.works[0].version);
  expect(fixture.scanSubmission.create).toHaveBeenCalledTimes(1);
});
it("issue rejects an alternative IANA timezone even though the instant is valid", async () => {
  actor = teacher();
  fixture.homeworkAssignment.findUnique.mockResolvedValue(null as unknown as AssignmentRow);
  await expect(
    execute({
      type: "homework.issue",
      assessmentId: "assessment",
      expectedRosterRevision: 1,
      expectedPapers: [
        {
          paperId: "paper",
          expectedUpdatedAt: now.toISOString(),
          studentImageUrls: [],
          items: [{ itemId: "item", studentImageUrls: [prompt] }],
        },
      ],
      instructions: "",
      dueLocal: "2026-11-18T18:00",
      timezone: "America/Los_Angeles",
      allowLate: false,
    }),
  ).rejects.toMatchObject({ status: 400 });
  expect(fixture.homeworkAssignment.create).not.toHaveBeenCalled();
});
it("issue rejects omitted inline prompt images instead of silently giving a broken question", async () => {
  actor = teacher();
  fixture.homeworkAssignment.findUnique.mockResolvedValue(null as unknown as AssignmentRow);
  await expect(
    execute({
      type: "homework.issue",
      assessmentId: "assessment",
      expectedRosterRevision: 1,
      expectedPapers: [
        {
          paperId: "paper",
          expectedUpdatedAt: now.toISOString(),
          studentImageUrls: [],
          items: [{ itemId: "item", studentImageUrls: [] }],
        },
      ],
      instructions: "",
      dueLocal: "2026-11-18T18:00",
      timezone: "Asia/Shanghai",
      allowLate: false,
    }),
  ).rejects.toMatchObject({ status: 400 });
});
it("mathematical less-than and greater-than signs remain byte-for-byte intact in student prompts", async () => {
  const frozen = row.papers as unknown as { paper: Paper }[];
  frozen[0].paper.items[0].snapshot.content.stem = "$a<b$，$c>d$";
  expect((await loadHomeworkAssignment(actor, row.id, db)).assignment.papers[0].items[0].stem).toBe(
    "$a<b$，$c>d$",
  );
});
it("paper-level reading blocks are available in issue preview with their position", async () => {
  actor = teacher();
  fixture.homeworkAssignment.findUnique.mockResolvedValue(null as unknown as AssignmentRow);
  const model = {
    ...paper(),
    createdAt: now,
    updatedAt: now,
    layout: { ...paper().layout, textBlocks: [{ id: "reading", text: "不可遗漏的阅读原文" }] },
  };
  fixture.paper.findMany.mockResolvedValue([model]);
  const preview = await loadHomeworkIssuePreview(actor, row.assessmentId, db);
  expect(preview.canIssue).toBe(true);
  expect(preview.papers[0].textBlocks[0].text).toBe("不可遗漏的阅读原文");
});
it("deadline acceptance and immutable late/submittedAt use a single server instant", async () => {
  row.dueAt = new Date(now);
  await save();
  const findMany = fixture.homeworkAsset.findMany;
  findMany.mockImplementationOnce(async () => {
    vi.setSystemTime(new Date(now.getTime() + 10));
    return [
      {
        workId: "work",
        assetId: uploaded.split("/").at(-1),
        uploadedBy: "student-user",
        asset: { ownerId: "student-user" },
      },
    ];
  });
  await execute(submitInput());
  expect(fixture.homeworkAttempt.create.mock.calls[0][0].data).toMatchObject({
    late: false,
    submittedAt: now,
  });
});
it("whole-paper instructions and shared reading preserve approved media and placement without answer metadata", async () => {
  const frozen = row.papers as unknown as { paper: Paper; studentImageUrls: string[] }[];
  frozen[0].studentImageUrls = [prompt];
  frozen[0].paper.instructions = `阅读说明 ![说明图](${prompt})`;
  frozen[0].paper.layout.textBlocks = [
    { id: "reading", text: `共用阅读原文 ![材料图](${prompt})`, beforeQuestionId: "item" },
  ];
  const result = await loadHomeworkAssignment(actor, row.id, db),
    safe = result.assignment.papers[0];
  expect(safe.instructions).toContain(prompt);
  expect(safe.textBlocks).toEqual([
    { id: "reading", text: `共用阅读原文 ![材料图](${prompt})`, beforeQuestionId: "item" },
  ]);
  expect(safe.studentImageUrls).toEqual([prompt]);
  expect(JSON.stringify(safe)).not.toContain("SECRET_");
});
it("a whole-class deadline extension supersedes an earlier personal extension everywhere", async () => {
  actor = teacher();
  await execute({
    type: "homework.deadline.extend",
    workId: "work",
    expectedVersion: 1,
    dueLocal: "2026-11-17T18:00",
    reason: "个人延期",
  });
  await execute({
    type: "homework.settings",
    assignmentId: row.id,
    expectedVersion: 1,
    instructions: "完成",
    dueLocal: "2026-11-18T18:00",
    allowLate: false,
    reason: "全班延期",
  });
  actor = student();
  vi.setSystemTime(new Date("2026-11-18T01:00:00Z"));
  const detail = await loadHomeworkAssignment(actor, row.id, db);
  expect(detail.works[0]).toMatchObject({
    dueAt: "2026-11-18T10:00:00.000Z",
    dueLocal: "2026-11-18T18:00",
    deadlineOverride: null,
    overdue: false,
  });
  await save();
  await execute(submitInput());
  expect(row.works[0].attempts[0].late).toBe(false);
});
it("cancelling collection disables grading eligibility without inventing a return event", async () => {
  await submitted();
  actor = teacher();
  await execute({
    type: "homework.cancel",
    assignmentId: row.id,
    expectedVersion: 1,
    reason: "重新安排",
  });
  actor = student();
  const history = await loadHomeworkHistory(actor, row.id, {}, db);
  expect(history.attempts[0]).toMatchObject({
    status: "SUBMITTED",
    returnedAt: null,
    returnReason: "",
  });
  expect(row.works[0].attempts[0].submission.active).toBe(false);
});
it("assignment list pagination selects only summary fields and bounds the database page", async () => {
  await loadHomeworkAssignments(actor, { limit: 3 }, db);
  const call = fixture.homeworkAssignment.findMany.mock.calls[0]?.[0] as unknown as {
    where: unknown;
    take: number;
    select: Record<string, unknown>;
  };
  expect(call.take).toBe(4);
  expect(JSON.stringify(call.where)).toContain("student-user");
  expect(call.select).not.toHaveProperty("papers");
  expect(JSON.stringify(call.select)).not.toContain('"draftAnswers"');
  expect(JSON.stringify(call.select)).not.toContain('"answers"');
});
it("history reads attempt bodies only for the visible event page", async () => {
  await submitted();
  await loadHomeworkHistory(actor, row.id, { workId: "work", limit: 1 }, db);
  const eventQuery = fixture.homeworkEvent.findMany.mock.calls.find(
    ([args]) => args.take === 2,
  )?.[0];
  expect(eventQuery).toBeDefined();
  expect(fixture.homeworkAttempt.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: { in: ["attempt1"] }, workId: { in: ["work"] } } }),
  );
});
it("asset lookup first uses the verified prompt index and otherwise a work-bound uploaded asset", async () => {
  await canReadHomeworkAsset(actor, prompt, db);
  const first = fixture.homeworkAssignment.findMany.mock.calls[0]?.[0] as unknown as {
    where: { promptAssetUrls: { has: string } };
  };
  expect(first.where.promptAssetUrls.has).toBe(prompt);
  await canReadHomeworkAsset(actor, uploaded, db);
  expect(fixture.homeworkAsset.findUnique).toHaveBeenCalledWith(
    expect.objectContaining({ where: { assetId: uploaded.split("/").at(-1) } }),
  );
});
it("student work-filtered history includes safe assignment changes while hiding other works and roster notes", async () => {
  actor = teacher();
  await execute({
    type: "homework.settings",
    assignmentId: row.id,
    expectedVersion: 1,
    instructions: "统一说明",
    dueLocal: "2026-11-19T18:00",
    allowLate: true,
    reason: "SAFE_DEADLINE_REASON",
  });
  await execute({
    type: "homework.roster.sync",
    assignmentId: row.id,
    expectedVersion: 2,
    expectedRosterRevision: 1,
    reason: "PRIVATE_ROSTER_REASON",
  });
  await execute({
    type: "homework.close",
    assignmentId: row.id,
    expectedVersion: 3,
    reason: "SAFE_CLOSE_REASON",
  });
  events.push({
    ...events[0],
    id: "foreign-event",
    sequence: 4,
    type: "homework.return",
    workId: "another-work",
    reason: "PRIVATE_OTHER_STUDENT",
    details: {},
  });
  actor = student();
  const history = await loadHomeworkHistory(actor, row.id, { workId: "work" }, db),
    text = JSON.stringify(history);
  expect(history.events.map((event) => event.type)).toEqual([
    "homework.close",
    "homework.settings",
  ]);
  expect(text).toContain("SAFE_DEADLINE_REASON");
  expect(text).toContain("SAFE_CLOSE_REASON");
  expect(text).not.toContain("PRIVATE_ROSTER_REASON");
  expect(text).not.toContain("PRIVATE_OTHER_STUDENT");
});
it("student mixed subquestion scores use issued paper weights without modifying the private question snapshot", async () => {
  const frozen = row.papers as unknown as { paper: Paper }[];
  const content = frozen[0].paper.items[0].snapshot.content;
  content.parts = [
    { ...content.parts[0], id: "part-a", score: 6 },
    { ...content.parts[0], id: "part-b", score: 14 },
  ];
  const detail = await loadHomeworkAssignment(actor, row.id, db);
  expect(detail.assignment.papers[0].items[0].parts.map((part) => part.score)).toEqual([3, 7]);
  expect(content.parts.map((part) => part.score)).toEqual([6, 14]);
});
it("historical published results with an unconfirmed roster never advertise an accessible student feedback link", async () => {
  row.assessment.published = true;
  row.assessment.rosterStatus = "NEEDS_REVIEW";
  expect((await loadHomeworkAssignment(actor, row.id, db)).assignment.resultsPublished).toBe(false);
  actor = teacher();
  const detail = await loadHomeworkAssignment(actor, row.id, db);
  expect(detail.assignment.resultsPublished).toBe(false);
  expect(detail.assignment.capabilities.canManage).toBe(false);
  expect(detail.assignment.capabilities.blockReasons.join()).toContain("先撤回发布");
});
it("draft save records its own accepted time; teacher extensions and returns never advance it", async () => {
  expect((await loadHomeworkAssignment(actor, row.id, db)).view).toBe("STUDENT");
  const initialDetail = await loadHomeworkAssignment(actor, row.id, db);
  if (initialDetail.view !== "STUDENT") throw new Error("expected student");
  expect(initialDetail.works[0].draft.updatedAt).toBeNull();
  await save();
  expect(fixture.homeworkWork.update.mock.calls[0][0].data.draftUpdatedAt).toEqual(now);
  vi.setSystemTime(new Date(now.getTime() + 3600000));
  actor = teacher();
  await execute({
    type: "homework.deadline.extend",
    workId: "work",
    expectedVersion: row.works[0].version,
    dueLocal: "2026-11-18T18:00",
    reason: "教师延期",
  });
  actor = student();
  let detail = await loadHomeworkAssignment(actor, row.id, db);
  if (detail.view !== "STUDENT") throw new Error("expected student");
  expect(detail.works[0].draft.updatedAt).toBe(now.toISOString());
  await execute(submitInput());
  vi.setSystemTime(new Date(now.getTime() + 7200000));
  actor = teacher();
  await execute({
    type: "homework.return",
    workId: "work",
    expectedVersion: row.works[0].version,
    expectedAttemptId: "attempt1",
    reason: "修改重交",
  });
  actor = student();
  detail = await loadHomeworkAssignment(actor, row.id, db);
  if (detail.view !== "STUDENT") throw new Error("expected student");
  expect(detail.works[0].draft.updatedAt).toBe(now.toISOString());
  expect(
    fixture.homeworkWork.update.mock.calls.filter(([args]) => "draftUpdatedAt" in args.data),
  ).toHaveLength(1);
});
