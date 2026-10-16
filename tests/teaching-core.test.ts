import { beforeEach, expect, it, vi } from "vitest";
import type {
  Prisma,
  TeachingSession as SessionModel,
  TeachingParticipant as ParticipantModel,
  TeachingPlanVersion as PlanModel,
} from "@/generated/prisma/client";
import type { PlatformState } from "@/contracts/platform";
import type { TeachingBinding, TeachingPlan } from "@/contracts/teaching";
import { z } from "zod";
import { canReadTeachingAsset } from "@/server/platform/teaching/assets";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), db: {} as Record<string, unknown> }));
vi.mock("@/server/db/client", () => ({ getDb: () => mocks.db }));
vi.mock("@/server/platform/access", async (original) => ({
  ...(await original<object>()),
  getActor: mocks.actor,
}));
import {
  executeTeachingCommand,
  loadTeachingSession,
  loadTeachingSessions,
  previewTeachingRoster,
  loadTeachingHistory,
} from "@/server/platform/teaching/service";
const date = new Date("2026-10-15T00:00:00Z");
const plan: TeachingPlan = {
  title: "函数课",
  objectives: "理解函数",
  keyPoints: "定义",
  difficulties: "对应",
  activities: [
    {
      id: "activity",
      title: "讨论",
      minutes: 40,
      teacherActions: "提问",
      studentActions: "讨论",
      assessment: "回答",
    },
  ],
  materials: [],
  boardPlan: "板书",
  assessmentPlan: "提问",
  notes: "",
};
const binding = (): TeachingBinding => ({
  publicationId: "publication",
  publicationRevision: 1,
  timezone: "Asia/Shanghai",
  lessonIds: ["lesson1", "lesson2"],
  lessons: ["08:00", "08:45"].map((startTime, index) => ({
    id: `snapshot${index}`,
    termId: "term",
    offeringId: "offering",
    slotId: "slot",
    date: "2026-10-15",
    originalDate: "2026-10-15",
    startTime,
    endTime: index ? "09:30" : "08:40",
    periodNames: [`第${index + 1}节`],
    courseId: "course",
    courseName: "数学",
    classroomId: "class",
    classroomName: "一班",
    teacherId: "teacher",
    teacherName: "授课教师",
    roomId: null,
    roomName: null,
    status: "SCHEDULED",
    reason: "",
  })),
});
let current: PlatformState["actor"],
  row: SessionModel | null,
  participants: ParticipantModel[],
  plans: PlanModel[],
  events: { version: number; snapshot: unknown }[],
  latest: TeachingBinding | null;
