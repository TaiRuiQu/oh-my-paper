// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  TeachingCommand,
  TeachingPlan,
  TeachingRosterPreview,
  TeachingSession,
  TeachingSessions,
  TeachingHistory,
} from "@/contracts/teaching";
import type { SchoolLesson, SchoolSchedule, SchoolState } from "@/contracts/school";
import type { AiJobDTO } from "@/contracts/platform-ai";
import { TeachingWorkspace } from "@/components/teaching/workspace";
import { apiRequest, ApiRequestError } from "@/lib/http-client";

const { push, progress } = vi.hoisted(() => ({
  push: vi.fn(),
  progress: { jobs: [] as AiJobDTO[], completed: async () => {} },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/components/platform/use-ai-progress", () => ({
  useAiProgress: ({ onCompleted }: { onCompleted: () => Promise<void> }) => {
    progress.completed = onCompleted;
    return {
      models: [{ id: "model", name: "备课模型" }],
      jobs: progress.jobs,
      loading: false,
      failure: "",
      reconnect: vi.fn(),
    };
  },
}));
vi.mock("@/lib/http-client", async (original) => ({
  ...(await original<typeof import("@/lib/http-client")>()),
  apiRequest: vi.fn(),
}));
const api = vi.mocked(apiRequest);
let host: HTMLDivElement,
  root: Root,
  session: TeachingSession,
  list: TeachingSessions,
  school: SchoolState,
  schedule: SchoolSchedule,
  roster: TeachingRosterPreview;
