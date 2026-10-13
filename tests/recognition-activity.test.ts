// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
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
  {
    sequence: 7,
    at: task.createdAt,
    type: "timing",
    step: 1,
    durationMs: 12400,
    data: {
      requests: [{ ttfbMs: 11500, bodyMs: 700, status: 200, failed: false }],
      inputTokens: 32000,
      outputTokens: 900,
      outputTokensPerSecond: 73,
    },
  },
  { sequence: 8, at: task.createdAt, type: "step", step: 2 },
  {
    sequence: 9,
    at: task.createdAt,
    type: "timing",
    step: 2,
    durationMs: 21500,
    data: {
      requests: [
        { ttfbMs: 500, bodyMs: 100, status: 429, failed: true },
        { ttfbMs: 20000, bodyMs: 800, status: 200, failed: false },
      ],
      inputTokens: 45000,
      outputTokens: 1800,
      outputTokensPerSecond: 84,
    },
  },
  {
    sequence: 10,
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
    cursor: 10,
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
  it("summarizes per-round and total timing across model, tool and network categories", () => {
    const container = render();
    const total = container.querySelector(".agent-timing-total");
    expect(total?.textContent).toContain("累计耗时");
    expect(total?.textContent).toContain("模型输出 33.9 秒");
    expect(total?.textContent).toContain("工具执行 0.1 秒");
    expect(total?.textContent).toContain("其中网络请求 33.6 秒（3 次请求）");
    expect(total?.querySelectorAll(".agent-timing-legend li")).toHaveLength(3);
    // 每轮折叠摘要展示总时长，展开后有分类明细与 tokens 概览。
    const rounds = container.querySelectorAll(".agent-event-list > li");
    expect(rounds[0].querySelector("summary")?.textContent).toContain("共 12.5 秒");
    expect(rounds[0].querySelector(".agent-round-timing")?.textContent).toContain(
      "模型输出 12.4 秒 · 工具执行 0.1 秒 · 其中网络请求 12.2 秒（1 次请求）",
    );
    expect(rounds[0].querySelector(".agent-round-timing")?.textContent).toContain(
      "输入 32.0k / 输出 900 tokens · 73 tokens/秒",
    );
    expect(rounds[1].querySelector(".agent-round-timing")?.textContent).toContain("2 次请求");
    // timing 事件本身不作为消息行重复展示。
    expect(rounds[0].querySelectorAll(".agent-event")).toHaveLength(3);
  });
  it("shows the activity feed only to administrators while preserving ordinary parsing status", () => {
    expect(render(true).querySelector(".agent-activity")).not.toBeNull();
    const ordinary = render(false);
    expect(ordinary.querySelector(".agent-activity")).toBeNull();
    expect(ordinary.textContent).toContain("正在处理，请稍候");
  });
});
