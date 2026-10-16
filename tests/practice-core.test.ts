import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Paper, PlatformState } from "@/contracts/platform";
import type {
  PracticeAnswer,
  PracticeCommand,
  PracticeEvaluationInput,
} from "@/contracts/practice";
import type { Prisma, PracticeEvaluation } from "@/generated/prisma/client";
import type { SessionRow, AttemptRow } from "@/server/platform/practice/context";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), state: vi.fn(), root: "/tmp/practice-audit" }));
vi.mock("@/server/platform/access", async (original) => ({
  ...(await original<object>()),
  getActor: mocks.actor,
}));
vi.mock("@/server/platform/queries", () => ({ loadState: mocks.state }));
vi.mock("@/server/config/env", () => ({
  getStoragePaths: () => ({ storage: mocks.root, temp: mocks.root }),
}));
import {
  executePracticeCommand,
  loadPracticeSession,
  loadPracticeSessions,
  loadPracticeReview,
  loadPracticeAiContext,
  commitPracticeAiFeedback,
  loadPracticeHistory,
  loadPracticeEvidence,
  loadPracticeSources,
} from "@/server/platform/practice/service";
import { canReadPracticeAsset } from "@/server/platform/practice/assets";
import { sourceItems, replayFrozen } from "@/server/platform/practice/snapshot";
import { summary } from "@/server/platform/practice/context";
const now = new Date("2026-11-19T01:02:03Z"),
  requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const prompt = "/api/platform/assets/11111111-1111-1111-1111-111111111111",
  reference = "/api/platform/assets/22222222-2222-2222-2222-222222222222",
  answerImage = "/api/platform/assets/33333333-3333-3333-3333-333333333333";
const learner = (): PlatformState["actor"] => ({
  id: "user",
  name: "学生",
  role: "STUDENT",
  teachingAssignments: [],
});
const teacher = (): PlatformState["actor"] => ({
  id: "teacher",
  name: "教师",
  role: "TEACHER",
  teachingAssignments: [{ role: "SUBJECT_TEACHER", classroomId: "class", subject: "数学" }],
});
function paper(): Paper {
  return {
    id: "paper",
    ownerId: "teacher",
    name: "独立练习",
    subject: "数学",
    grade: "高中一年级",
    kind: "HOMEWORK",
    instructions: "",
    layout: { paperSize: "A4", columns: 1 },
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    items: [
      {
        id: "item",
        questionId: "question",
        position: 1,
        section: "",
        score: 10,
        snapshot: {
          id: "question",
          ownerId: "teacher",
          type: "MIXED",
          subject: "数学",
          grade: "高中一年级",
          knowledgeTags: ["整题标签"],
          difficulty: 0.5,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          content: {
            stem: "计算",
            options: [],
            images: [prompt, reference],
            answers: ["SECRET"],
            explanation: `参考 ![图](${reference})`,
            rubric: "依据",
            parts: [
              {
                id: "part",
                type: "BLANK",
                stem: "求值",
                options: [],
                answers: ["3"],
                explanation: "",
                rubric: "",
                score: 10,
                knowledgeTags: ["小问标签"],
              },
            ],
          },
        },
      },
    ],
  };
}
function initial(): SessionRow {
  return {
    id: "session",
    userId: "user",
    studentId: "student",
    classroomId: "class",
    identity: {
      studentId: "student",
      userId: "user",
      name: "快照姓名",
      studentNumber: "001",
      classroomId: "class",
      classroomName: "一班",
      stage: "高中",
      cohort: "2026",
    },
    sourceKind: "SET",
    setId: null,
    sourcePaperId: "paper",
    sourceVersion: "1",
    startRequestId: requestId,
    startInput: {},
    name: "练习",
    subject: "数学",
    version: 1,
    status: "DRAFT",
    frozenPaper: JSON.parse(
      JSON.stringify({
        paper: paper(),
        studentImageUrls: [],
        studentImageUrlsByItem: { item: [prompt] },
      }),
    ),
    contentFingerprint: "a".repeat(64),
    sourceItems: [
      {
        itemId: "item",
        originalQuestionId: "question",
        promptFingerprint: "b".repeat(64),
        eligibility: "UNKNOWN",
        reasons: [],
      },
    ],
    promptAssetUrls: [prompt],
    referenceAssetUrls: [prompt, reference],
    revealedItemIds: [],
    draftVersion: 0,
    draftAnswers: [],
    draftUpdatedAt: null,
    currentAttemptId: null,
    reviewRequestedAt: null,
    createdAt: now,
    student: {
      id: "student",
      userId: "user",
      classroomId: "class",
      name: "当前姓名",
      studentNumber: "001",
      classroom: {
        id: "class",
        name: "一班",
        ownerId: "teacher",
        stage: "高中",
        cohort: "2026",
      },
    },
    classroom: {
      id: "class",
      name: "一班",
      ownerId: "teacher",
      stage: "高中",
      cohort: "2026",
    },
    set: null,
    currentAttempt: null,
    _count: { attempts: 0 },
  };
}
function evaluation(
  judgment: "CORRECT" | "UNSURE" = "CORRECT",
  feedback = "计算核对",
): PracticeEvaluationInput {
  return {
    summary: "候选反馈",
    items: [
      { itemId: "item", judgment, feedback, parts: [{ partId: "part", judgment, feedback }] },
    ],
  };
}
let row: SessionRow,
  actor: PlatformState["actor"],
  attempts: AttemptRow[],
  evaluations: PracticeEvaluation[],
  events: {
    id: string;
    sequence: number;
    sessionId: string;
    setId: null;
    type: string;
    actorName: string;
    reason: string;
    details: Prisma.JsonValue;
    createdAt: Date;
  }[],
  exposures: { originalQuestionId: string; promptFingerprint: string; kind: string }[],
  fixture: ReturnType<typeof database>,
  db: Prisma.TransactionClient;
