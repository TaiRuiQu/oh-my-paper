import { beforeEach, expect, it, vi } from "vitest";
import type { Db } from "@/server/platform/access";
import type { PlatformState } from "@/contracts/platform";
const actorMock = vi.hoisted(() => vi.fn());
vi.mock("@/server/platform/access", async (original) => ({
  ...(await original<object>()),
  getActor: actorMock,
}));
import { loadRosterHistory } from "@/server/platform/roster-history";
import { resolveWebsitePath } from "@/server/xiaozhi/api-catalog";
const math = { paperId: "math", status: "REQUIRED", reason: "" };
const english = { paperId: "english", status: "REQUIRED", reason: "" };
function member(id = "student", classroomId = "class") {
  return {
    id: `participant-${id}`,
    studentId: id,
    name: id === "student" ? "名单时姓名" : "另一班秘密姓名",
    studentNumber: id,
    classroomId,
    classroomName: classroomId,
    stage: "高中",
    cohort: "2027",
    subjects: [{ ...math }, { ...english }],
  };
}
let mock: ReturnType<typeof fixture>;
function fixture() {
  const participants = [member(), member("secret", "other")];
  return {
    assessment: {
      findUnique: vi.fn().mockResolvedValue({
        id: "exam",
        ownerId: "owner",
        classroomIds: ["class", "other"],
        papers: [
          { paperId: "math", subject: "数学" },
          { paperId: "english", subject: "英语" },
        ],
        rosterRevision: 4,
        rosterStatus: "CONFIRMED",
        participants,
      }),
    },
    classroom: {
      findMany: vi.fn().mockResolvedValue([
        { id: "class", stage: "高中", cohort: "2027" },
        { id: "other", stage: "高中", cohort: "2027" },
      ]),
    },
    assessmentRosterEvent: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: "event",
          assessmentId: "exam",
          revision: 2,
          actorId: "owner",
          reason: "整体涉及另一班秘密原因",
          createdAt: new Date("2026-10-15T08:00Z"),
          changes: { added: participants },
        },
      ]),
    },
    paper: {
      findMany: vi.fn().mockResolvedValue([
        { id: "math", subject: "数学" },
        { id: "english", subject: "英语" },
      ]),
    },
    user: { findMany: vi.fn().mockResolvedValue([{ id: "owner", name: "操作教师当前姓名" }]) },
  };
}
function read(input: Record<string, unknown> = {}) {
  return loadRosterHistory(
    { id: "viewer" },
    { assessmentId: "exam", ...input },
    mock as unknown as Db,
  );
}
beforeEach(() => {
  mock = fixture();
  actorMock.mockReset().mockResolvedValue({
    id: "viewer",
    name: "管理员",
    role: "ADMIN",
  } satisfies PlatformState["actor"]);
});
it("normalizes initial additions with saved student identity, per-subject status, operator and time", async () => {
  const result = await read();
  expect(result.events[0]).toMatchObject({
    revision: 2,
    actorName: "操作教师当前姓名",
    createdAt: "2026-10-15T08:00:00.000Z",
    reason: "整体涉及另一班秘密原因",
  });
  expect(result.events[0].entries).toHaveLength(4);
  expect(result.events[0].entries[0]).toMatchObject({
    name: "名单时姓名",
    beforeStatus: null,
    status: "REQUIRED",
    kind: "ADDED",
  });
  expect(result.events[0]).not.toHaveProperty("changes");
});
it("projects multi-class and multi-subject history to current grants without leaking global reasons or snapshot JSON", async () => {
  actorMock.mockResolvedValue({
    id: "viewer",
    name: "数学教师",
    role: "TEACHER",
    teachingAssignments: [{ role: "SUBJECT_TEACHER", classroomId: "class", subject: "数学" }],
  });
  const result = await read();
  expect(result.scopeRestricted).toBe(true);
  expect(result.events[0].entries).toHaveLength(1);
  const json = JSON.stringify(result);
  expect(json).not.toContain("另一班秘密");
  expect(json).not.toContain("英语");
  expect(json).not.toContain('"paperId":"english"');
  expect(result.events[0].entries[0].reason).toContain("完整授权");
});
it("shows authorized local status reasons while withholding unrelated state changes", async () => {
  actorMock.mockResolvedValue({
    id: "viewer",
    role: "TEACHER",
    teachingAssignments: [{ role: "SUBJECT_TEACHER", classroomId: "class", subject: "数学" }],
  });
  mock.assessmentRosterEvent.findMany.mockResolvedValue([
    {
      id: "change",
      revision: 3,
      actorId: "owner",
      reason: "整体秘密",
      createdAt: new Date(),
      changes: {
        changes: [
          {
            participantId: "participant-student",
            studentId: "student",
            paperId: "math",
            before: math,
            after: { status: "ABSENT", reason: "本人病假" },
          },
          {
            participantId: "participant-secret",
            studentId: "secret",
            paperId: "english",
            before: english,
            after: { status: "EXEMPT", reason: "其他学生秘密" },
          },
        ],
      },
    },
  ]);
  const result = await read();
  expect(result.events[0].entries[0]).toMatchObject({
    beforeStatus: "REQUIRED",
    status: "ABSENT",
    reason: "本人病假",
  });
  expect(JSON.stringify(result)).not.toContain("其他学生秘密");
  expect(JSON.stringify(result)).not.toContain("整体秘密");
});
it("explains scope withdrawals and new subjects without repeating an earlier withdrawal", async () => {
  const active = member();
  active.subjects = [math];
  const withdrawn = member("old");
  withdrawn.subjects = [{ ...math, status: "WITHDRAWN", reason: "旧原因" }];
  mock.assessmentRosterEvent.findMany.mockResolvedValue([
    {
      id: "scope",
      revision: 4,
      actorId: "owner",
      reason: "调整科目范围",
      createdAt: new Date(),
      changes: {
        before: [active, withdrawn],
        selectedStudentIds: ["student"],
        paperIds: ["english"],
      },
    },
  ]);
  const result = await read();
  expect(
    result.events[0].entries.map((entry) => [
      entry.studentId,
      entry.paperId,
      entry.beforeStatus,
      entry.status,
    ]),
  ).toEqual([
    ["student", "math", "REQUIRED", "WITHDRAWN"],
    ["student", "english", null, "REQUIRED"],
  ]);
  expect(JSON.stringify(result)).not.toContain("旧原因");
});
it("keeps reconstruction confirmation meaningful for full-scope readers without inventing student changes", async () => {
  mock.assessmentRosterEvent.findMany.mockResolvedValue([
    {
      id: "confirm",
      revision: 4,
      actorId: "deleted",
      reason: "核对原始记录",
      createdAt: new Date(),
      changes: { confirmReconstruction: true },
    },
  ]);
  const result = await read();
  expect(result.events[0]).toMatchObject({
    actorName: "已删除账号",
    confirmedReconstruction: true,
    entries: [],
  });
});
it("does not expose historical removed subjects through overall reasons", async () => {
  actorMock.mockResolvedValue({
    id: "viewer",
    role: "TEACHER",
    teachingAssignments: [
      { role: "SUBJECT_TEACHER", classroomId: "class", subject: "数学" },
      { role: "SUBJECT_TEACHER", classroomId: "other", subject: "数学" },
    ],
  });
  const row = await mock.assessment.findUnique();
  row.papers = [{ paperId: "math", subject: "数学" }];
  const result = await read();
  expect(result.scopeRestricted).toBe(true);
  expect(JSON.stringify(result)).not.toContain("整体涉及另一班秘密原因");
});
it.each(["STUDENT", "TEACHER"] as const)(
  "rejects %s without current data authority before reading events",
  async (role) => {
    actorMock.mockResolvedValue({ id: "viewer", role, teachingAssignments: [] });
    await expect(read()).rejects.toMatchObject({ status: role === "STUDENT" ? 403 : 404 });
    expect(mock.assessmentRosterEvent.findMany).not.toHaveBeenCalled();
  },
);
it("paginates raw revision boundaries even if a page only contains hidden rows", async () => {
  actorMock.mockResolvedValue({
    id: "viewer",
    role: "TEACHER",
    teachingAssignments: [{ role: "SUBJECT_TEACHER", classroomId: "class", subject: "数学" }],
  });
  const event = {
    id: "hidden",
    revision: 3,
    actorId: "owner",
    reason: "秘密",
    createdAt: new Date(),
    changes: { added: [member("secret", "other")] },
  };
  mock.assessmentRosterEvent.findMany.mockResolvedValue([
    event,
    { ...event, id: "older", revision: 2 },
  ]);
  const result = await read({ beforeRevision: 4, limit: 1 });
  expect(result.events).toEqual([]);
  expect(result.nextBeforeRevision).toBe(3);
  expect(mock.assessmentRosterEvent.findMany).toHaveBeenCalledWith({
    where: { assessmentId: "exam", revision: { lt: 4 } },
    orderBy: { revision: "desc" },
    take: 2,
  });
});
it("validates the HTTP query and allows only the explicit read route in the website tool", async () => {
  await expect(read({ limit: 51 })).rejects.toMatchObject({ status: 400 });
  expect(resolveWebsitePath("/api/platform/roster-history", "GET")).toBeTruthy();
  expect(() => resolveWebsitePath("/api/platform/roster-history", "POST")).toThrow();
});

it("preserves the real migration reconstruction event for complete readers and hides it for partial grants", async () => {
  mock.assessmentRosterEvent.findMany.mockResolvedValue([
    {
      id: "migration",
      revision: 1,
      actorId: "system:migration",
      reason: "原系统未保存参试名册，按迁移时班级名单与已有答卷重建，须人工核对。",
      createdAt: new Date(),
      changes: { source: "MIGRATION_RECONSTRUCTION", requiresReview: true },
    },
  ]);
  expect((await read()).events[0]).toMatchObject({
    actorName: "系统迁移",
    reconstructedCandidate: true,
    confirmedReconstruction: false,
    entries: [],
  });
  actorMock.mockResolvedValue({
    id: "viewer",
    role: "TEACHER",
    teachingAssignments: [{ role: "SUBJECT_TEACHER", classroomId: "class", subject: "数学" }],
  });
  expect((await read()).events).toEqual([]);
});