const plan = (): TeachingPlan => ({
  title: "函数教学",
  objectives: "通过图像理解函数",
  keyPoints: "理解图像",
  difficulties: "解释变化",
  activities: [
    {
      id: "activity",
      title: "图像讨论",
      minutes: 15,
      teacherActions: "展示问题",
      studentActions: "小组讨论",
      assessment: "口头说明",
    },
  ],
  materials: [],
  boardPlan: "函数图像",
  assessmentPlan: "观察学生解释",
  notes: "",
});
const lesson = (suffix = "p1"): SchoolLesson => ({
  id: `term/slot/2026-10-15/${suffix}`,
  termId: "term",
  offeringId: "offering",
  slotId: "slot",
  date: "2026-10-15",
  originalDate: "2026-10-15",
  startTime: suffix === "p1" ? "08:00" : "09:00",
  endTime: suffix === "p1" ? "08:45" : "09:45",
  periodNames: [suffix],
  courseId: "course",
  courseName: "数学",
  classroomId: "class",
  classroomName: "一班",
  teacherId: "teacher",
  teacherName: "张老师",
  roomId: "room",
  roomName: "101教室",
  status: "SCHEDULED",
  reason: "",
});
function fixture(): TeachingSession {
  const binding = {
    publicationId: "publication",
    publicationRevision: 3,
    timezone: "Asia/Shanghai",
    lessonIds: ["db-p1", "db-p2"],
    lessons: [lesson(), lesson("p2")],
  };
  return {
    id: "session",
    termId: "term",
    slotId: "slot",
    originalDate: "2026-10-15",
    version: 2,
    bindingVersion: 1,
    status: "NOT_STARTED",
    binding,
    planVersion: 0,
    confirmedPlanVersion: null,
    plan: null,
    rosterFingerprint: null,
    rosterConfirmed: false,
    participants: [],
    summary: "",
    reflection: "",
    startedAt: null,
    finishedAt: null,
    interruptedAt: null,
    currentSchedule: binding,
    scheduleChanged: false,
    canPrepare: true,
    canRebind: false,
    canCancel: true,
    canManageRoster: true,
    canTakeAttendance: true,
    canStart: false,
    canFinish: false,
    canCorrect: false,
    blockReasons: ["教案尚未确认当前版本。", "课堂名单尚未核对确认。"],
  };
}
function prepared() {
  session.planVersion = 1;
  session.plan = {
    id: "plan-version",
    version: 1,
    source: "HUMAN",
    aiJobId: null,
    actorName: "张老师",
    createdAt: "2026-10-15T00:00:00Z",
    bindingVersion: 1,
    plan: plan(),
  };
  session.confirmedPlanVersion = 1;
  session.rosterConfirmed = true;
  session.rosterFingerprint = "a".repeat(64);
  session.canStart = true;
  session.blockReasons = [];
  session.participants = [
    {
      id: "participant",
      studentId: "student",
      name: "李同学",
      studentNumber: "1001",
      classroomId: "class",
      classroomName: "一班",
      rosterStatus: "EXPECTED",
      rosterReason: "",
      attendance: "UNMARKED",
      attendanceReason: "",
    },
  ];
}
beforeEach(() => {
  vi.resetAllMocks();
  progress.jobs = [];
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  session = fixture();
  list = {
    actor: { id: "teacher", role: "TEACHER", name: "张老师" },
    canManage: false,
    sessions: [],
    nextBeforeId: null,
  };
  school = {
    actor: list.actor,
    canManage: false,
    years: [],
    terms: [
      {
        id: "term",
        yearId: "year",
        name: "秋季学期",
        startDate: "2026-09-01",
        endDate: "2027-01-31",
        weekOneMonday: "2026-08-31",
        timezone: "Asia/Shanghai",
        archived: false,
        revision: 3,
        publishedRevision: 3,
        publishedAt: "2026-10-01T00:00:00Z",
      },
    ],
    courses: [],
    rooms: [],
    teachers: [],
    classrooms: [],
    offerings: [],
    publications: [],
  };
  schedule = {
    termId: "term",
    publicationId: "publication",
    revision: 3,
    timezone: "Asia/Shanghai",
    startDate: "2026-10-15",
    endDate: "2026-10-15",
    lessons: [lesson(), lesson("p2")],
    status: "PUBLISHED",
  };
  roster = {
    sessionId: "session",
    fingerprint: "a".repeat(64),
    candidates: [
      {
        studentId: "student",
        name: "李同学",
        studentNumber: "1001",
        classroomId: "class",
        classroomName: "一班",
      },
    ],
    addedStudentIds: ["student"],
    removedParticipantIds: [],
  };
  api.mockImplementation(async (url, init) => {
    if (url === "/api/platform/school/state") return school as never;
    if (url.startsWith("/api/platform/school/schedule?")) return schedule as never;
    if (url.endsWith("/roster-preview")) return roster as never;
    if (url.includes("/history?"))
      return {
        sessionId: session.id,
        events: [
          {
            id: "event",
            version: 2,
            type: "PLAN_SAVE",
            actorName: "张老师",
            createdAt: "2026-10-15T00:00:00Z",
            reason: "明确调整",
            snapshot: session,
          },
        ],
        plans: session.plan ? [session.plan] : [],
        nextBeforeVersion: null,
      } as never;
    if (url === "/api/platform/teaching/sessions/session") return structuredClone(session) as never;
    if (url.startsWith("/api/platform/teaching/sessions")) return list as never;
    if (url === "/api/platform/teaching/commands") {
      const command = JSON.parse(String(init?.body)) as TeachingCommand;
      if (command.type === "teaching.plan.save") {
        session.planVersion++;
        session.plan = {
          id: "plan-version",
          version: session.planVersion,
          source: "HUMAN",
          aiJobId: null,
          actorName: "张老师",
          createdAt: "2026-10-15T00:00:00Z",
          bindingVersion: 1,
          plan: command.plan,
        };
      }
      session.version++;
      return { id: "session", version: session.version } as never;
    }
    return { id: "job" } as never;
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
async function render(section: "list" | "session" = "session") {
  await act(async () =>
    root.render(
      <TeachingWorkspace
        section={section}
        initialList={section === "list" ? list : undefined}
        initialSession={section === "session" ? structuredClone(session) : undefined}
      />,
    ),
  );
}
async function click(text: string) {
  const button = [...host.querySelectorAll("button")].find((entry) => entry.textContent === text);
  expect(button, text).toBeTruthy();
  await act(async () => button!.click());
}
function field(label: string) {
  const node = [...host.querySelectorAll("label")].find(
    (entry) => entry.querySelector("span")?.textContent === label,
  );
  expect(node, label).toBeTruthy();
  return node!.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    "input,textarea,select",
  )!;
}
async function fill(label: string, value: string) {
  const input = field(label);
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!.call(input, value);
    input.dispatchEvent(
      new Event(input instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }),
    );
  });
}
async function check(text: string) {
  const label = [...host.querySelectorAll("label")].find((entry) =>
    entry.textContent?.includes(text),
  );
  expect(label, text).toBeTruthy();
  await act(async () => label!.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
}
function commands() {
  return api.mock.calls
    .filter(([url]) => url === "/api/platform/teaching/commands")
    .map(([, init]) => JSON.parse(String(init?.body)) as TeachingCommand);
}

it("defaults to the active term by the school's date and retains an explicit future-term selection", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // The school has reached Oct 15 while the UTC/device date is still Oct 14.
  vi.setSystemTime(new Date("2026-10-14T16:30:00Z"));
  const current = { ...school.terms[0], startDate: "2026-10-15" };
  const future = {
    ...current,
    id: "future",
    name: "明年春季",
    startDate: "2027-02-01",
    endDate: "2027-06-30",
  };
  school.terms = [future, current];
  await render("list");
  expect(field("授课所属学期").value).toBe("term");
  expect(field("查看授课日期").value).toBe("2026-10-15");
  const scheduleRequests = () =>
    api.mock.calls.filter(([url]) => url.startsWith("/api/platform/school/schedule?"));
  expect(new URL(scheduleRequests()[0][0], "https://example.test").searchParams.get("termId")).toBe(
    "term",
  );
  await fill("授课所属学期", "future");
  expect(field("授课所属学期").value).toBe("future");
  expect(
    new URL(scheduleRequests().at(-1)![0], "https://example.test").searchParams.get("termId"),
  ).toBe("future");
});