let students: { id: string; name: string; studentNumber: string }[];
let dbMocks: ReturnType<typeof fixture>;
const actor = { id: "teacher" };
function session(): SessionModel {
  return {
    id: "session",
    termId: "term",
    slotId: "slot",
    originalDate: "2026-10-15",
    teacherId: "teacher",
    version: 1,
    bindingVersion: 1,
    status: "NOT_STARTED",
    binding: z.json().parse(binding()),
    planVersion: 0,
    confirmedPlanVersion: null,
    rosterFingerprint: null,
    rosterConfirmed: false,
    summary: "",
    reflection: "",
    startedAt: null,
    finishedAt: null,
    interruptedAt: null,
    createdAt: date,
  };
}
function fixture() {
  const sessionRow = () =>
    row ? { ...row, participants: structuredClone(participants), plans: plans.slice(-1) } : null;
  return {
    $queryRaw: vi.fn(async () => []),
    $transaction: vi.fn(async (callback: (db: Prisma.TransactionClient) => unknown) =>
      callback(dbMocks as unknown as Prisma.TransactionClient),
    ),
    schoolTerm: {
      findUnique: vi.fn(async () => ({
        id: "term",
        publishedRevision: latest?.publicationRevision ?? null,
        archived: false,
      })),
      findMany: vi.fn(async () => [{ id: "term", publishedRevision: 1 }]),
    },
    schoolPublication: {
      findUnique: vi.fn(async () =>
        latest
          ? {
              id: latest.publicationId,
              revision: latest.publicationRevision,
              timezone: latest.timezone,
              lessons: latest.lessons.map((lesson, i) => ({
                id: latest!.lessonIds[i],
                teacherId: lesson.teacherId,
                snapshot: lesson,
              })),
            }
          : null,
      ),
      findMany: vi.fn(async () => []),
    },
    teachingSession: {
      findUnique: vi.fn(async () => sessionRow()),
      findFirst: vi.fn(async ({ where }) => {
        const id = where.AND?.[1]?.id;
        return row && row.id === id ? { id: row.id, createdAt: row.createdAt } : null;
      }),
      findMany: vi.fn(async (query: unknown) => {
        void query;
        return row ? [sessionRow()] : [];
      }),
      create: vi.fn(async ({ data }) => {
        row = { ...session(), ...data };
        return row;
      }),
      update: vi.fn(async ({ data }) => {
        row = { ...row!, ...data, ...(data.teacher ? { teacherId: data.teacher.connect.id } : {}) };
        return row;
      }),
    },
    teachingSessionLesson: { createMany: vi.fn(async () => ({ count: 2 })) },
    classroom: { findUnique: vi.fn(async () => ({ id: "class", name: "一班", students })) },
    teachingParticipant: {
      createMany: vi.fn(async ({ data }) => {
        for (const entry of data)
          participants.push({
            id: `participant-${entry.studentId}`,
            rosterStatus: "EXPECTED",
            rosterReason: "",
            attendance: "UNMARKED",
            attendanceReason: "",
            ...entry,
          });
      }),
      create: vi.fn(async ({ data }) => {
        participants.push({
          id: `participant-${data.studentId}`,
          rosterStatus: "EXPECTED",
          rosterReason: "",
          attendance: "UNMARKED",
          attendanceReason: "",
          ...data,
        });
      }),
      update: vi.fn(async ({ where, data }) => {
        const index = participants.findIndex((entry) => entry.id === where.id);
        participants[index] = { ...participants[index], ...data };
      }),
    },
    teachingPlanVersion: {
      create: vi.fn(async ({ data }) => {
        plans.push({ id: `plan${data.version}`, createdAt: date, ...data });
      }),
      findMany: vi.fn(async (query: unknown) => {
        void query;
        return plans;
      }),
    },
    teachingEvent: {
      create: vi.fn(async ({ data }) => {
        events.push(data);
      }),
      findMany: vi.fn(async () =>
        events.map((event, index) => ({
          ...event,
          id: `event${index}`,
          sessionId: "session",
          type: "test",
          actorName: "教师",
          actorId: "teacher",
          reason: "原因",
          createdAt: date,
        })),
      ),
    },
    aiJob: { findUnique: vi.fn(async () => null) },
    platformAsset: { findUnique: vi.fn(async () => null) },
    question: { findUnique: vi.fn(async () => null) },
  };
}
beforeEach(() => {
  current = { id: "teacher", role: "TEACHER", name: "授课教师", teachingAssignments: [] };
  mocks.actor.mockReset().mockImplementation(async () => current);
  row = session();
  participants = [];
  plans = [];
  events = [];
  latest = binding();
  students = [{ id: "student", name: "原名", studentNumber: "1001" }];
  dbMocks = fixture();
  Object.assign(mocks.db, dbMocks);
});
const save = (input: unknown, context?: Parameters<typeof executeTeachingCommand>[2]) =>
  executeTeachingCommand(actor, input, context);