function database() {
  const apply = (data: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === "object" && "increment" in value)
        Object.assign(row, {
          [key]: Number(row[key as keyof SessionRow]) + Number(value.increment),
        });
      else Object.assign(row, { [key]: value });
    }
    row.currentAttempt = attempts.find((a) => a.id === row.currentAttemptId) ?? null;
  };
  return {
    $queryRaw: vi.fn(async () => []),
    practiceSession: {
      findUnique: vi.fn(async () => row),
      findMany: vi.fn(async (input?: unknown) => {
        void input;
        return [row];
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        row = { ...row };
        apply(data);
        return row;
      }),
    },
    practiceAttempt: {
      findUnique: vi.fn(
        async ({
          where,
        }: {
          where: { id?: string; sessionId_requestId?: { requestId: string } };
        }) =>
          where.id
            ? (attempts.find((a) => a.id === where.id) ?? null)
            : (attempts.find((a) => a.requestId === where.sessionId_requestId!.requestId) ?? null),
      ),
      findMany: vi.fn(async () => attempts),
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: { id?: string; sessionId?: string; assetUrls?: { has: string } };
        }) =>
          attempts.find((a) =>
            where.id
              ? a.id === where.id && a.sessionId === where.sessionId
              : a.assetUrls.includes(where.assetUrls!.has),
          ) ?? null,
      ),
      create: vi.fn(async ({ data }: { data: Omit<AttemptRow, "id" | "evaluations"> }) => {
        const a: AttemptRow = { ...data, id: `attempt${attempts.length + 1}`, evaluations: [] };
        attempts.push(a);
        row._count.attempts++;
        return a;
      }),
    },
    practiceExposure: {
      findMany: vi.fn(async () => exposures),
      createMany: vi.fn(async ({ data }: { data: typeof exposures }) => {
        exposures.push(...data);
        return { count: data.length };
      }),
    },
    practiceEvent: {
      create: vi.fn(
        async ({
          data,
        }: {
          data: Omit<
            (typeof events)[number],
            "id" | "sequence" | "createdAt" | "setId" | "reason"
          > &
            Partial<Pick<(typeof events)[number], "setId" | "reason">>;
        }) => {
          const event = {
            id: `event${events.length}`,
            sequence: events.length + 1,
            createdAt: now,
            setId: null,
            reason: "",
            ...data,
          };
          events.push(event);
          return event;
        },
      ),
      findMany: vi.fn(async () => [...events].reverse()),
      findFirst: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          events.find((e) => e.id === where.id) ?? null,
      ),
    },
    practiceEvaluation: {
      create: vi.fn(
        async ({
          data,
        }: {
          data: Omit<PracticeEvaluation, "id" | "createdAt" | "candidateId" | "aiJobId"> &
            Partial<Pick<PracticeEvaluation, "candidateId" | "aiJobId">>;
        }) => {
          const e: PracticeEvaluation = {
            id: `eval${evaluations.length + 1}`,
            createdAt: now,
            candidateId: null,
            aiJobId: null,
            ...data,
          };
          evaluations.push(e);
          attempts.find((a) => a.id === e.attemptId)!.evaluations.push(e);
          return e;
        },
      ),
      findMany: vi.fn(async () => evaluations.filter((e) => e.source !== "SELF")),
    },
    practiceEvidence: {
      createMany: vi.fn(async (input?: unknown) => {
        void input;
        return { count: 1 };
      }),
    },
    practiceAsset: {
      findUnique: vi.fn(async () => ({
        sessionId: row.id,
        uploadedBy: "user",
        asset: { ownerId: "user" },
      })),
    },
    practiceSet: {
      findFirst: vi.fn(async () => ({ id: "set-cursor", publishedAt: now })),
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => null),
      create: vi.fn(),
      update: vi.fn(),
    },
    aiJob: {
      findMany: vi.fn(async (): Promise<{ result: Prisma.JsonValue }[]> => []),
      findUnique: vi.fn(),
      update: vi.fn(async () => ({})),
    },
    platformAsset: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        ownerId: "teacher",
        path: join(mocks.root, "platform-assets", `${where.id}.png`),
        name: "图",
      })),
    },
    paper: {
      findFirst: vi.fn(async () => ({ id: "paper-cursor", updatedAt: now })),
      findMany: vi.fn(async (input?: unknown) => {
        void input;
        return [];
      }),
      findUnique: vi.fn(),
    },
    classroomStudent: {
      findUnique: vi.fn(async () => row.student),
      findFirst: vi.fn(async () => row.student),
      findMany: vi.fn(async () => []),
    },
    classroom: { findMany: vi.fn(async () => [row.classroom]) },
    schoolTerm: {
      findFirst: vi.fn(async () => ({ timezone: "Asia/Shanghai" })),
    },
  };
}
const command = (c: PracticeCommand) => executePracticeCommand({ id: actor.id }, c, { db });
const save = (answers: PracticeAnswer[] = [{ itemId: "item", text: "我的答案", images: [] }]) =>
  command({
    type: "practice.draft.save",
    sessionId: row.id,
    expectedVersion: row.version,
    expectedDraftVersion: row.draftVersion,
    answers,
  });