it.each([false, true])(
  "retains a usable fallback when no current active term exists (all archived=%s)",
  async (allArchived) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-15T00:00:00Z"));
    const old = {
      ...school.terms[0],
      id: "old",
      archived: true,
      startDate: "2025-09-01",
      endDate: "2026-01-31",
    };
    const future = {
      ...old,
      id: "future",
      archived: allArchived,
      startDate: "2027-02-01",
      endDate: "2027-06-30",
    };
    school.terms = [old, future];
    await render("list");
    expect(field("授课所属学期").value).toBe(allArchived ? "old" : "future");
  },
);

it("groups published consecutive periods into one teaching session with the real publication identity", async () => {
  await render("list");
  expect(
    [...host.querySelectorAll("button")].filter(
      (button) => button.textContent === "建立本次课堂并备课",
    ),
  ).toHaveLength(1);
  await click("建立本次课堂并备课");
  expect(commands()[0]).toEqual({
    type: "teaching.session.prepare",
    termId: "term",
    slotId: "slot",
    originalDate: "2026-10-15",
    publicationId: "publication",
  });
  expect(push).toHaveBeenCalledWith("/school/teaching/session");
});
it("provides a retry for the published-term read and never prepares a cancelled course", async () => {
  api.mockRejectedValueOnce(new Error("学期读取失败"));
  await render("list");
  expect(host.textContent).toContain("学期读取失败");
  schedule.lessons.forEach((entry) => (entry.status = "CANCELLED"));
  await click("重试读取已发布学期");
  await click("建立本次课堂并备课");
  expect(commands()).toHaveLength(0);
  expect(host.textContent).toContain("本次安排已取消");
});
it("saves a structured manual plan without requiring any AI task", async () => {
  await render();
  await click("编写教案");
  await fill("教案标题", "函数教学");
  await fill("教学目标", "理解函数");
  await click("添加教学活动");
  await fill("活动 1 名称", "讨论图像");
  await fill("活动 1 教师活动", "展示图片");
  await click("添加文字材料");
  await fill("材料 1 标题", "讨论问题");
  await fill("材料 1 内容或图像说明", "图像能说明什么？");
  await click("保存教案草稿");
  expect(commands()[0]).toMatchObject({
    type: "teaching.plan.save",
    expectedVersion: 2,
    expectedPlanVersion: 0,
    expectedBindingVersion: 1,
    plan: {
      title: "函数教学",
      objectives: "理解函数",
      activities: [{ title: "讨论图像", teacherActions: "展示图片" }],
      materials: [{ kind: "TEXT", title: "讨论问题", content: "图像能说明什么？" }],
    },
  });
  expect(api.mock.calls.some(([url]) => url === "/api/platform/ai")).toBe(false);
  expect(host.textContent).toContain("确认教案 v1");
});
it("requires explicit confirmation of the saved current plan version", async () => {
  prepared();
  session.confirmedPlanVersion = null;
  await render();
  await click("确认教案 v1");
  expect(commands()[0]).toEqual({
    type: "teaching.plan.confirm",
    sessionId: "session",
    expectedVersion: 2,
    planVersion: 1,
  });
});
it("retains plan drafts after a version conflict and after a failed explicit reread", async () => {
  await render();
  await click("编写教案");
  await fill("教案标题", "保留的草稿");
  await fill("教学目标", "保留目标");
  api.mockRejectedValueOnce(new ApiRequestError("教案版本冲突", 409));
  await click("保存教案草稿");
  expect(host.textContent).toContain("不会自动重放");
  await click("保存教案草稿");
  expect(commands()).toHaveLength(1);
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  await click("放弃草稿并重新读取");
  expect(field("教案标题").value).toBe("保留的草稿");
  confirm.mockReturnValue(true);
  api.mockRejectedValueOnce(new Error("重读失败"));
  await click("放弃草稿并重新读取");
  expect(field("教案标题").value).toBe("保留的草稿");
  expect(host.textContent).toContain("重读失败");
  await click("放弃草稿并重新读取");
  expect(host.querySelector('section[id="teaching-plan"] input')).toBeNull();
});
it("freezes editing and prevents duplicate saves while the command is pending", async () => {
  prepared();
  let finish!: (value: unknown) => void;
  await render();
  await click("编辑教案草稿");
  api.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }) as never,
  );
  await click("保存教案草稿");
  expect(host.querySelector('section[id="teaching-plan"] form')!.hasAttribute("inert")).toBe(true);
  await click("正在保存…");
  expect(commands()).toHaveLength(1);
  await act(async () => finish({ id: "session", version: 3 }));
});
it("does not resend a saved plan when the post-save read failed", async () => {
  prepared();
  await render();
  await click("编辑教案草稿");
  api
    .mockResolvedValueOnce({ id: "session", version: 3 } as never)
    .mockRejectedValueOnce(new Error("刷新失败"));
  await click("保存教案草稿");
  expect(host.textContent).toContain("记录已保存");
  expect(host.textContent).not.toContain("保存教案草稿");
  await click("重新读取教学记录");
  expect(commands()).toHaveLength(1);
});
it("guards a dirty manual plan on navigation and cancellation", async () => {
  await render();
  await click("编写教案");
  await fill("教案标题", "未保存教案");
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  await click("取消编辑");
  expect(field("教案标题").value).toBe("未保存教案");
  confirm.mockReturnValue(true);
  await click("取消编辑");
  expect(host.textContent).not.toContain("保存教案草稿");
});
it("confirms the previewed roster fingerprint only after an explicit teacher check", async () => {
  await render();
  await click("核对课堂名单");
  await click("确认本次课堂名单");
  expect(commands()).toHaveLength(0);
  expect(host.querySelector('[aria-label="课堂名单核对"]')?.getAttribute("tabindex")).toBe("0");
  await check("我已核对以上名单");
  await click("确认本次课堂名单");
  expect(commands()[0]).toEqual({
    type: "teaching.roster.confirm",
    sessionId: "session",
    expectedVersion: 2,
    fingerprint: "a".repeat(64),
  });
});
it("explicitly adds and excludes members rather than silently syncing current classroom membership", async () => {
  prepared();
  roster.candidates.push({
    studentId: "new",
    name: "新同学",
    studentNumber: "1002",
    classroomId: "class",
    classroomName: "一班",
  });
  roster.removedParticipantIds = ["participant"];
  await render();
  await click("调整本次名单");
  await check("本次退出");
  await check("明确增补到本次课堂");
  await fill("课堂名单调整原因", "学生调整");
  await check("我已核对以上名单");
  await click("保存课堂名单调整");
  expect(commands()[0]).toMatchObject({
    type: "teaching.roster.update",
    fingerprint: "a".repeat(64),
    addStudentIds: ["new"],
    excludeParticipantIds: ["participant"],
    restoreParticipantIds: [],
    reason: "学生调整",
  });
});
it("reconfirms retained participants through roster update after rebinding invalidated roster confirmation", async () => {
  prepared();
  session.rosterConfirmed = false;
  await render();
  await click("核对课堂名单");
  await fill("课堂名单调整原因", "核对新安排下的原名单");
  await check("我已核对以上名单");
  await click("保存课堂名单调整");
  expect(commands()[0].type).toBe("teaching.roster.update");
});
it("leaves attendance unmarked until the teacher explicitly records it and requires exception explanations", async () => {
  prepared();
  await render();
  await click("记录课堂点名");
  expect(field("李同学的出勤状态").value).toBe("UNMARKED");
  await fill("李同学的出勤状态", "LATE");
  await click("保存课堂点名");
  expect(commands()).toHaveLength(0);
  await fill("李同学的出勤说明", "交通延误");
  await click("保存课堂点名");
  expect(commands()[0]).toEqual({
    type: "teaching.attendance.save",
    sessionId: "session",
    expectedVersion: 2,
    marks: [{ participantId: "participant", status: "LATE", reason: "交通延误" }],
  });
});
it("does not replace previously recorded exceptional attendance with the bulk present action", async () => {
  prepared();
  session.participants.push({
    ...session.participants[0],
    id: "absent",
    studentId: "other",
    name: "王同学",
    attendance: "EXCUSED",
    attendanceReason: "病假",
  });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  await render();
  await click("记录课堂点名");
  await click("将未标记成员设为到场");
  expect(field("李同学的出勤状态").value).toBe("PRESENT");
  expect(field("王同学的出勤状态").value).toBe("EXCUSED");
  expect(field("王同学的出勤说明").value).toBe("病假");
});
it("starts a prepared classroom using its captured version", async () => {
  prepared();
  await render();
  await click("开始本次授课");
  expect(commands()[0]).toEqual({
    type: "teaching.session.start",
    sessionId: "session",
    expectedVersion: 2,
  });
});
it("requires both actual progress and reflection when finishing a class", async () => {
  prepared();
  session.status = "IN_PROGRESS";
  session.canPrepare = false;
  session.canStart = false;
  session.canFinish = true;
  session.startedAt = "2026-10-15T00:00:00Z";
  await render();
  await click("结束课堂并填写反思");
  await fill("实际授课进度与总结", "已完成函数讨论");
  await click("结束课堂并保存记录");
  expect(commands()).toHaveLength(0);
  await fill("课后反思", "下次增加反例");
  await click("结束课堂并保存记录");
  expect(commands()[0]).toEqual({
    type: "teaching.session.finish",
    sessionId: "session",
    expectedVersion: 2,
    summary: "已完成函数讨论",
    reflection: "下次增加反例",
  });
});
it.each(["interrupt", "resume", "cancel"] as const)(
  "records an explicit reason for %s without overwriting lesson history",
  async (kind) => {
    prepared();
    if (kind !== "cancel") {
      session.status = kind === "interrupt" ? "IN_PROGRESS" : "INTERRUPTED";
      session.canPrepare = false;
      session.canStart = false;
    }
    const button = { interrupt: "记录课堂中断", resume: "恢复本次授课", cancel: "取消本次课堂" }[
        kind
      ],
      label = { interrupt: "课堂中断原因", resume: "恢复授课原因", cancel: "取消课堂原因" }[kind],
      submit = { interrupt: "记录中断课堂", resume: "恢复课堂", cancel: "取消本次课堂" }[kind];
    await render();
    await click(button);
    await fill(label, "学校临时安排");
    await click(submit);
    expect(commands()[0]).toEqual({
      type: `teaching.session.${kind}`,
      sessionId: "session",
      expectedVersion: 2,
      reason: "学校临时安排",
    });
  },
);
it("explicitly binds a changed schedule using canRebind even though canPrepare is false", async () => {
  prepared();
  session.scheduleChanged = true;
  session.canPrepare = false;
  session.canRebind = true;
  session.canStart = false;
  session.currentSchedule = {
    ...session.binding,
    publicationId: "publication-four",
    publicationRevision: 4,
    lessons: [{ ...lesson(), date: "2026-10-16", teacherName: "代课老师" }],
  };
  await render();
  await click("核对并接受最新安排");
  expect(host.textContent).toContain("代课老师");
  await fill("接受安排变更的原因", "核对调课");
  await click("接受最新课程安排");
  expect(commands()[0]).toEqual({
    type: "teaching.session.rebind",
    sessionId: "session",
    expectedVersion: 2,
    publicationId: "publication-four",
    reason: "核对调课",
  });
});
it("keeps a single schedule comparison region whether the rebind form is open or closed", async () => {
  prepared();
  session.scheduleChanged = true;
  session.canPrepare = false;
  session.canRebind = true;
  session.canStart = false;
  session.currentSchedule = {
    ...session.binding,
    publicationId: "publication-four",
    publicationRevision: 4,
    lessons: [{ ...lesson(), date: "2026-10-16", teacherName: "代课老师" }],
  };
  const regions = () => host.querySelectorAll('[role="region"][aria-label="原安排与最新发布安排"]');
  await render();
  expect(regions()).toHaveLength(1);
  await click("核对并接受最新安排");
  expect(regions()).toHaveLength(1);
  await click("取消编辑");
  expect(regions()).toHaveLength(1);
});
it("shows authorized history as teaching records and plan versions rather than raw JSON", async () => {
  prepared();
  await render();
  await click("读取教学历史");
  expect(host.textContent).toContain("记录 v2 · 保存教案草稿");
  expect(host.textContent).toContain("明确调整");
  expect(host.textContent).toContain("教案 v1 · 人工编写");
  expect(host.textContent).not.toContain('"confirmedPlanVersion"');
});
it("renders frozen question materials without exposing their JSON in editable textareas", async () => {
  prepared();
  session.plan!.plan.materials = [
    {
      id: "material",
      kind: "QUESTION",
      questionId: "q",
      title: "函数例题",
      content: JSON.stringify({
        source: "QUESTION_SNAPSHOT",
        questionId: "q",
        type: "SUBJECTIVE",
        subject: "数学",
        grade: "高中一年级",
        updatedAt: "2026-10-15",
        content: {
          stem: "冻结题目内容",
          options: [],
          parts: [],
          images: [],
          answers: [],
          explanation: "",
          rubric: "",
        },
      }),
    },
  ];
  await render();
  expect(host.textContent).toContain("冻结题目内容");
  await click("编辑教案草稿");
  expect(host.textContent).toContain("冻结题目内容");
  expect(
    [...host.querySelectorAll("textarea")].some((input) =>
      input.value.includes("QUESTION_SNAPSHOT"),
    ),
  ).toBe(false);
  expect(host.textContent).toContain("编辑源题不会改写");
});
it("submits AI preparation with all frozen baseline versions and keeps it unconfirmed", async () => {
  await render();
  const details = [...host.querySelectorAll("details")].find(
    (entry) => entry.querySelector("summary")?.textContent === "AI 辅助备课（选用）",
  )!;
  await act(async () => {
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
  });
  await fill("AI 备课要求（选填）", "安排一个讨论活动");
  await click("生成 AI 备课草稿");
  const request = api.mock.calls.find(([url]) => url === "/api/platform/ai")!;
  expect(JSON.parse(String(request[1]?.body))).toEqual({
    kind: "LESSON_PREPARE",
    modelId: "model",
    input: {
      sessionId: "session",
      publicationId: "publication",
      expectedVersion: 2,
      expectedPlanVersion: 0,
      expectedBindingVersion: 1,
      requirements: "安排一个讨论活动",
    },
  });
  expect(host.textContent).toContain("不会自动确认或开课");
  expect(commands()).toHaveLength(0);
});

