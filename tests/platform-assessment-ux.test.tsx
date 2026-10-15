// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  AssessmentCreatePage,
  AssessmentOverviewPage,
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
