// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { Exam } from "@/contracts/exams";
import type { ExamAgentTask } from "@/contracts/exam-agents";
import { ExamAgents, AgentResultContent } from "@/components/exam-agents";
const exam: Exam = {
  id: "exam",
  name: "试卷",
  totalScore: 10,
  sections: [
    {
      id: "section",
      number: "一",
      title: "计算",
      description: "",
      score: 10,
      questions: [1, 2].map((number) => ({
        id: `q${number}`,
        number,
        description: "计算",
        score: 5,
        subquestions: [],
        materials: [],
      })),
    },
  ],
};
function task(overrides: Partial<ExamAgentTask> = {}): ExamAgentTask {
  return {
    id: "task",
    kind: "ANSWER",
    name: "标准答案",
    status: "COMPLETED",
    createdAt: "2026-10-12T00:00:00Z",
    error: null,
    submissionId: null,
    result: {
      questions: [1, 2].map((number) => ({
        questionId: `q${number}`,
        solution: "参考解答",
        gradingCriteria: "5分",
      })),
    },
    ...overrides,
  };
}
function render(tasks: ExamAgentTask[], isAdmin = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["exam-agents", "source"], { tasks });
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(ExamAgents, { exam, taskId: "source", isAdmin }),
    ),
  );
  client.clear();
  return container;
}
describe("reference answers and role-specific presentation", () => {
  it("provides a clear generation action and published answers", () => {
    expect(render([]).textContent).toContain("生成标准答案");
    expect(render([]).textContent).toContain("上传标准答案");
    expect(render([task()]).textContent).toContain("参考解答");
    expect(render([task()]).textContent).toContain("评分标准");
    expect(render([task()]).querySelector('input[type="file"]')).toBeNull();
  });
  it("hides unfinished answers, stage counts and diagnostics from ordinary users", () => {
    const pending = task({
      status: "RUNNING",
      result: {
        questions: [{ questionId: "q1", solution: "内部草稿", gradingCriteria: "临时评分" }],
      },
    });
    const user = render([pending]);
    expect(user.textContent).toContain("正在处理，请稍候");
    for (const text of ["内部草稿", "临时评分", "已保存", "RUNNING", "执行记录"])
      expect(user.textContent).not.toContain(text);
    const admin = render([pending], true);
    expect(admin.textContent).toContain("内部草稿");
    expect(admin.textContent).toContain("已保存 1 题");
    expect(admin.querySelector<HTMLDetailsElement>(".debug-disclosure")?.open).toBe(false);
  });
  it("offers retry without exposing internal error text or failed drafts", () => {
    const failed = task({
      status: "FAILED",
      error: "Python sandbox stack internal",
      result: { questions: [{ questionId: "q1", solution: "半成品", gradingCriteria: "临时" }] },
    });
    expect(render([failed]).textContent).toContain("重试生成");
    expect(render([failed]).textContent).not.toContain("sandbox");
    expect(render([failed]).textContent).not.toContain("半成品");
    expect(render([failed], true).textContent).toContain("sandbox");
  });
  it("distinguishes final scores from unresolved questions", () => {
    const grade = task({
      kind: "GRADING",
      result: {
        questions: [1, 2].map((number) => ({
          questionId: `q${number}`,
          answer: "2",
          correct: true,
          score: 5,
          feedback: "正确",
        })),
      },
    });
    const html = renderToStaticMarkup(createElement(AgentResultContent, { task: grade, exam }));
    expect(html).toContain("总得分");
    expect(html).toContain("10");
    const partial = task({
      kind: "GRADING",
      result: {
        questions: [
          { questionId: "q1", answer: "看不清", correct: null, score: null, feedback: "请复核" },
        ],
      },
    });
    const other = renderToStaticMarkup(createElement(AgentResultContent, { task: partial, exam }));
    expect(other).toContain("已评分题目合计");
    expect(other).toContain("1 题需要复核");
    expect(other).not.toContain("总得分");
  });
});