it("renders AI preparation submit failures as error alerts while success stays a plain status notice", async () => {
  await render();
  const details = [...host.querySelectorAll("details")].find(
    (entry) => entry.querySelector("summary")?.textContent === "AI 辅助备课（选用）",
  )!;
  await act(async () => {
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
  });
  await fill("AI 备课要求（选填）", "安排一个讨论活动");
  await click("生成 AI 备课草稿");
  const success = [...host.querySelectorAll('p[role="status"]')].find((entry) =>
    entry.textContent.includes("不会自动确认或开课"),
  );
  expect(success).toBeTruthy();
  expect(success!.className).toBe("p-notice");
  const original = api.getMockImplementation()!;
  api.mockImplementation(async (url, init) => {
    if (url === "/api/platform/ai") throw new Error("AI 备课提交失败：会话已过期");
    return original(url, init);
  });
  await fill("AI 备课要求（选填）", "再次尝试");
  await click("生成 AI 备课草稿");
  const alert = [...host.querySelectorAll('p[role="alert"]')].find((entry) =>
    entry.textContent.includes("AI 备课提交失败：会话已过期"),
  );
  expect(alert).toBeTruthy();
  expect(alert!.className).toContain("p-notice error");
  expect(host.textContent).not.toContain("不会自动确认或开课");
});