const submit = () =>
  command({
    type: "practice.submit",
    sessionId: row.id,
    expectedVersion: row.version,
    expectedDraftVersion: row.draftVersion,
    requestId,
  });
const selfAssess = () =>
  command({
    type: "practice.self-assess",
    attemptId: attempts[0].id,
    expectedEvaluationVersion: attempts[0].evaluations.length,
    evaluation: evaluation(),
  });
const aiInput = () => ({
  attemptId: attempts[0].id,
  sessionId: row.id,
  expectedEvaluationVersion: attempts[0].evaluations.length,
  attemptFingerprint: attempts[0].attemptFingerprint,
  contentFingerprint: row.contentFingerprint,
});
beforeEach(async () => {
  mocks.root = join(tmpdir(), "practice-core-audit");
  await mkdir(join(mocks.root, "platform-assets"), { recursive: true });
  for (const url of [prompt, reference, answerImage])
    await writeFile(
      join(mocks.root, "platform-assets", `${url.split("/").at(-1)}.png`),
      url === reference ? "solution-bytes" : "prompt-bytes",
    );
  row = initial();
  actor = learner();
  attempts = [];
  evaluations = [];
  events = [];
  exposures = [];
  fixture = database();
  db = fixture as unknown as Prisma.TransactionClient;
  mocks.actor.mockImplementation(async () => actor);
  mocks.state.mockResolvedValue({ papers: [], analytics: { students: [] } });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(mocks.root, { recursive: true, force: true });
});
it("does not expose references or manufacture a draft save time", async () => {
  const detail = await loadPracticeSession({ id: actor.id }, row.id, db);
  expect(JSON.stringify(detail)).not.toContain("SECRET");
  expect(detail.reference).toBeNull();
  expect(detail.draft?.updatedAt).toBeNull();
  await save();
  expect((await loadPracticeSession({ id: actor.id }, row.id, db)).draft?.updatedAt).toMatch(/^20/);
});
it("rejects stale draft versions without rewriting a saved draft", async () => {
  await save();
  const before = row.draftAnswers;
  await expect(
    command({
      type: "practice.draft.save",
      sessionId: row.id,
      expectedVersion: 1,
      expectedDraftVersion: 0,
      answers: [],
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(row.draftAnswers).toEqual(before);
});
it("freezes a submission and returns the original receipt after later changes", async () => {
  await save();
  const input = {
    type: "practice.submit" as const,
    sessionId: row.id,
    expectedVersion: row.version,
    expectedDraftVersion: row.draftVersion,
    requestId,
  };
  const receipt = await command(input);
  await selfAssess();
  await command({
    type: "practice.retry",
    sessionId: row.id,
    expectedVersion: row.version,
    copyPreviousAnswers: false,
  });
  await save([]);
  expect(await command(input)).toEqual(receipt);
  expect(attempts).toHaveLength(1);
  expect(attempts[0].answers).toEqual([{ itemId: "item", text: "我的答案", images: [] }]);
});
it("rejects a reused submission UUID with a different baseline", async () => {
  await submit();
  await expect(
    command({
      type: "practice.submit",
      sessionId: row.id,
      requestId,
      expectedVersion: row.version,
      expectedDraftVersion: 99,
    }),
  ).rejects.toMatchObject({ status: 409 });
});
it("freezes first-attempt eligibility, then marks feedback/retry conservatively", async () => {
  await submit();
  expect((await loadPracticeSession({ id: actor.id }, row.id, db)).eligibility).toMatchObject([
    { eligibility: "UNEXPOSED_IN_SYSTEM" },
  ]);
  expect(attempts[0].eligibility).toMatchObject([{ eligibility: "UNEXPOSED_IN_SYSTEM" }]);
  await selfAssess();
  await command({
    type: "practice.retry",
    sessionId: row.id,
    expectedVersion: row.version,
    copyPreviousAnswers: false,
  });
  expect((await loadPracticeSession({ id: actor.id }, row.id, db)).eligibility[0].eligibility).toBe(
    "ANSWER_AVAILABLE",
  );
  expect(attempts[0].eligibility).toMatchObject([{ eligibility: "UNEXPOSED_IN_SYSTEM" }]);
});
it("recognizes complete legacy recommendations even when not explicitly revealed", async () => {
  fixture.aiJob.findMany.mockResolvedValueOnce([
    { result: { result: { recommendations: [{ question: paper().items[0].snapshot }] } } },
  ]);
  await submit();
  expect(attempts[0].eligibility).toMatchObject([{ eligibility: "ANSWER_AVAILABLE" }]);
});
it("allows reference reveal only at the current CAS version and records exposure", async () => {
  await command({
    type: "practice.reference.reveal",
    sessionId: row.id,
    expectedVersion: row.version,
    itemIds: ["item"],
    reason: "看解析",
  });
  expect(exposures[0].kind).toBe("REFERENCE_REVEALED");
  expect(
    (await loadPracticeSession({ id: actor.id }, row.id, db)).reference?.items[0].answers,
  ).toEqual(["SECRET"]);
});
it("keeps drafts private even for admin and excludes their bodies from list queries", async () => {
  actor = { id: "admin", name: "管理员", role: "ADMIN", teachingAssignments: [] };
  await expect(loadPracticeSession({ id: actor.id }, row.id, db)).rejects.toMatchObject({
    status: 404,
  });
  await loadPracticeSessions({ id: actor.id }, {}, db);
  const select = fixture.practiceSession.findMany.mock.calls.at(-1)?.[0];
  expect(JSON.stringify(select)).not.toContain("draftAnswers");
  expect(JSON.stringify(select)).not.toContain("frozenPaper");
});
it("allows teachers to read immutable submissions but never the current draft", async () => {
  await save();
  await submit();
  actor = teacher();
  const detail = await loadPracticeSession({ id: actor.id }, row.id, db);
  expect(detail.draft).toBeNull();
  expect(detail.reference?.items[0].answers).toEqual(["SECRET"]);
  actor = learner();
  await expect(loadPracticeReview({ id: actor.id }, attempts[0].id, db)).rejects.toMatchObject({
    status: 404,
  });
});
it("rechecks current classroom scope and current student binding", async () => {
  await submit();
  actor = teacher();
  row.student.classroom = { ...row.student.classroom, id: "other" };
  row.student.classroomId = "other";
  await expect(loadPracticeSession({ id: actor.id }, row.id, db)).rejects.toMatchObject({
    status: 404,
  });
  actor = learner();
  row.student.userId = "new-user";
  await expect(loadPracticeSession({ id: actor.id }, row.id, db)).rejects.toMatchObject({
    status: 404,
  });
});
it("does not let a school manager confirm without subject-teacher authority", async () => {
  await submit();
  actor = { ...teacher(), teachingAssignments: [{ role: "SCHOOL_ADMIN" }] };
  await expect(
    command({
      type: "practice.review.confirm",
      attemptId: attempts[0].id,
      expectedEvaluationVersion: 0,
      candidateId: null,
      reason: "核验",
      evaluation: evaluation(),
    }),
  ).rejects.toMatchObject({ status: 404 });
});
it("preserves teacher confirmations against SELF and AI, and records per-part tags", async () => {
  await submit();
  actor = teacher();
  await command({
    type: "practice.review.confirm",
    attemptId: attempts[0].id,
    expectedEvaluationVersion: 0,
    candidateId: null,
    reason: "逐问核验",
    evaluation: evaluation(),
  });
  expect(fixture.practiceEvidence.createMany.mock.calls[0]?.[0]).toMatchObject({
    data: [{ knowledgeTags: ["小问标签"] }],
  });
  actor = learner();
  await expect(selfAssess()).rejects.toMatchObject({ status: 409 });
  await expect(loadPracticeAiContext({ id: actor.id }, aiInput(), db)).rejects.toMatchObject({
    status: 409,
  });
});
it("SELF cannot guess a private reference URL while teacher feedback may provide the trusted image", async () => {
  await submit();
  await expect(
    command({
      type: "practice.self-assess",
      attemptId: attempts[0].id,
      expectedEvaluationVersion: 0,
      evaluation: evaluation("CORRECT", `图 ![参考](${reference})`),
    }),
  ).rejects.toMatchObject({ status: 422 });
  expect(await canReadPracticeAsset(actor, reference, db)).toBe(false);
  actor = teacher();
  await command({
    type: "practice.review.confirm",
    attemptId: attempts[0].id,
    expectedEvaluationVersion: 0,
    candidateId: null,
    reason: "带图说明",
    evaluation: evaluation("CORRECT", `图 ![参考](${reference})`),
  });
  actor = learner();
  expect(await canReadPracticeAsset(actor, reference, db)).toBe(true);
});
it("feedback may reuse the current immutable answer photo but not another draft asset", async () => {
  await save([{ itemId: "item", text: "", images: [answerImage] }]);
  await submit();
  await command({
    type: "practice.self-assess",
    attemptId: attempts[0].id,
    expectedEvaluationVersion: 0,
    evaluation: evaluation("CORRECT", `我的图 ![作答](${answerImage})`),
  });
  expect(evaluations).toHaveLength(1);
});
it("commits AI candidate + exposure + evidence and completion under the same transaction", async () => {
  await submit();
  const input = aiInput();
  fixture.aiJob.findUnique.mockResolvedValue({
    id: "job",
    userId: actor.id,
    kind: "PRACTICE_GRADE",
    status: "RUNNING",
    input,
  });
  const result = await commitPracticeAiFeedback({ id: actor.id }, input, evaluation(), {
    jobId: "job",
    db,
  });
  expect(result.counts).toMatchObject({ CORRECT: 1, total: 1 });
  expect(evaluations[0].source).toBe("AI_CANDIDATE");
  expect(exposures.at(-1)?.kind).toBe("FEEDBACK_PROVIDED");
  expect(fixture.aiJob.update).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ status: "COMPLETED" }) }),
  );
});
it("rejects AI after retry without creating an evaluation or completing its job", async () => {
  await submit();
  const input = aiInput();
  fixture.aiJob.findUnique.mockResolvedValue({
    id: "job",
    userId: actor.id,
    kind: "PRACTICE_GRADE",
    status: "RUNNING",
    input,
  });
  await command({
    type: "practice.retry",
    sessionId: row.id,
    expectedVersion: row.version,
    copyPreviousAnswers: false,
  });
  await expect(
    commitPracticeAiFeedback({ id: actor.id }, input, evaluation(), { jobId: "job", db }),
  ).rejects.toMatchObject({ status: 409 });
  expect(evaluations).toHaveLength(0);
  expect(fixture.aiJob.update).not.toHaveBeenCalled();
});
it("requires exact mixed-part coverage instead of silently grading missing parts", async () => {
  await submit();
  const input = evaluation();
  input.items[0].parts = [];
  await expect(
    command({
      type: "practice.self-assess",
      attemptId: attempts[0].id,
      expectedEvaluationVersion: 0,
      evaluation: input,
    }),
  ).rejects.toMatchObject({ status: 422 });
});
it("reports submitted waiting and retry draft states independently of older feedback", async () => {
  await submit();
  expect(summary(row).feedbackState).toBe("WAITING");
  await selfAssess();
  expect(summary(row).feedbackState).toBe("SELF");
  await command({
    type: "practice.retry",
    sessionId: row.id,
    expectedVersion: row.version,
    copyPreviousAnswers: true,
  });
  expect(summary(row).feedbackState).toBe("NONE");
});
it("persists review requests with reasons while retaining the old confirmation history", async () => {
  await submit();
  actor = teacher();
  await command({
    type: "practice.review.confirm",
    attemptId: attempts[0].id,
    expectedEvaluationVersion: 0,
    candidateId: null,
    reason: "确认",
    evaluation: evaluation(),
  });
  actor = learner();
  await command({
    type: "practice.review.request",
    attemptId: attempts[0].id,
    expectedEvaluationVersion: 1,
    message: "请再看第二步",
  });
  expect(summary(row).feedbackState).toBe("WAITING");
  expect(evaluations).toHaveLength(1);
  const history = await loadPracticeHistory({ id: actor.id }, row.id, {}, db);
  expect(history.events.some((e) => e.reason === "请再看第二步")).toBe(true);
});
it("rejects unauthorized evidence lookups before returning a zero-evidence result", async () => {
  actor = { ...teacher(), teachingAssignments: [] };
  await expect(
    loadPracticeEvidence({ id: actor.id }, { studentId: "student" }, db),
  ).rejects.toMatchObject({ status: 404 });
});
it("addresses an older submission and exact immutable evaluation without switching to current retry data", async () => {
  await submit();
  await command({
    type: "practice.self-assess",
    attemptId: attempts[0].id,
    expectedEvaluationVersion: 0,
    evaluation: evaluation(),
  });
  const sourceAttempt = attempts[0],
    sourceEvaluation = sourceAttempt.evaluations[0];
  await command({
    type: "practice.retry",
    sessionId: row.id,
    expectedVersion: row.version,
    copyPreviousAnswers: false,
  });
  const history = await loadPracticeHistory(
    { id: actor.id },
    row.id,
    { attemptId: sourceAttempt.id, evaluationId: sourceEvaluation.id },
    db,
  );
  expect(history.attempts).toHaveLength(1);
  expect(history.attempts[0].attempt.id).toBe(sourceAttempt.id);
  expect(history.attempts[0].evaluations.map((e) => e.id)).toEqual([sourceEvaluation.id]);
  expect(history.attempts[0].reference).toBeNull();
  expect(history.nextBeforeId).toBeNull();
  expect(JSON.stringify(history)).not.toContain("标准答案");
});
it("rejects a missing, cross-session, or unrelated evaluation source and rechecks current ownership", async () => {
  await submit();
  const ownId = attempts[0].id;
  attempts.push({
    ...structuredClone(attempts[0]),
    id: "foreign-attempt",
    sessionId: "foreign-session",
  });
  for (const query of [
    { attemptId: "missing" },
    { attemptId: "foreign-attempt" },
    { attemptId: ownId, evaluationId: "foreign-evaluation" },
  ])
    await expect(loadPracticeHistory({ id: actor.id }, row.id, query, db)).rejects.toMatchObject({
      status: 404,
    });
  actor = { ...learner(), id: "another-student" };
  await expect(
    loadPracticeHistory({ id: actor.id }, row.id, { attemptId: ownId }, db),
  ).rejects.toMatchObject({ status: 404 });
  actor = { ...teacher(), teachingAssignments: [] };
  await expect(
    loadPracticeHistory({ id: actor.id }, row.id, { attemptId: ownId }, db),
  ).rejects.toMatchObject({ status: 404 });
});
it.each([{ evaluationId: "evaluation" }, { attemptId: "attempt", beforeId: "cursor" }])(
  "rejects incompatible source history query %j",
  async (query) => {
    await expect(loadPracticeHistory({ id: actor.id }, row.id, query, db)).rejects.toMatchObject({
      status: 400,
    });
  },
);
it("fingerprints actual non-inline prompt images across copied question/asset IDs", async () => {
  const p = paper(),
    frozen = replayFrozen(p),
    first = await sourceItems(db, p, frozen);
  const copy = structuredClone(p);
  copy.items[0].snapshot.id = "copy-question";
  copy.items[0].questionId = "copy-question";
  copy.items[0].snapshot.content.images[0] = answerImage;
  const same = await sourceItems(db, copy, replayFrozen(copy));
  expect(same[0].promptFingerprint).toBe(first[0].promptFingerprint);
  await writeFile(
    join(mocks.root, "platform-assets", `${answerImage.split("/").at(-1)}.png`),
    "different-diagram",
  );
  expect((await sourceItems(db, copy, replayFrozen(copy)))[0].promptFingerprint).not.toBe(
    first[0].promptFingerprint,
  );
});
it("uses independent set and paper cursors", async () => {
  await loadPracticeSources(
    { id: actor.id },
    { beforeId: "set-cursor", paperBeforeId: "paper-cursor" },
    db,
  );
  expect(fixture.paper.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { AND: [expect.objectContaining({ ownerId: actor.id }), { id: "paper-cursor" }] },
    }),
  );
  expect(fixture.paper.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ orderBy: [{ updatedAt: "desc" }, { id: "desc" }] }),
  );
});

