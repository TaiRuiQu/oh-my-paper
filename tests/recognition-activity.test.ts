// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { AgentEvent, RecognitionActivity } from "@/contracts/activity";
import type { ExamTaskSummary } from "@/contracts/exam-tasks";
import { RecognitionActivityFeed } from "@/components/recognition-activity";
import { ExamResult } from "@/components/exam-result";

const task: ExamTaskSummary = {
  id: "task",
  name: "试卷",
  status: "RUNNING",
  error: null,
  createdAt: "2026-10-12T00:00:00Z",
};
const events: AgentEvent[] = [
  { sequence: 1, at: task.createdAt, type: "step", step: 1 },
  {
    sequence: 2,
    at: task.createdAt,
    type: "tool_call",
    step: 1,
    callId: "read",
    tool: "read_pages",
    data: { pages: [1] },
  },
  {
    sequence: 3,
    at: task.createdAt,
    type: "tool_result",
    step: 1,
    callId: "read",
    data: { pages: [1], images: ["pages/001.jpg"] },
    durationMs: 100,
  },
  {
    sequence: 4,
    at: task.createdAt,
    type: "tool_call",
    step: 1,
    callId: "inspect",
    tool: "inspect_image",
    data: { region: { page: 1 } },
  },
  {
    sequence: 5,
    at: task.createdAt,
    type: "tool_error",
    step: 1,
    callId: "inspect",
    data: { message: "区域无效" },
  },
  { sequence: 6, at: task.createdAt, type: "message", step: 1, text: "重新检查页面区域。" },
  { sequence: 7, at: task.createdAt, type: "step", step: 2 },
  {
    sequence: 8,
    at: task.createdAt,
    type: "tool_call",
    step: 2,
    callId: "submit",
    tool: "submit_exam",
    data: { sections: [] },
  },
];
function render(isAdmin?: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData<RecognitionActivity>(["recognition-activity", task.id, task.status], {
    attempt: "attempt",
    events,
    cursor: 8,
    active: true,
  });
  const content =
    isAdmin === undefined
      ? createElement(RecognitionActivityFeed, { task })
      : createElement(ExamResult, { id: task.id, initialData: { task, exam: null }, isAdmin });
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(
    createElement(QueryClientProvider, { client }, content),
  );
  client.clear();
  return container;
}
describe("recognition activity presentation", () => {
  it("groups multiple tools and messages into collapsed rounds, including failures and pending tools", () => {
    const container = render();
    const rounds = container.querySelectorAll(".agent-event-list > li");
    expect(rounds).toHaveLength(2);
    expect(rounds[0].querySelector("summary")?.textContent).toContain("第 1 轮");
    expect(rounds[0].querySelector("summary")?.textContent).toContain("查看试卷页面、放大图像区域");
    expect(rounds[0].querySelector("summary")?.textContent).toContain("需要修正");
    expect(rounds[1].querySelector("summary")?.textContent).toContain("处理中");
    expect(container.querySelector("details[open]")).toBeNull();
    expect(rounds[0].textContent).toContain("重新检查页面区域。");
    expect(rounds[0].querySelectorAll(".agent-tool")).toHaveLength(2);
    expect(rounds[0].querySelector("img")?.getAttribute("src")).toContain(
      "activity/images/pages/001.jpg?attempt=attempt",
    );
  });
  it("shows the activity feed only to administrators while preserving ordinary parsing status", () => {
    expect(render(true).querySelector(".agent-activity")).not.toBeNull();
    const ordinary = render(false);
    expect(ordinary.querySelector(".agent-activity")).toBeNull();
    expect(ordinary.textContent).toContain("正在处理，请稍候");
  });
});