it("requires a reason when correcting completed progress and reflection", async () => {
  prepared();
  session.status = "COMPLETED";
  session.canPrepare = false;
  session.canTakeAttendance = false;
  session.canStart = false;
  session.canCancel = false;
  session.canCorrect = true;
  session.summary = "原总结";
  session.reflection = "原反思";
  await render();
  await click("更正授课记录");
  await fill("实际授课进度与总结", "补全实际进度");
  await fill("课后反思", "补充观察");
  await click("保存授课记录更正");
  expect(commands()).toHaveLength(0);
  await fill("记录更正原因", "补录遗漏内容");
  await click("保存授课记录更正");
  expect(commands()[0]).toEqual({
    type: "teaching.session.correct",
    sessionId: "session",
    expectedVersion: 2,
    summary: "补全实际进度",
    reflection: "补充观察",
    reason: "补录遗漏内容",
    marks: [],
  });
});

it("corrects completed attendance with a reason and excludes withdrawn participants from the marks", async () => {
  prepared();
  session.status = "COMPLETED";
  session.canPrepare = false;
  session.canTakeAttendance = false;
  session.canStart = false;
  session.canCorrect = true;
  session.participants.push({
    ...session.participants[0],
    id: "withdrawn",
    studentId: "other",
    name: "已退出同学",
    rosterStatus: "EXCLUDED",
    rosterReason: "不参加本课",
    attendance: "PRESENT",
  });
  await render();
  await click("更正已结束课堂出勤");
  expect(
    [...host.querySelectorAll("label")].some((label) =>
      label.textContent?.includes("已退出同学的出勤"),
    ),
  ).toBe(false);
  await fill("李同学的出勤状态", "PRESENT");
  await fill("出勤更正原因", "核对点名记录");
  await click("保存出勤更正");
  expect(commands()[0]).toMatchObject({
    type: "teaching.session.correct",
    reason: "核对点名记录",
    marks: [{ participantId: "participant", status: "PRESENT" }],
  });
});