const command = (type: string, extra: Record<string, unknown> = {}) => ({
  type: `teaching.${type}`,
  sessionId: "session",
  expectedVersion: row!.version,
  ...extra,
});
async function preparePlan() {
  await save(
    command("plan.save", {
      expectedPlanVersion: row!.planVersion,
      expectedBindingVersion: row!.bindingVersion,
      plan,
    }),
  );
  await save(command("plan.confirm", { planVersion: row!.planVersion }));
}
async function confirmRoster() {
  const preview = await previewTeachingRoster(actor, "session");
  await save(command("roster.confirm", { fingerprint: preview.fingerprint }));
}
async function start() {
  await preparePlan();
  await confirmRoster();
  await save(command("session.start"));
}
it("rejects students and revoked current roles before exposing plans, roster, history or commands", async () => {
  current = { id: "teacher", role: "STUDENT", name: "学生" };
  for (const read of [
    () => loadTeachingSession(actor, "session"),
    () => loadTeachingSessions(actor, {}),
    () => previewTeachingRoster(actor, "session"),
    () => loadTeachingHistory(actor, "session"),
  ])
    await expect(read()).rejects.toMatchObject({ status: 403 });
  await expect(save(command("session.start"))).rejects.toMatchObject({ status: 403 });
  expect(dbMocks.teachingSession.findUnique).not.toHaveBeenCalled();
});
it("creates one stable session for a double period and links exact immutable database lesson IDs", async () => {
  row = null;
  const input = {
    type: "teaching.session.prepare",
    termId: "term",
    slotId: "slot",
    originalDate: "2026-10-15",
    publicationId: "publication",
  };
  await save(input);
  await save(input);
  expect(dbMocks.teachingSession.create).toHaveBeenCalledTimes(1);
  expect(dbMocks.teachingSessionLesson.createMany).toHaveBeenCalledWith({
    data: [
      { sessionId: "session", bindingVersion: 1, lessonId: "lesson1" },
      { sessionId: "session", bindingVersion: 1, lessonId: "lesson2" },
    ],
  });
});
it("keeps all plan versions and requires confirmation again after every save", async () => {
  await preparePlan();
  expect(row!.confirmedPlanVersion).toBe(1);
  await save(
    command("plan.save", {
      expectedPlanVersion: 1,
      expectedBindingVersion: 1,
      plan: { ...plan, title: "修订" },
    }),
  );
  expect(plans.map((entry) => entry.version)).toEqual([1, 2]);
  expect(row!.confirmedPlanVersion).toBeNull();
  expect((await loadTeachingSession(actor, "session")).canStart).toBe(false);
});
it("rejects stale session and plan baselines before plan, audit or current state writes", async () => {
  await preparePlan();
  const count = events.length;
  await expect(
    save({
      ...command("plan.save", { expectedPlanVersion: 0, expectedBindingVersion: 1, plan }),
      expectedVersion: 1,
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(events).toHaveLength(count);
  expect(plans).toHaveLength(1);
});
it("confirms a persisted name snapshot only after checking the exact preview fingerprint", async () => {
  const preview = await previewTeachingRoster(actor, "session");
  students[0].name = "新名";
  await expect(
    save(command("roster.confirm", { fingerprint: preview.fingerprint })),
  ).rejects.toMatchObject({ status: 409 });
  await confirmRoster();
  students[0].name = "再次改名";
  expect(participants[0].name).toBe("新名");
  await expect(save(command("session.start"))).rejects.toMatchObject({ status: 409 });
});
it("requires explicit roster additions and exclusion instead of recreating the snapshot", async () => {
  await confirmRoster();
  students.push({ id: "new", name: "新增", studentNumber: "1002" });
  await expect(
    save(
      command("roster.confirm", {
        fingerprint: (await previewTeachingRoster(actor, "session")).fingerprint,
      }),
    ),
  ).rejects.toMatchObject({ status: 409 });
  const preview = await previewTeachingRoster(actor, "session");
  await save(
    command("roster.update", {
      fingerprint: preview.fingerprint,
      addStudentIds: ["new"],
      excludeParticipantIds: [participants[0].id],
      reason: "新成员增补，原成员退出",
    }),
  );
  expect(participants).toHaveLength(2);
  expect(participants[0].rosterStatus).toBe("EXCLUDED");
  expect(participants[1].attendance).toBe("UNMARKED");
});
it("does not default unmarked attendance to present and prevents finish until every expected member is marked", async () => {
  await start();
  await expect(
    save(command("session.finish", { summary: "已讲", reflection: "待改进" })),
  ).rejects.toMatchObject({ status: 409 });
  await save(
    command("attendance.save", {
      marks: [{ participantId: participants[0].id, status: "PRESENT", reason: "" }],
    }),
  );
  await save(command("session.finish", { summary: "已讲", reflection: "待改进" }));
  expect(row!.status).toBe("COMPLETED");
  expect(row!.reflection).toBe("待改进");
});
it.each(["LATE", "ABSENT", "EXCUSED", "LEFT_EARLY"])(
  "requires a reason for %s and records explicit status",
  async (status) => {
    await confirmRoster();
    await expect(
      save(
        command("attendance.save", {
          marks: [{ participantId: participants[0].id, status, reason: "" }],
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });
    await save(
      command("attendance.save", {
        marks: [{ participantId: participants[0].id, status, reason: "说明" }],
      }),
    );
    expect(participants[0].attendance).toBe(status);
  },
);
it("interrupts, resumes, and corrects a completed record only through reasoned audited commands", async () => {
  await start();
  await save(command("session.interrupt", { reason: "临时活动" }));
  expect(row!.status).toBe("INTERRUPTED");
  await save(command("session.resume", { reason: "活动结束" }));
  await save(
    command("attendance.save", {
      marks: [{ participantId: participants[0].id, status: "PRESENT", reason: "" }],
    }),
  );
  await save(command("session.finish", { summary: "总结", reflection: "反思" }));
  await expect(
    save(
      command("attendance.save", {
        marks: [{ participantId: participants[0].id, status: "ABSENT", reason: "更正" }],
      }),
    ),
  ).rejects.toMatchObject({ status: 409 });
  await save(
    command("session.correct", {
      reason: "核对纸质登记",
      marks: [{ participantId: participants[0].id, status: "LATE", reason: "迟到5分钟" }],
    }),
  );
  expect(participants[0].attendance).toBe("LATE");
  expect(events.at(-1)?.version).toBe(row!.version);
});
it("requires explicit rebind for unstarted republished lessons and preserves earlier binding links", async () => {
  await preparePlan();
  latest = { ...binding(), publicationId: "new-publication", publicationRevision: 2 };
  expect((await loadTeachingSession(actor, "session")).scheduleChanged).toBe(true);
  await expect(
    save(command("plan.save", { expectedPlanVersion: 1, expectedBindingVersion: 1, plan })),
  ).rejects.toMatchObject({ status: 409 });
  await save(command("session.rebind", { publicationId: "new-publication", reason: "核对新课表" }));
  expect(row!.bindingVersion).toBe(2);
  expect(row!.confirmedPlanVersion).toBeNull();
  expect(plans).toHaveLength(1);
});
it("revokes an unstarted previous teacher but lets the newly published substitute explicitly rebind", async () => {
  latest!.lessons.forEach((lesson) => (lesson.teacherId = "substitute"));
  await expect(loadTeachingSession(actor, "session")).rejects.toMatchObject({ status: 404 });
  current.id = "substitute";
  await save(command("session.rebind", { publicationId: "publication", reason: "明确代课绑定" }));
  expect(row!.teacherId).toBe("substitute");
});
it("keeps an already-started real teacher able to finish after republication without letting the substitute rewrite history", async () => {
  await start();
  latest!.lessons.forEach((lesson) => (lesson.teacherId = "substitute"));
  expect((await loadTeachingSession(actor, "session")).canTakeAttendance).toBe(true);
  current.id = "substitute";
  await expect(loadTeachingSession(actor, "session")).rejects.toMatchObject({ status: 404 });
  await expect(
    save({
      type: "teaching.session.prepare",
      termId: "term",
      slotId: "slot",
      originalDate: "2026-10-15",
      publicationId: "publication",
    }),
  ).rejects.toMatchObject({ status: 404 });
  current.id = "teacher";
  await save(
    command("attendance.save", {
      marks: [{ participantId: participants[0].id, status: "PRESENT", reason: "" }],
    }),
  );
  await save(command("session.finish", { summary: "实际授课总结", reflection: "反思" }));
  expect(row!.status).toBe("COMPLETED");
  expect((await loadTeachingSession(actor, "session")).canCorrect).toBe(true);
});
it("binds AI candidate writes to the exact running task and never confirms or starts them", async () => {
  dbMocks.aiJob.findUnique.mockResolvedValue({
    id: "job",
    userId: "teacher",
    kind: "LESSON_PREPARE",
    status: "RUNNING",
    input: {
      sessionId: "session",
      publicationId: "publication",
      expectedVersion: 1,
      expectedPlanVersion: 0,
      expectedBindingVersion: 1,
      requirements: "备课",
    },
  } as never);
  await save(command("plan.save", { expectedPlanVersion: 0, expectedBindingVersion: 1, plan }), {
    source: "AI",
    jobId: "job",
  });
  expect(plans[0].source).toBe("AI");
  expect(row!.confirmedPlanVersion).toBeNull();
  expect(row!.status).toBe("NOT_STARTED");
  await expect(
    save(command("plan.confirm", { planVersion: 1 }), { source: "AI", jobId: "job" }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    save(command("plan.save", { expectedPlanVersion: 1, expectedBindingVersion: 1, plan }), {
      source: "AI",
      jobId: "job",
    }),
  ).rejects.toMatchObject({ status: 409 });
});
it("validates list bounds and paginates only the requested session page", async () => {
  await expect(
    loadTeachingSessions(actor, { startDate: "2026-10-16", endDate: "2026-10-15" }),
  ).rejects.toMatchObject({ status: 400 });
  await expect(loadTeachingSessions(actor, { limit: 1, beforeId: "zzz" })).rejects.toMatchObject({
    status: 404,
  });
  await loadTeachingSessions(actor, { limit: 1 });
  expect(dbMocks.teachingSession.findMany.mock.lastCall?.[0]).toMatchObject({
    take: 2,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, createdAt: true },
  });
});

it("preserves a cancelled unstarted record for its actual teacher without making it editable", async () => {
  await save(command("session.cancel", { reason: "活动取消" }));
  const detail = await loadTeachingSession(actor, "session");
  expect(detail.status).toBe("CANCELLED");
  expect(detail.canPrepare).toBe(false);
  expect(detail.canStart).toBe(false);
  expect(events.at(-1)?.version).toBe(row!.version);
});
it("freezes the authoritative question content and permits only trusted attached sources for shared images", async () => {
  const url = "/api/platform/assets/00000000-0000-4000-8000-000000000001";
  dbMocks.question.findUnique.mockResolvedValue({
    id: "question",
    ownerId: "teacher",
    type: "SUBJECTIVE",
    subject: "数学",
    grade: "高中一年级",
    updatedAt: date,
    content: { stem: "真实题干", answers: ["真实答案"], images: [url] },
  } as never);
  dbMocks.platformAsset.findUnique.mockResolvedValue({
    id: "asset",
    ownerId: "admin-shared",
  } as never);
  await save(
    command("plan.save", {
      expectedPlanVersion: 0,
      expectedBindingVersion: 1,
      plan: {
        ...plan,
        materials: [
          {
            id: "question-material",
            title: "例题",
            kind: "QUESTION",
            questionId: "question",
            content: "模型伪造的摘录",
          },
        ],
      },
    }),
  );
  const stored = plans[0].plan as unknown as TeachingPlan;
  expect(stored.materials[0].content).toContain("真实题干");
  expect(stored.materials[0].content).toContain("真实答案");
  expect(stored.materials[0].content).not.toContain("模型伪造");
  await expect(
    save(
      command("plan.save", {
        expectedPlanVersion: 1,
        expectedBindingVersion: 1,
        plan: { ...plan, notes: url },
      }),
    ),
  ).rejects.toMatchObject({ status: 404 });
});
it("does not let a stale AI task adopt newly accepted human edits", async () => {
  dbMocks.aiJob.findUnique.mockResolvedValue({
    id: "job",
    userId: "teacher",
    kind: "LESSON_PREPARE",
    status: "RUNNING",
    input: {
      sessionId: "session",
      publicationId: "publication",
      expectedVersion: 1,
      expectedPlanVersion: 0,
      expectedBindingVersion: 1,
      requirements: "",
    },
  } as never);
  await preparePlan();
  const count = events.length;
  await expect(
    save(command("plan.save", { expectedPlanVersion: 1, expectedBindingVersion: 1, plan }), {
      source: "AI",
      jobId: "job",
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(events).toHaveLength(count);
  expect(plans[0].source).toBe("HUMAN");
});
it("does not allow an old AI publication baseline after an explicit rebind", async () => {
  dbMocks.aiJob.findUnique.mockResolvedValue({
    id: "job",
    userId: "teacher",
    kind: "LESSON_PREPARE",
    status: "RUNNING",
    input: {
      sessionId: "session",
      publicationId: "publication",
      expectedVersion: 1,
      expectedPlanVersion: 0,
      expectedBindingVersion: 1,
      requirements: "",
    },
  } as never);
  latest = { ...binding(), publicationId: "new-publication", publicationRevision: 2 };
  await save(command("session.rebind", { publicationId: "new-publication", reason: "接受新安排" }));
  await expect(
    save(command("plan.save", { expectedPlanVersion: 0, expectedBindingVersion: 2, plan }), {
      source: "AI",
      jobId: "job",
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(plans).toHaveLength(0);
});

it("truthfully disables archived unstarted capabilities before an AI task or lesson write can begin", async () => {
  dbMocks.schoolTerm.findUnique.mockResolvedValue({
    id: "term",
    publishedRevision: 1,
    archived: true,
  });
  const detail = await loadTeachingSession(actor, "session");
  expect(detail.canPrepare).toBe(false);
  expect(detail.canTakeAttendance).toBe(false);
  expect(detail.canStart).toBe(false);
  expect(detail.blockReasons.join()).toContain("归档");
  await expect(
    save(command("plan.save", { expectedPlanVersion: 0, expectedBindingVersion: 1, plan })),
  ).rejects.toMatchObject({ status: 409 });
  expect(plans).toHaveLength(0);
});
it("keeps an archived already-started classroom finishable and correctable for the real teacher", async () => {
  await start();
  dbMocks.schoolTerm.findUnique.mockResolvedValue({
    id: "term",
    publishedRevision: 1,
    archived: true,
  });
  expect((await loadTeachingSession(actor, "session")).canTakeAttendance).toBe(true);
  await save(
    command("attendance.save", {
      marks: [{ participantId: participants[0].id, status: "PRESENT", reason: "" }],
    }),
  );
  await save(command("session.finish", { summary: "总结", reflection: "反思" }));
  expect((await loadTeachingSession(actor, "session")).canCorrect).toBe(true);
});

it.each(["classroomId", "courseId"] as const)(
  "does not transfer an existing roster or plan when a published slot changes %s",
  async (field) => {
    await preparePlan();
    await confirmRoster();
    latest!.lessons.forEach((lesson) => {
      lesson.teacherId = "newteacher";
      lesson[field] = "other";
    });
    current.id = "newteacher";
    await expect(loadTeachingSession(actor, "session")).rejects.toMatchObject({ status: 404 });
    await expect(loadTeachingHistory(actor, "session")).rejects.toMatchObject({ status: 404 });
    await expect(
      save({
        type: "teaching.session.prepare",
        termId: "term",
        slotId: "slot",
        originalDate: "2026-10-15",
        publicationId: "publication",
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      save(command("session.rebind", { publicationId: "publication", reason: "不能转移旧课堂" })),
    ).rejects.toMatchObject({ status: 404 });
    current = { id: "admin", role: "ADMIN", name: "管理员" };
    await expect(
      save(command("session.rebind", { publicationId: "publication", reason: "管理员也不能转移" })),
    ).rejects.toMatchObject({ status: 409 });
    expect(participants[0].classroomId).toBe("class");
    expect(row!.teacherId).toBe("teacher");
    expect(row!.bindingVersion).toBe(1);
  },
);

it("does not offer start after all members were explicitly excluded", async () => {
  await preparePlan();
  await confirmRoster();
  const preview = await previewTeachingRoster(actor, "session");
  await save(
    command("roster.update", {
      fingerprint: preview.fingerprint,
      addStudentIds: [],
      excludeParticipantIds: participants.map((entry) => entry.id),
      reason: "本次全员退出",
    }),
  );
  const detail = await loadTeachingSession(actor, "session");
  expect(detail.canStart).toBe(false);
  expect(detail.canTakeAttendance).toBe(false);
  expect(detail.canManageRoster).toBe(true);
  expect(detail.blockReasons.join()).toContain("至少保留一位");
});
it("lets the actual teacher restore an active roster after explicitly excluding every member", async () => {
  await start();
  await save(
    command("roster.update", {
      fingerprint: (await previewTeachingRoster(actor, "session")).fingerprint,
      addStudentIds: [],
      excludeParticipantIds: participants.map((entry) => entry.id),
      reason: "临时全员退出",
    }),
  );
  const detail = await loadTeachingSession(actor, "session");
  expect(detail.canPrepare).toBe(false);
  expect(detail.canTakeAttendance).toBe(false);
  expect(detail.canManageRoster).toBe(true);
  const preview = await previewTeachingRoster(actor, "session");
  await save(
    command("roster.update", {
      fingerprint: preview.fingerprint,
      addStudentIds: [],
      excludeParticipantIds: [],
      restoreParticipantIds: [participants[0].id],
      reason: "核对后恢复应到成员",
    }),
  );
  expect((await loadTeachingSession(actor, "session")).canTakeAttendance).toBe(true);
  await save(
    command("attendance.save", {
      marks: [{ participantId: participants[0].id, status: "PRESENT", reason: "" }],
    }),
  );
  await save(command("session.finish", { summary: "恢复后完成", reflection: "核实名单" }));
  expect(row!.status).toBe("COMPLETED");
});
it("indexes validated plan images and authorizes a legitimate substitute or manager while rejecting outsiders and students", async () => {
  const url = "/api/platform/assets/00000000-0000-4000-8000-000000000001";
  dbMocks.platformAsset.findUnique.mockResolvedValue({ id: "asset", ownerId: "teacher" } as never);
  await save(
    command("plan.save", {
      expectedPlanVersion: 0,
      expectedBindingVersion: 1,
      plan: {
        ...plan,
        materials: [{ id: "image", title: "板书图", kind: "ASSET", content: "", url }],
      },
    }),
  );
  expect(plans[0].assetUrls).toEqual([url]);
  const db = dbMocks as unknown as Prisma.TransactionClient;
  latest!.lessons.forEach((lesson) => (lesson.teacherId = "substitute"));
  current.id = "substitute";
  await expect(canReadTeachingAsset(current, url, db)).resolves.toBe(true);
  expect(dbMocks.teachingPlanVersion.findMany.mock.lastCall?.[0]).toMatchObject({
    where: { assetUrls: { has: url } },
    select: { sessionId: true },
    distinct: ["sessionId"],
  });
  current = {
    id: "school-manager",
    role: "TEACHER",
    name: "教务",
    teachingAssignments: [{ role: "SCHOOL_ADMIN" }],
  };
  await expect(canReadTeachingAsset(current, url, db)).resolves.toBe(true);
  current = { id: "outsider", role: "TEACHER", name: "外人", teachingAssignments: [] };
  await expect(canReadTeachingAsset(current, url, db)).resolves.toBe(false);
  current = { id: "student-account", role: "STUDENT", name: "学生" };
  await expect(canReadTeachingAsset(current, url, db)).resolves.toBe(false);
});

it("preserves unchanged frozen QUESTION and ASSET materials when the source is edited/deleted or the same-class substitute edits the title", async () => {
  const url = "/api/platform/assets/00000000-0000-4000-8000-000000000001";
  dbMocks.question.findUnique.mockResolvedValue({
    id: "question",
    ownerId: "teacher",
    type: "SUBJECTIVE",
    subject: "数学",
    grade: "高中一年级",
    updatedAt: date,
    content: { stem: "第一版例题", images: [url] },
  } as never);
  dbMocks.platformAsset.findUnique.mockResolvedValue({ id: "asset", ownerId: "teacher" } as never);
  await save(
    command("plan.save", {
      expectedPlanVersion: 0,
      expectedBindingVersion: 1,
      plan: {
        ...plan,
        materials: [
          { id: "q", title: "例题", kind: "QUESTION", questionId: "question", content: "" },
          { id: "image", title: "图", kind: "ASSET", url, content: "图片" },
        ],
      },
    }),
  );
  const frozen = plans[0].plan as unknown as TeachingPlan;
  dbMocks.question.findUnique.mockResolvedValue(null);
  dbMocks.platformAsset.findUnique.mockResolvedValue(null);
  latest!.lessons.forEach((lesson) => (lesson.teacherId = "substitute"));
  current.id = "substitute";
  await save(command("session.rebind", { publicationId: "publication", reason: "同班同课代课" }));
  await save(
    command("plan.save", {
      expectedPlanVersion: 1,
      expectedBindingVersion: 2,
      plan: { ...frozen, title: "代课调整标题" },
    }),
  );
  const updated = plans[1].plan as unknown as TeachingPlan;
  expect(updated.materials).toEqual(frozen.materials);
  expect(updated.materials[0].content).toContain("第一版例题");
  expect(plans[1].assetUrls).toEqual([url]);
  await expect(
    save(
      command("plan.save", {
        expectedPlanVersion: 2,
        expectedBindingVersion: 2,
        plan: { ...updated, notes: url },
      }),
    ),
  ).rejects.toMatchObject({ status: 404 });
});
it("filters moved sessions by the actual teaching date rather than their original stable-key date", async () => {
  const changed = binding();
  changed.lessons.forEach((lesson) => (lesson.date = "2026-10-16"));
  row!.binding = z.json().parse(changed);
  latest = changed;
  expect(
    (await loadTeachingSessions(actor, { startDate: "2026-10-16", endDate: "2026-10-16" }))
      .sessions,
  ).toHaveLength(1);
  expect(
    (await loadTeachingSessions(actor, { startDate: "2026-10-15", endDate: "2026-10-15" }))
      .sessions,
  ).toHaveLength(0);
});

it("treats PostgreSQL JSONB reordered object keys as the same semantic binding", async () => {
  const reorder = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(reorder)
      : value !== null && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .reverse()
              .map(([key, entry]) => [key, reorder(entry)]),
          )
        : value;
  row!.binding = z.json().parse(reorder(binding()));
  const detail = await loadTeachingSession(actor, "session");
  expect(detail.scheduleChanged).toBe(false);
  expect(detail.canPrepare).toBe(true);
  await expect(previewTeachingRoster(actor, "session")).resolves.toMatchObject({
    candidates: [{ studentId: "student" }],
  });
});