it("AI feedback may provide its trusted reference image without publishing the whole reference", async () => {
  await submit();
  const input = aiInput();
  fixture.aiJob.findUnique.mockResolvedValue({
    id: "job",
    userId: actor.id,
    kind: "PRACTICE_GRADE",
    status: "RUNNING",
    input,
  });
  await commitPracticeAiFeedback(
    { id: actor.id },
    input,
    evaluation("CORRECT", `推理 ![图](${reference})`),
    { jobId: "job", db },
  );
  expect(await canReadPracticeAsset(actor, reference, db)).toBe(true);
  expect((await loadPracticeSession({ id: actor.id }, row.id, db)).reference).toBeNull();
  expect(exposures.at(-1)?.kind).toBe("FEEDBACK_PROVIDED");
});
it("does not authorize a feedback image from a different item or unrelated UUID", async () => {
  await submit();
  actor = teacher();
  await expect(
    command({
      type: "practice.review.confirm",
      attemptId: attempts[0].id,
      expectedEvaluationVersion: 0,
      candidateId: null,
      reason: "核对",
      evaluation: evaluation("CORRECT", `图 ![其它](${answerImage})`),
    }),
  ).rejects.toMatchObject({ status: 422 });
  expect(evaluations).toHaveLength(0);
  actor = learner();
  expect(await canReadPracticeAsset(actor, answerImage, db)).toBe(false);
});
it("keeps committed eligibility fixed after revealing and changes only the retry projection", async () => {
  await submit();
  await command({
    type: "practice.reference.reveal",
    sessionId: row.id,
    expectedVersion: row.version,
    itemIds: ["item"],
    reason: "看解析",
  });
  const detail = await loadPracticeSession({ id: actor.id }, row.id, db);
  expect(detail.eligibility[0].eligibility).toBe("UNEXPOSED_IN_SYSTEM");
  expect(detail.capabilities.canRevealReference).toBe(false);
  await command({
    type: "practice.retry",
    sessionId: row.id,
    expectedVersion: row.version,
    copyPreviousAnswers: false,
  });
  expect((await loadPracticeSession({ id: actor.id }, row.id, db)).eligibility[0].eligibility).toBe(
    "ANSWER_AVAILABLE",
  );
});
it("does not certify a copied question as unseen when legacy attached image roles are unknown", async () => {
  const legacy = paper();
  legacy.items[0].snapshot.id = "legacy-question";
  legacy.items[0].questionId = "legacy-question";
  legacy.items[0].snapshot.content.explanation = ""; // two unattested attached images, no body/reference mapping
  mocks.state.mockResolvedValue({ papers: [legacy], analytics: { students: [] } });
  await submit();
  expect(attempts[0].eligibility).toMatchObject([{ eligibility: "UNKNOWN" }]);
});
it("includes shared instruction content but excludes hidden answer edits in prompt identity", async () => {
  const p = paper();
  const original = (await sourceItems(db, p))[0].promptFingerprint;
  const hidden = structuredClone(p);
  hidden.items[0].snapshot.content.answers = ["different answer"];
  expect((await sourceItems(db, hidden))[0].promptFingerprint).toBe(original);
  hidden.instructions = "本卷另设 A={1,2,3}";
  expect((await sourceItems(db, hidden))[0].promptFingerprint).not.toBe(original);
});
it.each(["owner", "kind", "status", "input"])(
  "rejects an AI %s baseline mismatch without side effects",
  async (kind) => {
    await submit();
    const input = aiInput();
    const job = { id: "job", userId: actor.id, kind: "PRACTICE_GRADE", status: "RUNNING", input };
    if (kind === "owner") job.userId = "other";
    if (kind === "kind") job.kind = "GRADE";
    if (kind === "status") job.status = "COMPLETED";
    if (kind === "input") job.input = { ...input, expectedEvaluationVersion: 99 };
    fixture.aiJob.findUnique.mockResolvedValue(job);
    await expect(
      commitPracticeAiFeedback({ id: actor.id }, input, evaluation(), { jobId: "job", db }),
    ).rejects.toMatchObject({ status: 409 });
    expect(evaluations).toHaveLength(0);
    expect(fixture.aiJob.update).not.toHaveBeenCalled();
  },
);
it("reuses an already public trusted feedback picture in a later attempt without granting guessed references", async () => {
  await submit();
  actor = teacher();
  await command({
    type: "practice.review.confirm",
    attemptId: attempts[0].id,
    expectedEvaluationVersion: 0,
    candidateId: null,
    reason: "解释",
    evaluation: evaluation("CORRECT", `![图](${reference})`),
  });
  actor = learner();
  await command({
    type: "practice.retry",
    sessionId: row.id,
    expectedVersion: row.version,
    copyPreviousAnswers: false,
  });
  await command({
    type: "practice.submit",
    sessionId: row.id,
    expectedVersion: row.version,
    expectedDraftVersion: row.draftVersion,
    requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  });
  expect(await canReadPracticeAsset(actor, reference, db)).toBe(true);
  await command({
    type: "practice.self-assess",
    attemptId: attempts[1].id,
    expectedEvaluationVersion: 0,
    evaluation: evaluation("CORRECT", `![原已公开图](${reference})`),
  });
  expect(attempts[1].evaluations[0].source).toBe("SELF");
});