it("keeps historical teaching records readable while every mutation capability is revoked", async () => {
  prepared();
  session.canPrepare = false;
  session.canTakeAttendance = false;
  session.canStart = false;
  session.canFinish = false;
  session.canCorrect = false;
  session.canManageRoster = false;
  session.canRebind = false;
  session.canCancel = false;
  await render();
  expect(host.textContent).toContain("函数教学");
  expect(host.textContent).toContain("李同学");
  await click("编辑教案草稿");
  await click("记录课堂点名");
  await click("开始本次授课");
  expect(commands()).toHaveLength(0);
  expect(host.textContent).not.toContain("保存教案草稿");
  expect(host.textContent).not.toContain("取消本次课堂");
});

it("recovers a failed roster preview without starting a mutation or inventing a fingerprint", async () => {
  await render();
  api.mockRejectedValueOnce(new Error("候选读取失败"));
  await click("核对课堂名单");
  expect(host.textContent).toContain("候选读取失败");
  expect(host.textContent).not.toContain("确认本次课堂名单");
  await click("重新读取候选名单");
  expect(host.textContent).toContain("李同学");
  expect(commands()).toHaveLength(0);
});

it("waits for an uploaded teaching material before saving its private asset reference", async () => {
  let finish!: (value: unknown) => void;
  await render();
  await click("编写教案");
  await fill("教案标题", "图像教学");
  await fill("教学目标", "观察图像");
  api.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }) as never,
  );
  const upload = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(upload, "files", {
    value: [new File(["image"], "函数.png", { type: "image/png" })],
  });
  await act(async () => upload.dispatchEvent(new Event("change", { bubbles: true })));
  await click("保存教案草稿");
  expect(commands()).toHaveLength(0);
  expect(host.textContent).toContain("正在上传材料");
  await act(async () =>
    finish({ url: "/api/platform/assets/00000000-0000-4000-8000-000000000001" }),
  );
  await click("保存教案草稿");
  expect(commands()[0]).toMatchObject({
    plan: {
      materials: [
        {
          kind: "ASSET",
          title: "函数.png",
          url: "/api/platform/assets/00000000-0000-4000-8000-000000000001",
        },
      ],
    },
  });
});

it("keeps the manual draft when image upload fails and permits selecting a replacement", async () => {
  await render();
  await click("编写教案");
  await fill("教案标题", "保留手动备课");
  const upload = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(upload, "files", {
    configurable: true,
    value: [new File(["image"], "材料.png", { type: "image/png" })],
  });
  api.mockRejectedValueOnce(new Error("图片网络中断"));
  await act(async () => upload.dispatchEvent(new Event("change", { bubbles: true })));
  expect(host.textContent).toContain("图片网络中断");
  expect(field("教案标题").value).toBe("保留手动备课");
  expect(upload.disabled).toBe(false);
});

