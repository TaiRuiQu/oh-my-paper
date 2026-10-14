// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { GradingManager } from "@/components/grading-manager";
import { WorkflowResult } from "@/components/workflow-result";
import { WorkspaceShell } from "@/components/workspace-shell";
import type { GradingWorkflow } from "@/contracts/workflows";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/grading",
}));
vi.mock("@/components/sign-out-button", () => ({
  SignOutButton: () => createElement("button", null, "退出"),
}));
const source = {
  id: "source",
  name: "试卷A",
  status: "COMPLETED" as const,
  createdAt: "2026-10-12T00:00:00Z",
  error: null,
};
const flow: GradingWorkflow = {
  id: "flow",
  kind: "QUICK",
  name: "学生答卷",
  sourceId: "source",
  status: "RUNNING",
  createdAt: source.createdAt,
  error: null,
  stage: "ANSWER",
  source,
  answer: {
    id: "answer",
    kind: "ANSWER",
    name: "标准答案",
    createdAt: source.createdAt,
    status: "RUNNING",
    error: null,
    submissionId: null,
    result: { questions: [{ questionId: "q", solution: "内部草稿", gradingCriteria: "临时" }] },
  },
  grading: null,
};
function render(
  element: React.ReactElement,
  activeTasks?: { exams: number; grading: number; quickGrading: number; answerCards: number },
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (activeTasks) client.setQueryData(["active-tasks"], activeTasks);
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(
    createElement(QueryClientProvider, { client }, element),
  );
  client.clear();
  return container;
}
describe("management navigation and bundled workflows", () => {
  it("shows task numbers inside loading rings on their matching navigation entries", () => {
    const page = render(
      <WorkspaceShell name="老师" isAdmin={false}>
        工作区
      </WorkspaceShell>,
      {
        exams: 2,
        grading: 12,
        quickGrading: 1,
        answerCards: 3,
      },
    );
    const links = page.querySelectorAll('nav[aria-label="主导航"] a');
    expect(
      Array.from(links).map((link) => link.querySelector(".sidebar-task-count")?.textContent),
    ).toEqual(["2", "13", "3"]);
    expect(links[1].querySelector('[role="status"]')?.getAttribute("aria-label")).toBe(
      "13 个任务正在进行中",
    );
  });
  it("hides the loading indicator for entries with no active tasks", () => {
    const page = render(
      <WorkspaceShell name="老师" isAdmin={false}>
        工作区
      </WorkspaceShell>,
      {
        exams: 0,
        grading: 1,
        quickGrading: 0,
        answerCards: 0,
      },
    );
    expect(page.querySelectorAll(".sidebar-task-count")).toHaveLength(1);
    expect(page.querySelector('a[href="/dashboard"] .sidebar-task-count')).toBeNull();
    expect(page.querySelector('a[href="/quick-grading"] .sidebar-task-count')).toBeNull();
  });
  it("offers all three workflows and restricts settings to administrators", () => {
    const user = render(
      <WorkspaceShell name="老师" isAdmin={false}>
        工作区
      </WorkspaceShell>,
    );
    expect(
      Array.from(user.querySelectorAll('nav[aria-label="主导航"] a')).map(
        (link) => link.textContent,
      ),
    ).toEqual(["试卷管理", "作业批改", "答题卡批改"]);
    expect(user.querySelector('nav a[href="/quick-grading"]')).toBeNull();
    expect(user.textContent).not.toContain("AI 设置");
    expect(
      render(
        <WorkspaceShell name="老师" isAdmin={true}>
          工作区
        </WorkspaceShell>,
      ).textContent,
    ).toContain("AI 设置");
  });
  it("allows a chosen exam without reference answers and explains automatic preparation", () => {
    const page = render(
      createElement(GradingManager, {
        initialTasks: [{ ...source, answerStatus: "MISSING" }],
        selectedExam: "source",
        isAdmin: false,
      }),
    );
    expect(page.querySelector<HTMLInputElement>('input[type="file"]')?.disabled).toBe(false);
    expect(page.textContent).toContain("自动准备标准答案");
    expect(page.querySelector("select")?.value).toBe("source");
  });
  it("quick grading needs no prior exam selection", () => {
    const page = render(createElement(GradingManager, { quick: true, isAdmin: false }));
    expect(page.querySelector("#grading-exam")).toBeNull();
    expect(page.querySelectorAll(".task-model-fields select")).toHaveLength(6);
    expect(page.querySelector<HTMLInputElement>('input[type="file"]')?.disabled).toBe(false);
    expect(page.textContent).toContain("开始批改");
    expect(page.textContent).toContain("标准答案（可选）");
    expect(page.querySelector<HTMLDetailsElement>(".answer-disclosure")?.open).toBe(false);
    expect(page.querySelector(".answer-disclosure > summary")?.textContent).toContain(
      "标准答案（可选）",
    );
    expect(page.querySelector<HTMLInputElement>("#quick-answer-files")?.disabled).toBe(false);
    expect(page.textContent).toContain("每个 PDF 对应一位学生");
    expect(page.textContent).not.toContain("每次上传一位学生的答卷");
  });
  it("ordinary users see a patient waiting state and no internal stages or drafts", () => {
    const page = render(createElement(WorkflowResult, { initialWorkflow: flow, isAdmin: false }));
    expect(page.textContent).toContain("正在处理，请稍候");
    for (const text of ["当前阶段", "标准答案", "已保存", "内部草稿", "RUNNING"])
      expect(page.textContent).not.toContain(text);
    const admin = render(createElement(WorkflowResult, { initialWorkflow: flow, isAdmin: true }));
    expect(admin.textContent).toContain("当前阶段：标准答案");
    expect(admin.textContent).toContain("答案执行记录");
    expect(admin.querySelector<HTMLDetailsElement>(".debug-disclosure")?.open).toBe(false);
  });
  it("failure recovery does not disclose provider exceptions to ordinary users", () => {
    const failed = { ...flow, status: "FAILED" as const, error: "SDK provider HTTP 500 stack" };
    const page = render(createElement(WorkflowResult, { initialWorkflow: failed, isAdmin: false }));
    expect(page.textContent).toContain("无需再次上传");
    expect(page.textContent).toContain("重试批改");
    expect(page.textContent).not.toContain("SDK");
    expect(
      render(createElement(WorkflowResult, { initialWorkflow: failed, isAdmin: true })).textContent,
    ).toContain("SDK");
  });
});
