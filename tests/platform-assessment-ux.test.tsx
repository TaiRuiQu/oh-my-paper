// @vitest-environment jsdom
import { act, createElement } from "react";
import { confirmedRoster } from "./assessment-roster-fixture";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  AssessmentCreatePage,
  AssessmentOverviewPage,
  AssessmentPublishPage,
} from "@/components/platform/assessment-pages";
import { AssessmentEditor } from "@/components/platform/assessments";
import type { Assessment, PlatformState } from "@/contracts/platform";

const domain = vi.hoisted(() => ({
  state: {} as PlatformState,
  area: "exams",
  pending: false,
  mutate: vi.fn(),
  push: vi.fn(),
}));
vi.mock("@/components/platform/domain-provider", () => ({ useDomain: () => domain }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: domain.push }) }));
const assessment: Assessment = {
  canManage: true,
  rosterRevision: 1,
  rosterStatus: "CONFIRMED",
  participants: [],
  id: "exam",
  ownerId: "teacher",
  name: "期中考试",
  kind: "EXAM",
  reviewScope: "CLASSROOM",
  classroomIds: ["class"],
  papers: [
    {
      paperId: "paper",
      subject: "数学",
      gradingMode: "SINGLE",
      arbitrationThreshold: 2,
      conversion: { enabled: false, bands: [] },
    },
  ],
  published: false,
  createdAt: "",
};
function initialState(): PlatformState {
  return {
    actor: { id: "teacher", role: "TEACHER", name: "教师" },
    questions: [],
    papers: [
      {
        id: "paper",
        ownerId: "teacher",
        name: "数学试卷",
        kind: "EXAM",
        subject: "数学",
        grade: "高一",
        instructions: "",
        layout: { paperSize: "A4", columns: 1 },
        items: [],
        createdAt: "",
        updatedAt: "",
      },
    ],
    classrooms: [
      {
        id: "class",
        ownerId: "teacher",
        name: "一班",
        stage: "高中",
        cohort: "2027届",
        students: [],
      },
    ],
    assessments: [assessment],
    submissions: [],
    reviews: [],
    templates: [],
    users: [],
    analytics: { results: [], students: [], knowledge: [], classrooms: [] },
  };
}
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  domain.state = initialState();
  domain.area = "exams";
  domain.mutate.mockReset().mockResolvedValue({ id: "new-assessment" });
  domain.push.mockReset();
  window.history.replaceState(null, "", "/exams/new");
  vi.spyOn(window, "confirm").mockReturnValue(false);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});