it("retains already loaded history when a subsequent read fails", async () => {
  prepared();
  await render();
  await click("读取教学历史");
  api.mockRejectedValueOnce(new Error("历史读取失败"));
  await click("重新读取教学历史");
  expect(host.textContent).toContain("历史读取失败");
  expect(host.textContent).toContain("记录 v2 · 保存教案草稿");
});

it("preserves unsubmitted AI requirements when the optional panel is collapsed and reopened", async () => {
  await render();
  const details = [...host.querySelectorAll("details")].find(
    (entry) => entry.querySelector("summary")?.textContent === "AI 辅助备课（选用）",
  )!;
  await act(async () => {
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
  });
  await fill("AI 备课要求（选填）", "保留讨论要求");
  await act(async () => {
    details.open = false;
    details.dispatchEvent(new Event("toggle"));
  });
  await act(async () => {
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
  });
  expect(field("AI 备课要求（选填）").value).toBe("保留讨论要求");
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
});

it.each(["start", "permission-refresh"])(
  "keeps unsubmitted AI requirements readable after %s removes preparation capability",
  async (transition) => {
    prepared();
    const original = api.getMockImplementation()!;
    api.mockImplementation(async (url, init) => {
      if (url === "/api/platform/teaching/commands") {
        const command = JSON.parse(String(init?.body)) as TeachingCommand;
        if (command.type === "teaching.session.start") {
          session.status = "IN_PROGRESS";
          session.canPrepare = false;
          session.canStart = false;
        }
      }
      return original(url, init);
    });
    await render();
    const details = [...host.querySelectorAll("details")].find(
      (entry) => entry.querySelector("summary")?.textContent === "AI 辅助备课（选用）",
    )!;
    await act(async () => {
      details.open = true;
      details.dispatchEvent(new Event("toggle"));
    });
    await fill("AI 备课要求（选填）", "尚未提交的分组讨论设计");
    if (transition === "start") await click("开始本次授课");
    else {
      session.canPrepare = false;
      await click("重新读取本次课堂");
    }
    const preserved = field("未提交的 AI 备课要求（仅本页保留）") as HTMLTextAreaElement;
    expect(preserved.value).toBe("尚未提交的分组讨论设计");
    expect(preserved.readOnly).toBe(true);
    expect(preserved.closest("[inert]")).toBeNull();
    expect(host.textContent).toContain("可复制另存");
    expect(
      [...host.querySelectorAll("button")].some(
        (button) => button.textContent === "生成 AI 备课草稿",
      ),
    ).toBe(false);
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    expect(api.mock.calls.some(([url]) => url === "/api/platform/ai")).toBe(false);
  },
);

it.each(["IMPORT", "other-session"])(
  "does not announce this classroom's plan completion when %s completes",
  async (kind) => {
    await render();
    const details = [...host.querySelectorAll("details")].find(
      (entry) => entry.querySelector("summary")?.textContent === "AI 辅助备课（选用）",
    )!;
    await act(async () => {
      details.open = true;
      details.dispatchEvent(new Event("toggle"));
    });
    await fill("AI 备课要求（选填）", "当前未提交要求");
    progress.jobs = [
      {
        id: "unrelated-job",
        kind: kind === "IMPORT" ? "IMPORT" : "LESSON_PREPARE",
        input: { sessionId: kind === "IMPORT" ? "session" : "other" },
        status: "COMPLETED",
      } as AiJobDTO,
    ];
    await act(async () => progress.completed());
    expect(host.textContent).toContain("AI 任务列表已更新");
    expect(host.textContent).not.toContain("AI 任务已完成");
    expect(host.textContent).not.toContain("核对最新草稿");
    expect(host.querySelector('a[href*="unrelated-job"]')).toBeNull();
    expect(field("AI 备课要求（选填）").value).toBe("当前未提交要求");
    expect(api.mock.calls.some(([url]) => url === "/api/platform/teaching/sessions/session")).toBe(
      false,
    );
  },
);

it("shows a completed task for this classroom while preserving the current edit and requiring explicit reread", async () => {
  await render();
  const details = [...host.querySelectorAll("details")].find(
    (entry) => entry.querySelector("summary")?.textContent === "AI 辅助备课（选用）",
  )!;
  await act(async () => {
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
  });
  await fill("AI 备课要求（选填）", "继续保留要求");
  progress.jobs = [
    {
      id: "own-job",
      kind: "LESSON_PREPARE",
      input: { sessionId: "session" },
      status: "COMPLETED",
    } as AiJobDTO,
  ];
  await act(async () => progress.completed());
  expect(host.querySelector('a[href*="own-job"]')?.textContent).toContain("已完成，待核对");
  expect(field("AI 备课要求（选填）").value).toBe("继续保留要求");
  expect(api.mock.calls.some(([url]) => url === "/api/platform/teaching/sessions/session")).toBe(
    false,
  );
});

