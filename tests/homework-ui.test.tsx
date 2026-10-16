// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  HomeworkAssignmentDetail,
  HomeworkIssuePreview,
  HomeworkCommand,
  HomeworkAssignments,
} from "@/contracts/homework";
import {
  HomeworkCollectionWorkspace,
  StudentHomeworkWorkspace,
} from "@/components/homework-collection/workspace";
import { PaperReading, StudentPrompt } from "@/components/homework-collection/prompt";
import { AttemptReading } from "@/components/homework-collection/history";
import { apiRequest, ApiRequestError } from "@/lib/http-client";
vi.mock("@/lib/http-client", async (original) => ({
  ...(await original<typeof import("@/lib/http-client")>()),
  apiRequest: vi.fn(),
}));
const api = vi.mocked(apiRequest);
const image = (n: number) =>
  `/api/platform/assets/00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let host: HTMLDivElement,
  root: Root,
  student: Extract<HomeworkAssignmentDetail, { view: "STUDENT" }>,
  teacher: Extract<HomeworkAssignmentDetail, { view: "TEACHER" }>,
  preview: HomeworkIssuePreview,
  issued: boolean;
function fixtures() {
  const actor = { id: "teacher", role: "TEACHER" as const, name: "张老师" };
  const paper = {
    id: "paper",
    name: "阅读作业",
    subject: "语文",
    instructions: "请读材料",
    studentImageUrls: [image(1)],
    textBlocks: [{ id: "reading", text: "第二题前共享阅读", beforeQuestionId: "item2" }],
    items: [1, 2].map((n) => ({
      id: `item${n}`,
      position: n - 1,
      section: "",
      score: 5,
      type: "SUBJECTIVE" as const,
      stem: `学生题干${n}`,
      options: [],
      parts: [],
      studentImageUrls: [],
    })),
  };
  const assignment = {
    id: "assignment",
    assessmentId: "assessment",
    name: "周末阅读",
    version: 2,
    status: "ISSUED" as const,
    issuedAt: "2026-10-15T00:00:00Z",
    dueLocal: "2026-10-18T18:00",
    dueAt: "2026-10-18T10:00:00Z",
    timezone: "Asia/Shanghai",
    allowLate: false,
    instructions: "独立完成",
    resultsPublished: false,
    rosterRevision: 3,
    currentRosterRevision: 3,
    rosterNeedsSync: false,
    papers: [paper],
    capabilities: {
      canManage: true,
      canClose: true,
      canReopen: false,
      canCancel: true,
      canSyncRoster: true,
      canViewHistory: true,
      blockReasons: [],
    },
  };
  const work = {
    id: "work",
    participantSubjectId: "subject",
    paperId: "paper",
    version: 1,
    studentId: "student",
    name: "李同学",
    studentNumber: "1001",
    classroomId: "class",
    classroomName: "一班",
    participationStatus: "REQUIRED" as const,
    participationReason: "",
    collectionStatus: "NOT_SUBMITTED" as const,
    dueAt: assignment.dueAt,
    dueLocal: assignment.dueLocal,
    deadlineOverride: null,
    overdue: false,
    currentAttempt: null,
    capabilities: {
      canSaveDraft: true,
      canSubmit: true,
      canUpload: true,
      canReturn: false,
      canExtend: true,
      canViewAttemptHistory: true,
      blockReasons: [],
    },
  };
  student = {
    view: "STUDENT",
    actor: { id: "student", role: "STUDENT", name: "李同学" },
    assignment: structuredClone(assignment),
    works: [{ ...structuredClone(work), draft: { version: 0, answers: [], updatedAt: null } }],
  };
  teacher = {
    view: "TEACHER",
    actor,
    assignment: structuredClone(assignment),
    fullPapers: [],
    works: [
      {
        ...work,
        capabilities: {
          ...work.capabilities,
          canSaveDraft: false,
          canSubmit: false,
          canUpload: false,
        },
      },
    ],
    counts: {
      required: 1,
      submitted: 0,
      notSubmitted: 1,
      returned: 0,
      late: 0,
      exempt: 0,
      absent: 0,
      withdrawn: 0,
    },
  };
  preview = {
    assessmentId: "assessment",
    name: "周末阅读",
    timezone: "Asia/Shanghai",
    rosterRevision: 3,
    rosterStatus: "CONFIRMED",
    canIssue: true,
    blockReasons: [],
    papers: [
      {
        id: "paper",
        name: "阅读作业",
        subject: "语文",
        updatedAt: "2026-10-15T00:00:00Z",
        instructions: `卷说明 ![阅读图](${image(1)})`,
        textBlocks: [
          { id: "shared", text: `阅读内容 ![共享答案图](${image(2)})`, beforeQuestionId: "item1" },
        ],
        allowedStudentImageUrls: [image(1), image(2)],
        suggestedStudentImageUrls: [image(1)],
        items: [
          {
            id: "item1",
            questionId: "question",
            position: 0,
            score: 10,
            section: "",
            snapshot: {
              id: "question",
              ownerId: "teacher",
              type: "SUBJECTIVE",
              subject: "语文",
              grade: "小学五年级",
              difficulty: 0.43,
              knowledgeTags: [],
              createdAt: "2026-10-15T00:00:00Z",
              updatedAt: "2026-10-15T00:00:00Z",
              content: {
                stem: `题干 ![解题图](${image(3)})`,
                options: [],
                answers: ["教师标准答案"],
                explanation: "教师解析",
                rubric: "教师评分依据",
                parts: [],
                images: [image(3)],
              },
            },
            allowedStudentImageUrls: [image(3)],
            suggestedStudentImageUrls: [],
          },
        ],
      },
    ],
  };
}
function commands() {
  return api.mock.calls
    .filter(([url]) => url === "/api/platform/homework/commands")
    .map(([, init]) => JSON.parse(String(init?.body)) as HomeworkCommand);
}
function teacherList(): HomeworkAssignments {
  return {
    view: "TEACHER",
    actor: teacher.actor,
    assignments: issued ? [{ ...teacher.assignment, counts: teacher.counts }] : [],
    nextBeforeId: null,
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  fixtures();
  issued = true;
  api.mockImplementation(async (url, init) => {
    if (url === "/api/platform/homework/commands") {
      const c = JSON.parse(String(init?.body)) as HomeworkCommand;
      if (c.type === "homework.issue") issued = true;
      if (c.type === "homework.draft.save") {
        student.works[0].version++;
        student.works[0].draft = {
          version: student.works[0].draft.version + 1,
          answers: c.answers,
          updatedAt: "2026-10-15T01:00:00Z",
        };
      }
      if (c.type === "homework.submit") {
        student.works[0].version++;
        student.works[0].collectionStatus = "SUBMITTED";
        student.works[0].capabilities.canSaveDraft = false;
        student.works[0].capabilities.canSubmit = false;
        student.works[0].currentAttempt = {
          id: "attempt",
          scanSubmissionId: "scan",
          sequence: 1,
          submittedAt: "2026-10-15T01:00:00Z",
          late: false,
          source: "STUDENT",
          status: "SUBMITTED",
          returnedAt: null,
          returnReason: "",
        };
      }
      return { id: "assignment", version: 2, sequence: 1 } as never;
    }
    if (url.includes("/history?"))
      return { assignmentId: "assignment", events: [], attempts: [], nextBeforeId: null } as never;
    if (url.endsWith("/preview")) return structuredClone(preview) as never;
    if (url.includes("?assessmentId=")) return structuredClone(teacherList()) as never;
    if (url === "/api/platform/homework/assignments/assignment")
      return structuredClone(student) as never;
    if (url === "/api/platform/homework/assignments")
      return {
        view: "STUDENT",
        actor: student.actor,
        assignments: [{ ...student.assignment, works: student.works }],
        nextBeforeId: null,
      } as never;
    if (url.includes("/assets")) return { id: "asset", url: image(8) } as never;
    throw new Error(`Unexpected ${url}`);
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
async function render(node: ReactNode = <StudentHomeworkWorkspace assignmentId="assignment" />) {
  await act(async () => root.render(node));
}
function button(label: string) {
  const found = [...host.querySelectorAll("button")].find((b) => b.textContent === label);
  if (!found) throw new Error(`Missing button ${label}`);
  return found;
}
async function click(label: string) {
  await act(async () => button(label).click());
}
function field(label: string) {
  const e = [...host.querySelectorAll("label")]
    .find((l) => l.querySelector("span")?.textContent === label)
    ?.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      "input,textarea,select",
    );
  if (!e) throw new Error(`Missing field ${label}`);
  return e;
}
async function fill(label: string, value: string) {
  await act(async () => {
    const e = field(label);
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e), "value")!.set!.call(e, value);
    e.dispatchEvent(new Event(e.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  });
}
async function check(text: string) {
  const input = [...host.querySelectorAll("label")]
    .find((l) => l.textContent?.includes(text))
    ?.querySelector<HTMLInputElement>('input[type="checkbox"]');
  expect(input).toBeTruthy();
  await act(async () => input!.click());
}
function teacherApi() {
  const original = api.getMockImplementation()!;
  api.mockImplementation(async (url, init) =>
    url === "/api/platform/homework/assignments/assignment"
      ? (structuredClone(teacher) as never)
      : original(url, init),
  );
}
it("loads only own safe prompt and places shared reading immediately before its question", async () => {
  await render();
  expect(host.textContent).not.toContain("教师标准答案");
  expect(host.textContent).not.toContain("教师解析");
  expect(host.querySelector('[aria-label="第 1 题题面"]')?.tagName).toBe("SECTION");
  const text = host.textContent!;
  expect(text.indexOf("学生题干1")).toBeLessThan(text.indexOf("第二题前共享阅读"));
  expect(text.indexOf("第二题前共享阅读")).toBeLessThan(text.indexOf("学生题干2"));
  expect(host.textContent).toContain("Asia/Shanghai");
});
it("requires saving edited work before submitting and preserves exact item text", async () => {
  await render();
  await fill("第 1 题我的作答", "我的完整作答");
  expect(button("确认提交本次作业").disabled).toBe(true);
  await click("保存本人作答草稿");
  expect(commands()[0]).toMatchObject({
    type: "homework.draft.save",
    expectedVersion: 1,
    expectedDraftVersion: 0,
    answers: [
      { itemId: "item1", text: "我的完整作答", images: [] },
      { itemId: "item2", text: "", images: [] },
    ],
  });
  expect((field("第 1 题我的作答") as HTMLTextAreaElement).value).toBe("我的完整作答");
  expect(button("确认提交本次作业").disabled).toBe(false);
});
it("requires explicit confirmation, sends all submit baselines and shows server receipt", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  await render();
  await click("确认提交本次作业");
  expect(commands()).toEqual([]);
  expect(confirm.mock.calls[0][0]).toContain("2 题未填写");
  confirm.mockReturnValue(true);
  await click("确认提交本次作业");
  expect(commands()[0]).toMatchObject({
    type: "homework.submit",
    expectedVersion: 1,
    expectedDraftVersion: 0,
    expectedAssignmentVersion: 2,
    expectedRosterRevision: 3,
  });
  expect(host.textContent).toContain("服务端回执：第 1 次提交");
  expect(host.querySelector("textarea")).toBeNull();
});
it("reuses the request token after uncertain transport failure without automatic retry", async () => {
  const original = api.getMockImplementation()!;
  let posts = 0;
  api.mockImplementation(async (url, init) => {
    if (url.endsWith("/commands") && ++posts === 1) throw new Error("网络中断");
    return original(url, init);
  });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  await render();
  await click("确认提交本次作业");
  expect(commands()).toHaveLength(1);
  await click("确认提交本次作业");
  expect(commands()).toHaveLength(2);
  expect(commands()[0]).toMatchObject({
    requestId: (commands()[1] as { requestId: string }).requestId,
  });
});
it("keeps edited answers on 409, refuses abandon and keeps failed reread before fresh baseline", async () => {
  const original = api.getMockImplementation()!;
  let conflict = true,
    readFail = false;
  api.mockImplementation(async (url, init) => {
    if (url.endsWith("/commands") && conflict) throw new ApiRequestError("资料版本冲突", 409);
    if (url.endsWith("/assignment") && readFail) throw new Error("重读失败");
    return original(url, init);
  });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  await render();
  await fill("第 1 题我的作答", "保留草稿");
  await click("保存本人作答草稿");
  expect((field("第 1 题我的作答") as HTMLTextAreaElement).value).toBe("保留草稿");
  await click("放弃作答并重新读取");
  expect(confirm).toHaveBeenCalled();
  confirm.mockReturnValue(true);
  readFail = true;
  await click("放弃作答并重新读取");
  expect((field("第 1 题我的作答") as HTMLTextAreaElement).value).toBe("保留草稿");
  readFail = false;
  conflict = false;
  student.works[0].version = 4;
  await click("放弃作答并重新读取");
  expect((field("第 1 题我的作答") as HTMLTextAreaElement).value).toBe("");
  await fill("第 1 题我的作答", "重新核对后作答");
  await click("保存本人作答草稿");
  expect(commands().at(-1)).toMatchObject({ expectedVersion: 4 });
});
it("blocks repeated writes when successful save cannot reload and preserves submitted answer", async () => {
  const original = api.getMockImplementation()!;
  let saved = false;
  api.mockImplementation(async (url, init) => {
    if (url.endsWith("/assignment") && saved) throw new Error("刷新失败");
    const result = await original(url, init);
    if (url.endsWith("/commands")) saved = true;
    return result;
  });
  await render();
  await fill("第 1 题我的作答", "已成功的作答");
  await click("保存本人作答草稿");
  expect(host.textContent).toContain("操作已保存，但最新资料读取失败");
  expect(button("保存本人作答草稿").disabled).toBe(true);
  expect((field("第 1 题我的作答") as HTMLTextAreaElement).value).toBe("已成功的作答");
  expect(commands()).toHaveLength(1);
});
it("retains dirty work on top refresh rejection and failed refresh", async () => {
  const original = api.getMockImplementation()!;
  let fail = false;
  api.mockImplementation(async (url, init) => {
    if (fail && url.endsWith("/assignment")) throw new Error("读取失败");
    return original(url, init);
  });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  await render();
  await fill("第 1 题我的作答", "不能丢失");
  await click("重新读取本人作业");
  expect(confirm).toHaveBeenCalled();
  expect((field("第 1 题我的作答") as HTMLTextAreaElement).value).toBe("不能丢失");
  confirm.mockReturnValue(true);
  fail = true;
  await click("重新读取本人作业");
  expect((field("第 1 题我的作答") as HTMLTextAreaElement).value).toBe("不能丢失");
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
});
it("uploads each same-question image in order, preserves failure and never saves partial set", async () => {
  const original = api.getMockImplementation()!;
  let uploads = 0;
  api.mockImplementation(async (url, init) => {
    if (url.endsWith("/assets")) {
      uploads++;
      if (uploads === 2) throw new Error("第二张失败");
      return { id: "asset", url: image(uploads === 1 ? 8 : 9) } as never;
    }
    return original(url, init);
  });
  await render();
  const input = field("第 1 题上传作答图片") as HTMLInputElement;
  await act(async () => {
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [
        new File(["a"], "first.png", { type: "image/png" }),
        new File(["b"], "second.png", { type: "image/png" }),
      ],
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(button("保存本人作答草稿").disabled).toBe(true);
  expect(host.textContent).toContain("第二张失败");
  await click("重试上传 2");
  await click("保存本人作答草稿");
  expect(commands()[0]).toMatchObject({
    answers: [
      { itemId: "item1", images: [image(8), image(9)] },
      { itemId: "item2", images: [] },
    ],
  });
});
it.each(["ABSENT", "EXEMPT", "WITHDRAWN"] as const)(
  "shows %s without editor or pretending old submissions are current homework",
  async (status) => {
    student.works[0].participationStatus = status;
    student.works[0].participationReason = "本次不应交";
    student.works[0].capabilities = {
      ...student.works[0].capabilities,
      canSaveDraft: false,
      canSubmit: false,
      canUpload: false,
      blockReasons: ["本次不应交"],
    };
    await render();
    expect(host.querySelector("textarea")).toBeNull();
    expect(host.textContent).toContain("本次不应交");
    expect(
      [...host.querySelectorAll("button")].some((b) => b.textContent === "确认提交本次作业"),
    ).toBe(false);
  },
);
it("shows returned reason and preserved draft, published feedback uses assessment ID", async () => {
  student.works[0].collectionStatus = "RETURNED";
  student.works[0].draft.answers = [{ itemId: "item1", text: "原轮次草稿", images: [] }];
  student.works[0].currentAttempt = {
    id: "attempt",
    scanSubmissionId: "scan",
    sequence: 1,
    submittedAt: "2026-10-15T01:00:00Z",
    late: true,
    source: "STUDENT",
    status: "RETURNED",
    returnedAt: "2026-10-15T02:00:00Z",
    returnReason: "请补过程",
  };
  student.assignment.resultsPublished = true;
  await render();
  expect(host.textContent).toContain("请补过程");
  expect((field("第 1 题我的作答") as HTMLTextAreaElement).value).toBe("原轮次草稿");
  expect(host.querySelector('a[href="/learning/results/assessment"]')).toBeTruthy();
});
it("lists own task IDs and retained cancelled work without exposing teacher controls", async () => {
  student.assignment.status = "CANCELLED";
  await render(<StudentHomeworkWorkspace />);
  expect(host.querySelector('a[href="/learning/homework/assignment"]')).toBeTruthy();
  expect(host.textContent).toContain("已撤回");
  expect(host.textContent).not.toContain("调整收交设置");
});
it("teacher checks correct assessment lookup, has named focusable overflow table and no drafts", async () => {
  teacherApi();
  await render(<HomeworkCollectionWorkspace assessmentId="assessment" />);
  expect(api.mock.calls[0][0]).toBe("/api/platform/homework/assignments?assessmentId=assessment");
  expect(host.querySelector('a[href="/homework/assignments/assessment/grading"]')).toBeTruthy();
  expect(host.querySelector('[aria-label="学生作业收交记录"]')?.getAttribute("tabindex")).toBe("0");
  expect(host.textContent).not.toContain("我的作答");
});
it("teacher return captures current attempt/version and requires a human reason", async () => {
  teacherApi();
  teacher.works[0].collectionStatus = "SUBMITTED";
  teacher.works[0].version = 5;
  teacher.works[0].capabilities.canReturn = true;
  teacher.works[0].currentAttempt = {
    id: "attempt",
    scanSubmissionId: "scan",
    sequence: 2,
    submittedAt: "2026-10-15T01:00:00Z",
    late: false,
    source: "STUDENT",
    status: "SUBMITTED",
    returnedAt: null,
    returnReason: "",
  };
  await render(<HomeworkCollectionWorkspace assessmentId="assessment" />);
  await click("退回修改");
  expect((field("退回修改原因") as HTMLTextAreaElement).required).toBe(true);
  await fill("退回修改原因", "请补充计算过程");
  await click("确认退回修改");
  expect(commands()[0]).toEqual({
    type: "homework.return",
    workId: "work",
    expectedVersion: 5,
    expectedAttemptId: "attempt",
    reason: "请补充计算过程",
  });
});
it("teacher sets individual extension in fixed school timezone", async () => {
  teacherApi();
  await render(<HomeworkCollectionWorkspace assessmentId="assessment" />);
  await click("个人延期");
  await fill("个人延期截止时间", "2026-10-19T20:30");
  await fill("本次操作原因", "病假延期");
  await click("保存个人延期");
  expect(commands()[0]).toEqual({
    type: "homework.deadline.extend",
    workId: "work",
    expectedVersion: 1,
    dueLocal: "2026-10-19T20:30",
    reason: "病假延期",
  });
});
it("teacher partial-scope capabilities hide management and retain allowed reading", async () => {
  teacherApi();
  teacher.assignment.capabilities = {
    canManage: false,
    canClose: false,
    canReopen: false,
    canCancel: false,
    canSyncRoster: false,
    canViewHistory: false,
    blockReasons: ["只可查看授权科目"],
  };
  teacher.works[0].capabilities.canExtend = false;
  await render(<HomeworkCollectionWorkspace assessmentId="assessment" />);
  expect(host.textContent).not.toContain("调整收交设置");
  expect(host.textContent).not.toContain("管理反馈发布");
  expect(host.textContent).toContain("只可查看授权科目");
});
it("issue starts all paper/item images unchecked and requires explicit preview confirmation", async () => {
  issued = false;
  teacherApi();
  await render(<HomeworkCollectionWorkspace assessmentId="assessment" />);
  expect(
    [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].every((i) => !i.checked),
  ).toBe(true);
  expect(field("学校时区").value).toBe("Asia/Shanghai");
  expect(button("确认发放学生作业").disabled).toBe(true);
  expect(host.textContent).toContain("共享答案图（未向学生开放）");
  await fill("作业截止日期与时间", "2026-10-18T19:00");
  await check("向学生开放共享图 1");
  await check("向学生开放图 1");
  await check("我已逐题预览学生题面");
  await click("确认发放学生作业");
  expect(commands()[0]).toMatchObject({
    type: "homework.issue",
    assessmentId: "assessment",
    expectedRosterRevision: 3,
    timezone: "Asia/Shanghai",
    expectedPapers: [
      {
        paperId: "paper",
        studentImageUrls: [image(1)],
        items: [{ itemId: "item1", studentImageUrls: [image(3)] }],
      },
    ],
  });
});
it("changing media choices invalidates previous issue confirmation", async () => {
  issued = false;
  await render(<HomeworkCollectionWorkspace assessmentId="assessment" />);
  await check("我已逐题预览学生题面");
  expect(button("确认发放学生作业").disabled).toBe(false);
  await check("向学生开放共享图 1");
  expect(button("确认发放学生作业").disabled).toBe(true);
});
it("history uses scoped work request and allows reading all submitted images", async () => {
  const original = api.getMockImplementation()!;
  api.mockImplementation(async (url, init) =>
    url.includes("/history?")
      ? ({
          assignmentId: "assignment",
          events: [
            {
              id: "event",
              assignmentId: "assignment",
              workId: "work",
              type: "homework.submit",
              actorId: "student",
              actorName: "李同学",
              createdAt: "2026-10-15T01:00:00Z",
              reason: "",
              changes: ["已提交第1轮"],
            },
          ],
          attempts: [
            {
              id: "attempt",
              workId: "work",
              scanSubmissionId: "scan",
              sequence: 1,
              submittedAt: "2026-10-15T01:00:00Z",
              late: false,
              source: "STUDENT",
              status: "SUBMITTED",
              returnedAt: null,
              returnReason: "",
              paperId: "paper",
              paperName: "阅读作业",
              answers: [
                {
                  itemId: "item1",
                  questionNumber: 1,
                  submitted: true,
                  text: "历史作答",
                  images: [image(8), image(9)],
                },
              ],
            },
          ],
          nextBeforeId: null,
        } as never)
      : original(url, init),
  );
  await render();
  await click("读取作业历史");
  expect(api.mock.calls.some(([url]) => url.includes("history?limit=20&workId=work"))).toBe(true);
  expect(host.textContent).toContain("历史作答");
  expect(host.querySelector(`a[href="${image(8)}"]`)).toBeTruthy();
  expect(host.querySelector(`a[href="${image(9)}"]`)).toBeTruthy();
});
it.each(["CANCELLED", "EXEMPT", "WITHDRAWN"] as const)(
  "keeps own receipt/history without restored prompt after %s",
  async (status) => {
    student.assignment.papers = [];
    if (status === "CANCELLED") student.assignment.status = status;
    else student.works[0].participationStatus = status;
    student.works[0].participationReason = "名单变更保留记录";
    student.works[0].capabilities = {
      ...student.works[0].capabilities,
      canSaveDraft: false,
      canSubmit: false,
      canUpload: false,
    };
    student.works[0].currentAttempt = {
      id: "attempt",
      scanSubmissionId: "scan",
      sequence: 2,
      submittedAt: "2026-10-15T01:00:00Z",
      late: false,
      source: "STUDENT",
      status: "RETURNED",
      returnedAt: "2026-10-15T02:00:00Z",
      returnReason: "此前请补过程",
    };
    await render();
    expect(host.textContent).toContain("历史回执：第 2 次提交");
    expect(host.textContent).toContain("名单变更保留记录");
    expect(host.textContent).toContain("此前请补过程");
    expect(host.textContent).not.toContain("学生题干1");
    expect(host.querySelector("textarea")).toBeNull();
    await click("读取作业历史");
    expect(api.mock.calls.some(([url]) => url.includes("history?limit=20&workId=work"))).toBe(true);
  },
);
it("keeps a dirty first subject when rejecting switch then loads second cleanly", async () => {
  const paper = structuredClone(student.assignment.papers[0]);
  paper.id = "paper2";
  paper.name = "第二科";
  student.assignment.papers.push(paper);
  const work = structuredClone(student.works[0]);
  work.id = "work2";
  work.paperId = "paper2";
  student.works.push(work);
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  await render();
  await fill("第 1 题我的作答", "不能被换科丢弃");
  await fill("选择本次作业科目", "work2");
  expect(confirm).toHaveBeenCalled();
  expect(field("选择本次作业科目").value).toBe("work");
  expect(field("第 1 题我的作答").value).toBe("不能被换科丢弃");
  confirm.mockReturnValue(true);
  await fill("选择本次作业科目", "work2");
  expect(field("第 1 题我的作答").value).toBe("");
});
it("freezes editor while a save request is pending and prevents duplicate writes", async () => {
  const original = api.getMockImplementation()!;
  let resolve!: () => void;
  const deferred = new Promise<void>((r) => {
    resolve = r;
  });
  api.mockImplementation(async (url, init) => {
    if (url.endsWith("/commands")) await deferred;
    return original(url, init);
  });
  await render();
  await fill("第 1 题我的作答", "请求中保留");
  await click("保存本人作答草稿");
  expect(host.querySelector("fieldset")?.disabled).toBe(true);
  expect(host.querySelector("form")?.hasAttribute("inert")).toBe(false);
  expect(field("第 1 题我的作答").matches(":disabled")).toBe(true);
  expect(button("正在保存…").disabled).toBe(true);
  await act(async () => {
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(commands()).toHaveLength(1);
  await act(async () => resolve());
  expect(field("第 1 题我的作答").value).toBe("请求中保留");
});
it("filters on the server beyond the loaded first page and retains filter on older pages", async () => {
  const original = api.getMockImplementation()!;
  const closed = {
    ...structuredClone(student.assignment),
    id: "closed",
    name: "只在第二页的关闭作业",
    status: "CLOSED" as const,
    works: student.works,
  };
  api.mockImplementation(async (url, init) => {
    if (url === "/api/platform/homework/assignments?status=CLOSED")
      return {
        view: "STUDENT",
        actor: student.actor,
        assignments: [closed],
        nextBeforeId: "closed",
      } as never;
    if (url.includes("beforeId=closed"))
      return {
        view: "STUDENT",
        actor: student.actor,
        assignments: [],
        nextBeforeId: null,
      } as never;
    return original(url, init);
  });
  await render(<StudentHomeworkWorkspace />);
  await fill("筛选作业状态", "CLOSED");
  expect(host.textContent).toContain("只在第二页的关闭作业");
  expect(host.textContent).not.toContain("当前筛选下暂无作业");
  await click("读取更早作业");
  expect(api.mock.calls.some(([url]) => url.includes("beforeId=closed&status=CLOSED"))).toBe(true);
});
it("ignores a slow old filter response after the teacher switches filter", async () => {
  const original = api.getMockImplementation()!;
  let resolve!: (value: HomeworkAssignments) => void;
  const waiting = new Promise<HomeworkAssignments>((r) => {
    resolve = r;
  });
  api.mockImplementation(async (url, init) => {
    if (url.endsWith("?status=CLOSED")) return (await waiting) as never;
    if (url.endsWith("?status=CANCELLED"))
      return {
        view: "STUDENT",
        actor: student.actor,
        assignments: [
          {
            ...student.assignment,
            id: "cancelled",
            name: "撤回记录",
            status: "CANCELLED",
            works: student.works,
          },
        ],
        nextBeforeId: null,
      } as never;
    return original(url, init);
  });
  await render(<StudentHomeworkWorkspace />);
  await fill("筛选作业状态", "CLOSED");
  await fill("筛选作业状态", "CANCELLED");
  await act(async () =>
    resolve({
      view: "STUDENT",
      actor: student.actor,
      assignments: [
        {
          ...student.assignment,
          id: "lateclosed",
          name: "旧慢关闭记录",
          status: "CLOSED",
          works: student.works,
        },
      ],
      nextBeforeId: null,
    }),
  );
  expect(host.textContent).toContain("撤回记录");
  expect(host.textContent).not.toContain("旧慢关闭记录");
  expect(field("筛选作业状态").value).toBe("CANCELLED");
});
it("keeps the chosen status filter across a homework list reread", async () => {
  const original = api.getMockImplementation()!;
  const closed = {
    ...structuredClone(student.assignment),
    id: "closed",
    name: "只在筛选下出现的关闭作业",
    status: "CLOSED" as const,
    works: student.works,
  };
  api.mockImplementation(async (url, init) => {
    if (url === "/api/platform/homework/assignments?status=CLOSED")
      return {
        view: "STUDENT",
        actor: student.actor,
        assignments: [closed],
        nextBeforeId: null,
      } as never;
    return original(url, init);
  });
  await render(<StudentHomeworkWorkspace />);
  await fill("筛选作业状态", "CLOSED");
  expect(host.textContent).toContain("只在筛选下出现的关闭作业");
  await click("重新读取我的作业列表");
  expect(field("筛选作业状态").value).toBe("CLOSED");
  expect(host.textContent).toContain("只在筛选下出现的关闭作业");
  expect(host.textContent).not.toContain("周末阅读");
  expect(
    api.mock.calls.filter(([url]) => url === "/api/platform/homework/assignments?status=CLOSED")
      .length,
  ).toBeGreaterThanOrEqual(2);
});
it("uses readonly school timezone and full preview preserves second-question reading position", async () => {
  issued = false;
  const second = structuredClone(preview.papers[0].items[0]);
  second.id = "item2";
  second.position = 1;
  second.snapshot.content.stem = "第二题";
  preview.papers[0].items[0].snapshot.content.stem = "第一题";
  preview.papers[0].items.push(second);
  preview.papers[0].textBlocks = [
    { id: "shared", text: "真正第二题前材料", beforeQuestionId: "item2" },
  ];
  await render(<HomeworkCollectionWorkspace assessmentId="assessment" />);
  expect((field("学校时区") as HTMLInputElement).readOnly).toBe(true);
  const text = host.querySelector('[aria-label$="完整学生题面预览"]')!.textContent!;
  expect(text.indexOf("第一题")).toBeLessThan(text.indexOf("真正第二题前材料"));
  expect(text.indexOf("真正第二题前材料")).toBeLessThan(text.indexOf("第二题"));
});

it("shows a saved draft version without inventing a missing legacy save time", async () => {
  student.works[0].draft = {
    version: 3,
    answers: [{ itemId: "item1", text: "已保存旧草稿", images: [] }],
    updatedAt: null,
  };
  await render();
  expect(field("第 1 题我的作答").value).toBe("已保存旧草稿");
  const saved = [...host.querySelectorAll('[role="status"]')].find((element) =>
    element.textContent?.startsWith("草稿已保存"),
  );
  expect(saved?.textContent).toBe("草稿已保存 · v3");
  expect(host.textContent).not.toContain("尚无已保存草稿");
});

it("uniquely names simultaneous shared, question and both submitted-image regions", async () => {
  const paper = student.assignment.papers[0];
  paper.items[0].studentImageUrls = [image(3)];
  paper.items[1].studentImageUrls = [image(4)];
  const attempt = {
    id: "attempt1",
    workId: "work",
    scanSubmissionId: "scan",
    sequence: 1,
    submittedAt: "2026-10-15T01:00:00Z",
    late: false,
    source: "STUDENT" as const,
    status: "SUBMITTED" as const,
    returnedAt: null,
    returnReason: "",
    paperId: "paper",
    paperName: "阅读作业",
    answers: [
      { itemId: "item1", questionNumber: 1, submitted: true, text: "首次作答", images: [image(8)] },
    ],
  };
  await render(
    <>
      <PaperReading paper={paper} />
      {paper.items.map((item, index) => (
        <StudentPrompt key={item.id} item={item} index={index} />
      ))}
      <AttemptReading attempt={attempt} />
      <AttemptReading
        attempt={{
          ...attempt,
          id: "attempt2",
          sequence: 2,
          answers: [
            {
              itemId: "item1",
              questionNumber: 1,
              submitted: true,
              text: "第二次作答",
              images: [image(9)],
            },
          ],
        }}
      />
    </>,
  );
  const names = [...host.querySelectorAll("section[aria-label]")].map((section) =>
    section.getAttribute("aria-label"),
  );
  expect(new Set(names).size).toBe(names.length);
  expect(names).toContain("阅读作业纸级共享图像材料");
  expect(names).toContain("第 1 题题面图像材料");
  expect(names).toContain("第 2 题题面图像材料");
  expect(names).toContain("第 1 次提交第 1 题作答图像材料");
  expect(names).toContain("第 2 次提交第 1 题作答图像材料");
});
it("uses frozen question numbers and explicitly identifies an omitted answer in submitted history", async () => {
  await render(
    <AttemptReading
      attempt={{
        id: "attempt",
        workId: "work",
        scanSubmissionId: "scan",
        sequence: 1,
        submittedAt: "2026-10-15T01:00:00Z",
        late: false,
        source: "STUDENT",
        status: "RETURNED",
        returnedAt: "2026-10-15T02:00:00Z",
        returnReason: "补全第一题",
        paperId: "paper",
        paperName: "原始发放卷",
        answers: [
          { itemId: "item1", questionNumber: 1, submitted: false, text: "", images: [] },
          {
            itemId: "item2",
            questionNumber: 2,
            submitted: true,
            text: "只有第二题的原始作答",
            images: [image(9)],
          },
        ],
      }}
    />,
  );
  expect(host.textContent).toContain("试卷：原始发放卷");
  const questions = host.querySelectorAll("strong");
  expect(questions[0].textContent).toBe("提交记录第 1 题作答");
  expect(questions[0].parentElement?.textContent).toContain("本次未提交本题作答");
  expect(questions[1].textContent).toBe("提交记录第 2 题作答");
  expect(questions[1].parentElement?.textContent).toContain("只有第二题的原始作答");
  expect(host.querySelector('[aria-label="第 1 次提交第 2 题作答图像材料"]')).not.toBeNull();
});

it("uniquely names all regions when both same-name paper previews are expanded", async () => {
  issued = false;
  const second = structuredClone(preview.papers[0]);
  second.id = "paper2";
  preview.papers.push(second);
  await render(<HomeworkCollectionWorkspace assessmentId="assessment" />);
  for (const details of host.querySelectorAll("details")) details.open = true;
  const names = [...host.querySelectorAll("section[aria-label]")].map((section) =>
    section.getAttribute("aria-label"),
  );
  expect(names.filter((name) => name?.endsWith("完整学生题面预览"))).toHaveLength(2);
  expect(names.filter((name) => name?.endsWith("作业说明与共享材料"))).toHaveLength(2);
  expect(new Set(names).size).toBe(names.length);
});

it("uniquely names history images for cross-class students sharing a name and student number", async () => {
  teacherApi();
  const second = structuredClone(teacher.works[0]);
  second.id = "work2";
  second.classroomId = "class2";
  second.classroomName = "二班";
  teacher.works.push(second);
  const original = api.getMockImplementation()!;
  api.mockImplementation(async (url, init) => {
    if (url.includes("/history?")) {
      const workId = new URL(url, "https://school.test").searchParams.get("workId")!;
      return {
        assignmentId: "assignment",
        events: [],
        attempts: [
          {
            id: `${workId}-attempt`,
            workId,
            scanSubmissionId: "scan",
            sequence: 1,
            submittedAt: "2026-10-15T01:00:00Z",
            late: false,
            source: "STUDENT",
            status: "SUBMITTED",
            returnedAt: null,
            returnReason: "",
            paperId: "paper",
            paperName: "阅读作业",
            answers: [
              {
                itemId: "item1",
                questionNumber: 1,
                submitted: true,
                text: "同名同学号作答",
                images: [image(8)],
              },
            ],
          },
        ],
        nextBeforeId: null,
      } as never;
    }
    return original(url, init);
  });
  await render(<HomeworkCollectionWorkspace assessmentId="assessment" />);
  const region = host.querySelector('[aria-label="学生作业收交记录"]')!;
  for (const read of region.querySelectorAll<HTMLButtonElement>("button")) {
    if (read.textContent === "读取作业历史") await act(async () => read.click());
  }
  for (const details of region.querySelectorAll("details")) details.open = true;
  const names = [...region.querySelectorAll("section[aria-label]")].map((section) =>
    section.getAttribute("aria-label"),
  );
  expect(names).toHaveLength(2);
  expect(names[0]).toContain("一班李同学（1001）");
  expect(names[1]).toContain("二班李同学（1001）");
  expect(new Set(names).size).toBe(names.length);
});