async function renderEditor(close = vi.fn()) {
  await act(async () =>
    root.render(
      createElement(AssessmentEditor, {
        assessment,
        state: domain.state,
        mutate: domain.mutate,
        pending: false,
        close,
      }),
    ),
  );
  return close;
}
async function rename(value = "修改后的安排") {
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>('input[name="name"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function click(text: string) {
  const button = [...container.querySelectorAll("button")].find((b) => b.textContent === text)!;
  await act(async () => button.click());
}
async function submit() {
  await act(async () => {
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
it("retains changed arrangements when cancel and close are rejected, then allows confirmed discard", async () => {
  const close = await renderEditor();
  await rename();
  await click("取消");
  expect(close).not.toHaveBeenCalled();
  expect(window.confirm).toHaveBeenLastCalledWith(
    expect.stringContaining("未保存的考试或作业安排"),
  );
  expect(container.querySelector<HTMLInputElement>('input[name="name"]')!.value).toBe(
    "修改后的安排",
  );
  await click("关闭编辑");
  expect(close).not.toHaveBeenCalled();
  vi.mocked(window.confirm).mockReturnValue(true);
  await click("取消");
  expect(close).toHaveBeenCalledOnce();
});
it("does not warn after a change is restored, and protects navigation links while dirty", async () => {
  const close = await renderEditor();
  await rename();
  const link = document.createElement("a");
  link.href = "/workspace/classes";
  document.body.append(link);
  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  await act(async () => {
    link.dispatchEvent(event);
  });
  expect(event.defaultPrevented).toBe(true);
  link.remove();
  await rename(assessment.name);
  vi.mocked(window.confirm).mockClear();
  await click("取消");
  expect(window.confirm).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledOnce();
});
it.each(["exams", "homework"])(
  "saves %s once and navigates only to its new progress page",
  async (area) => {
    domain.area = area;
    if (area === "homework") domain.state.papers[0].kind = "HOMEWORK";
    await act(async () => root.render(createElement(AssessmentCreatePage, { paperId: "paper" })));
    await rename();
    await act(async () =>
      container.querySelector<HTMLInputElement>('input[name="classroomIds"]')!.click(),
    );
    await submit();
    expect(domain.mutate).toHaveBeenCalledOnce();
    expect(domain.push).toHaveBeenCalledExactlyOnceWith(
      area === "exams" ? "/exams/new-assessment" : "/homework/assignments/new-assessment",
    );
    expect(window.confirm).not.toHaveBeenCalled();
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
    // A slow destination must not let the already saved create form post again.
    await submit();
    expect(domain.mutate).toHaveBeenCalledOnce();
    expect(domain.push).toHaveBeenCalledOnce();
  },
);
it("retains the draft and its leave warning when saving fails", async () => {
  const close = await renderEditor();
  domain.mutate.mockResolvedValue({ error: "暂时无法保存" });
  await rename();
  await submit();
  expect(close).not.toHaveBeenCalled();
  await click("取消");
  expect(window.confirm).toHaveBeenCalledOnce();
  expect(close).not.toHaveBeenCalled();
});
it("locks existing submissions before editing, links to rename, and rejects accidental submissions", async () => {
  domain.state.submissions = [
    {
      id: "submission",
      ownerId: "teacher",
      assessmentId: "exam",
      paperId: "paper",
      studentId: "student",
      templateId: null,
      kind: "CARD",
      status: "PENDING",
      sourceFiles: [],
      answers: [],
      alignment: null,
      createdAt: "",
    },
  ];
  await act(async () => root.render(createElement(AssessmentCreatePage, { id: "exam" })));
  expect(container.querySelector('[role="status"]')?.textContent).toContain("已有学生答卷");
  expect(container.querySelector('[role="status"] a')?.getAttribute("href")).toBe("/exams/exam");
  expect(container.querySelector("fieldset")?.disabled).toBe(true);
  expect([...container.querySelectorAll("button")].some((b) => b.textContent === "保存安排")).toBe(
    false,
  );
  await submit();
  expect(domain.mutate).not.toHaveBeenCalled();
  await act(async () => root.render(createElement(AssessmentOverviewPage, { id: "exam" })));
  expect(
    [...container.querySelectorAll("a")]
      .find((a) => a.textContent === "查看安排")
      ?.getAttribute("href"),
  ).toBe("/exams/exam/settings");
});
it("ignores repeated submits while the first save is pending", async () => {
  let finish!: (value: { id: string }) => void;
  domain.mutate.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await renderEditor();
  await rename();
  await submit();
  await submit();
  expect(domain.mutate).toHaveBeenCalledOnce();
  expect(container.querySelector("fieldset")?.disabled).toBe(true);
  await act(async () => finish({ id: "exam" }));
});
it("prevents duplicate subjects before configuration and supports replacing the selected paper", async () => {
  domain.state.papers.push(
    { ...domain.state.papers[0], id: "math-replacement", name: "另一份数学试卷" },
    { ...domain.state.papers[0], id: "english", name: "英语试卷", subject: "英语" },
  );
  const student = {
    id: "student",
    classroomId: "class",
    userId: null,
    name: "学生",
    studentNumber: "000001",
  };
  domain.state.classrooms[0].students = [student];
  const editing = {
    ...assessment,
    ...confirmedRoster(assessment, domain.state.classrooms),
  };
  await act(async () =>
    root.render(
      createElement(AssessmentEditor, {
        assessment: editing,
        state: domain.state,
        mutate: domain.mutate,
        pending: false,
        close: vi.fn(),
      }),
    ),
  );
  const picker = [...container.querySelectorAll("select")].find((select) =>
    [...select.options].some((option) => option.value === "math-replacement"),
  )!;
  expect(
    picker.querySelector<HTMLOptionElement>('option[value="math-replacement"]')!.disabled,
  ).toBe(true);
  expect(picker.querySelector<HTMLOptionElement>('option[value="english"]')!.disabled).toBe(false);
  expect(container.textContent).toContain("如需更换，请先移除");
  // Even a dispatched change cannot append a second paper for the same subject.
  await act(async () => {
    picker.value = "math-replacement";
    picker.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(container.querySelectorAll("section.p-part")).toHaveLength(1);
  await click("移除");
  expect(
    picker.querySelector<HTMLOptionElement>('option[value="math-replacement"]')!.disabled,
  ).toBe(false);
  await act(async () => {
    picker.value = "math-replacement";
    picker.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const reason = [...container.querySelectorAll("textarea")].find((node) =>
    node.closest("label")?.textContent?.includes("调整原因"),
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      reason,
      "更换数学试卷",
    );
    reason.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await submit();
  await submit();
  expect(
    domain.mutate.mock.calls[0][0].assessment.papers.map(
      (paper: { paperId: string }) => paper.paperId,
    ),
  ).toEqual(["math-replacement"]);
});
it.each([
  ["TEACHER", "teacher", true],
  ["TEACHER", "subject-teacher", false],
  ["ADMIN", "admin", true],
] as const)("shows publication controls only to authorized %s %s", async (role, id, allowed) => {
  domain.state.actor = { id, role, name: "验收教师" };
  domain.state.assessments = [{ ...assessment, published: true, canManage: allowed }];
  await act(async () => root.render(createElement(AssessmentPublishPage, { id: "exam" })));
  const action = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "撤回成绩发布",
  );
  expect(Boolean(action)).toBe(allowed);
  if (allowed) {
    await act(async () => action!.click());
    expect(domain.mutate).not.toHaveBeenCalled();
    expect(window.confirm).toHaveBeenLastCalledWith(expect.stringContaining("撤回"));
    vi.mocked(window.confirm).mockReturnValue(true);
    await act(async () => action!.click());
    expect(domain.mutate).toHaveBeenCalledOnce();
    expect(domain.mutate).toHaveBeenCalledWith({
      type: "assessment.publish",
      id: "exam",
      published: false,
    });
  } else {
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "请联系安排创建者或管理员",
    );
    expect(domain.mutate).not.toHaveBeenCalled();
  }
});
it("publishes only after confirming the affected scope, and keeps withdraw reversible", async () => {
  domain.state.classrooms[0].students = [
    { id: "s1", classroomId: "class", userId: null, name: "学生甲", studentNumber: "000001" },
    { id: "s2", classroomId: "class", userId: null, name: "学生乙", studentNumber: "000002" },
  ];
  const published = {
    ...assessment,
    papers: [
      ...assessment.papers,
      { ...assessment.papers[0], paperId: "english", subject: "英语" },
    ],
  };
  domain.state.assessments = [
    {
      ...published,
      ...confirmedRoster(published, domain.state.classrooms),
    },
  ];
  domain.state.analytics.results = domain.state.assessments[0].participants.map((participant) => ({
    assessmentId: "exam",
    studentId: participant.studentId,
    studentName: participant.name,
    studentNumber: participant.studentNumber,
    classroomId: participant.classroomId,
    classroomName: participant.classroomName,
    total: 180,
    rank: 1,
    classRank: 1,
    subjects: published.papers.map((paper) => ({
      participationStatus: "REQUIRED",
      participationReason: "",
      paperId: paper.paperId,
      subject: paper.subject,
      rawScore: 90,
      score: 90,
      maxScore: 100,
      rank: 1,
      grades: [],
    })),
  }));
  await act(async () => root.render(createElement(AssessmentPublishPage, { id: "exam" })));
  const button = [...container.querySelectorAll("button")].find(
    (node) => node.textContent === "发布成绩与学习反馈",
  )!;
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
  expect(domain.mutate).not.toHaveBeenCalled();
  expect(window.confirm).toHaveBeenLastCalledWith(
    expect.stringContaining("2 位学生、2 个科目（数学、英语）"),
  );
  expect(window.confirm).toHaveBeenLastCalledWith(
    expect.stringContaining("发布后这些学生可查看本人成绩、错题与学习反馈。确定发布？"),
  );
  vi.mocked(window.confirm).mockReturnValue(true);
  await act(async () => button.click());
  expect(domain.mutate).toHaveBeenCalledOnce();
  expect(domain.mutate).toHaveBeenCalledWith({
    type: "assessment.publish",
    id: "exam",
    published: true,
  });
  domain.mutate.mockReset().mockResolvedValue({ id: "exam" });
  domain.state.assessments = [{ ...domain.state.assessments[0], published: true }];
  await act(async () => root.render(createElement(AssessmentPublishPage, { id: "exam" })));
  const withdraw = [...container.querySelectorAll("button")].find(
    (node) => node.textContent === "撤回成绩发布",
  )!;
  vi.mocked(window.confirm).mockReturnValue(false);
  await act(async () => withdraw.click());
  expect(domain.mutate).not.toHaveBeenCalled();
  expect(window.confirm).toHaveBeenLastCalledWith(expect.stringContaining("2 位学生、2 个科目"));
  expect(window.confirm).toHaveBeenLastCalledWith(
    expect.stringContaining("学生端立即不可见本次成绩与学习反馈"),
  );
  expect(window.confirm).toHaveBeenLastCalledWith(
    expect.stringContaining("已生成的成绩与反馈数据会保留"),
  );
  vi.mocked(window.confirm).mockReturnValue(true);
  await act(async () => withdraw.click());
  expect(domain.mutate).toHaveBeenCalledOnce();
  expect(domain.mutate).toHaveBeenCalledWith({
    type: "assessment.publish",
    id: "exam",
    published: false,
  });
});
it("gives each double-review rules table a named focusable region with unique labels", async () => {
  const twoPapers = {
    ...assessment,
    papers: [
      ...assessment.papers,
      { ...assessment.papers[0], paperId: "english", subject: "英语" },
    ],
  };
  domain.state.papers.push({
    ...domain.state.papers[0],
    id: "english",
    name: "英语试卷",
    subject: "英语",
  });
  await act(async () =>
    root.render(
      createElement(AssessmentEditor, {
        assessment: twoPapers,
        state: domain.state,
        mutate: domain.mutate,
        pending: false,
        close: vi.fn(),
      }),
    ),
  );
  for (const subject of ["数学", "英语"]) {
    const region = container.querySelector<HTMLDivElement>(`[aria-label="${subject}逐题双评规则"]`);
    expect(region).not.toBeNull();
    expect(region!.className).toContain("p-table");
    expect(region!.getAttribute("role")).toBe("region");
    expect(region!.getAttribute("tabindex")).toBe("0");
  }
  const labels = [...container.querySelectorAll('[role="region"]')].map((node) =>
    node.getAttribute("aria-label"),
  );
  expect(new Set(labels).size).toBe(labels.length);
});
it("keeps the publish button disabled while a mutation is pending", async () => {
  domain.pending = true;
  domain.state.classrooms[0].students = [
    { id: "s1", classroomId: "class", userId: null, name: "学生甲", studentNumber: "000001" },
  ];
  const withRoster = { ...assessment, ...confirmedRoster(assessment, domain.state.classrooms) };
  domain.state.assessments = [withRoster];
  domain.state.analytics.results = withRoster.participants.map((participant) => ({
    assessmentId: "exam",
    studentId: participant.studentId,
    studentName: participant.name,
    studentNumber: participant.studentNumber,
    classroomId: participant.classroomId,
    classroomName: participant.classroomName,
    total: 90,
    rank: 1,
    classRank: 1,
    subjects: [
      {
        participationStatus: "REQUIRED",
        participationReason: "",
        paperId: "paper",
        subject: "数学",
        rawScore: 90,
        score: 90,
        maxScore: 100,
        rank: 1,
        grades: [],
      },
    ],
  }));
  await act(async () => root.render(createElement(AssessmentPublishPage, { id: "exam" })));
  const button = [...container.querySelectorAll("button")].find(
    (node) => node.textContent === "正在更新…",
  )!;
  expect(button.disabled).toBe(true);
  await act(async () => button.click());
  expect(window.confirm).not.toHaveBeenCalled();
  expect(domain.mutate).not.toHaveBeenCalled();
  domain.pending = false;
});