it("preserves a frozen example's answers, explanation, rubric and mixed-part references behind a teacher disclosure", async () => {
  prepared();
  const content = {
    stem: "冻结例题",
    options: [],
    images: [],
    answers: ["冻结标准答案"],
    explanation: "冻结完整解析",
    rubric: "冻结给分依据",
    parts: [
      {
        id: "part",
        type: "SUBJECTIVE",
        score: 5,
        stem: "冻结小问",
        options: [],
        answers: ["冻结小问答案"],
        explanation: "冻结小问解析",
        rubric: "冻结小问评分",
        knowledgeTags: [],
      },
    ],
  };
  session.plan!.plan.materials = [
    {
      id: "example",
      kind: "QUESTION",
      title: "冻结例题材料",
      questionId: "old-question",
      content: JSON.stringify({
        source: "QUESTION_SNAPSHOT",
        questionId: "old-question",
        type: "MIXED",
        subject: "数学",
        grade: "高中一年级",
        updatedAt: "2026-10-15",
        content,
      }),
    },
  ];
  await render();
  const details = [...host.querySelectorAll("details")].find(
    (entry) => entry.querySelector("summary")?.textContent === "查看此材料的参考答案与解析",
  )!;
  expect(details).toBeTruthy();
  expect(details.open).toBe(false);
  expect(details.textContent).toContain("冻结标准答案");
  expect(details.textContent).toContain("冻结完整解析");
  expect(details.textContent).toContain("冻结给分依据");
  expect(details.textContent).toContain("冻结小问答案");
  expect(details.textContent).toContain("冻结小问解析");
  expect(details.textContent).toContain("冻结小问评分");
  expect(api.mock.calls.some(([url]) => url.includes("/questions"))).toBe(false);
});

it("keeps archived courses and existing classroom links readable while preventing a new classroom", async () => {
  school.terms[0].archived = true;
  await render("list");
  expect(host.textContent).toContain("不能建立新课堂");
  await click("建立本次课堂并备课");
  expect(commands()).toHaveLength(0);
  await act(async () => root.unmount());
  root = createRoot(host);
  list.sessions = [session];
  await render("list");
  expect(host.querySelector('a[href="/school/teaching/session"]')?.textContent).toBe(
    "进入课堂记录",
  );
});

it("allows explicit roster restoration when an active class has no expected members and cannot take attendance", async () => {
  prepared();
  session.status = "IN_PROGRESS";
  session.canPrepare = false;
  session.canTakeAttendance = false;
  session.canManageRoster = true;
  session.canStart = false;
  session.canFinish = false;
  session.participants[0].rosterStatus = "EXCLUDED";
  session.participants[0].rosterReason = "先前退出";
  await render();
  await click("调整本次名单");
  await check("恢复参与");
  await fill("课堂名单调整原因", "明确恢复本次授课");
  await check("我已核对以上名单");
  await click("保存课堂名单调整");
  expect(commands()[0]).toMatchObject({
    type: "teaching.roster.update",
    addStudentIds: [],
    excludeParticipantIds: [],
    restoreParticipantIds: ["participant"],
    reason: "明确恢复本次授课",
  });
});

it("names current and two historical attendance regions by their own record versions", async () => {
  prepared();
  const original = api.getMockImplementation()!;
  const earlier = structuredClone(session);
  earlier.version = 1;
  earlier.participants[0].attendance = "ABSENT";
  earlier.participants[0].attendanceReason = "原始缺勤说明";
  const corrected = structuredClone(session);
  corrected.version = 2;
  corrected.participants[0].attendance = "PRESENT";
  const history: TeachingHistory = {
    sessionId: session.id,
    events: [
      {
        id: "v2",
        version: 2,
        type: "ATTENDANCE_SAVE",
        actorName: "张老师",
        createdAt: "2026-10-15T01:00:00Z",
        reason: "更正出勤",
        snapshot: corrected,
      },
      {
        id: "v1",
        version: 1,
        type: "ATTENDANCE_SAVE",
        actorName: "张老师",
        createdAt: "2026-10-15T00:00:00Z",
        reason: "首次登记",
        snapshot: earlier,
      },
    ],
    plans: [],
    nextBeforeVersion: null,
  };
  api.mockImplementation(async (url, init) =>
    url.includes("/history?") ? (history as never) : original(url, init),
  );
  await render();
  await click("读取教学历史");
  for (const details of host.querySelectorAll("details")) {
    if (details.querySelector("summary")?.textContent === "查看此版本课堂记录") details.open = true;
  }
  const regions = [...host.querySelectorAll<HTMLElement>('[role="region"]')].filter((node) =>
    node.getAttribute("aria-label")?.includes("出勤"),
  );
  expect(regions.map((region) => region.getAttribute("aria-label"))).toEqual([
    "本次课堂已保存出勤",
    "历史记录 v2 · 已保存课堂出勤",
    "历史记录 v1 · 已保存课堂出勤",
  ]);
  expect(regions[1].textContent).toContain("到场");
  expect(regions[2].textContent).toContain("原始缺勤说明");
  expect(regions[0].tabIndex).toBe(0);
  expect(regions[1].tabIndex).toBe(0);
  expect(commands()).toEqual([]);
});
