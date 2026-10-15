// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AiJobDTO } from "@/contracts/platform-ai";
import type { PlatformState } from "@/contracts/platform";
import { PlatformAI } from "@/components/platform/ai";
import { AIJobDetailPage } from "@/components/platform/ai-job-pages";
import { AIExecutionTrace } from "@/components/platform/ai-execution-trace";
import { apiRequest } from "@/lib/http-client";
import { aiTraceActivities, aiTraceGroups } from "@/lib/ai-trace-display";
import { aiTraceFixtures } from "./fixtures/ai-traces";

const { push, refresh, notify } = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(async () => {}),
  notify: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/http-client", () => ({
  apiRequest: vi.fn(),
  jsonBody: (data: unknown) => ({ body: JSON.stringify(data) }),
}));
vi.mock("@/components/platform/questions", () => ({
  QUESTION_LABELS: { SINGLE: "单选" },
  QuestionBody: () => null,
}));
vi.mock("@/components/platform/domain-provider", () => ({
  useDomain: () => ({ state: { questions: [] }, refresh, notify }),
}));

const job: AiJobDTO = {
  id: "job",
  userId: "teacher",
  kind: "ASSEMBLE",
  modelId: "model",
  status: "RUNNING",
  input: { name: "练习", kind: "EXAM" },
  result: null,
  events: [
    { type: "tool", name: "inspect_image", status: "started", message: "private-event-details" },
  ],
  error: null,
  attempts: 1,
  createdAt: "2026-10-14T10:00:00Z",
  startedAt: "2026-10-14T10:01:00Z",
  finishedAt: null,
};
let container: HTMLDivElement, root: Root;
const traceRows = () => container.querySelectorAll('ol[aria-label="AI 执行记录"] > li');
async function expandTrace() {
  while (container.querySelector('ol[aria-label="AI 执行记录"] details:not([open])')) {
    await act(async () => {
      container
        .querySelectorAll<HTMLDetailsElement>('ol[aria-label="AI 执行记录"] details:not([open])')
        .forEach((details) => {
          details.open = true;
          details.dispatchEvent(new Event("toggle"));
        });
    });
  }
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-15T02:00:35Z"));
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

it("keeps execution events on their own page and hides supplier names from model choices", async () => {
  vi.mocked(apiRequest).mockResolvedValue({
    models: [{ id: "model", name: "教学模型", providerName: "hidden-supplier" }],
    jobs: [job],
  });
  await act(async () =>
    root.render(
      <PlatformAI state={{} as PlatformState} tab="papers" refresh={refresh} notify={notify} />,
    ),
  );
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(container.textContent).toContain("教学模型");
  expect(container.textContent).not.toContain("hidden-supplier");
  expect(container.textContent).not.toContain("private-event-details");
  expect(container.querySelector('a[href="/workspace/ai/job"]')).toBeTruthy();
  expect(container.querySelector("ol")).toBeNull();
});

it("updates a task's standalone timeline and preserves its complete execution record", async () => {
  vi.mocked(apiRequest).mockResolvedValue({
    ...job,
    status: "COMPLETED",
    events: [...job.events, { type: "complete", summary: "全部题目已保存" }],
  });
  await act(async () => root.render(<AIJobDetailPage initialJob={job} />));
  expect(container.textContent).toContain("private-event-details");
  await act(async () => vi.advanceTimersByTimeAsync(3000));
  expect(vi.mocked(apiRequest)).toHaveBeenCalledWith("/api/platform/ai/job");
  expect(traceRows()).toHaveLength(2);
  await expandTrace();
  expect(container.textContent).toContain("全部题目已保存");
  expect(refresh).toHaveBeenCalledOnce();
});

it("opens the newly created retry task and retains the failed task's trace", async () => {
  vi.mocked(apiRequest).mockResolvedValue({ id: "new-job" });
  await act(async () =>
    root.render(<AIJobDetailPage initialJob={{ ...job, status: "FAILED", error: "请求中断" }} />),
  );
  const retry = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "重试任务",
  )!;
  await act(async () => retry.click());
  expect(vi.mocked(apiRequest).mock.calls[0][0]).toBe("/api/platform/ai/job/retry");
  expect(push).toHaveBeenCalledWith("/workspace/ai/new-job");
  expect(container.textContent).toContain("请求中断");
  expect(container.textContent).toContain("private-event-details");
});

it.each(aiTraceFixtures)(
  "uses the same compact, collapsed-detail activity log for $kind",
  async (fixture) => {
    await act(async () => root.render(<AIExecutionTrace job={fixture} />));
    expect(container.querySelector('section[aria-label="AI 执行过程"]')).toBeTruthy();
    expect(traceRows()).toHaveLength(aiTraceGroups(aiTraceActivities(fixture.events)).length);
    expect(container.querySelectorAll("ol details[open]")).toHaveLength(0);
    expect(container.querySelector('[aria-label="任务参数"]')?.closest("details")?.open).toBe(
      false,
    );
    await expandTrace();
    const records = [...container.querySelectorAll('ol pre[aria-label$="的完整记录"]')]
      .flatMap((pre) => JSON.parse(pre.textContent ?? "[]") as { record: number; event: unknown }[])
      .sort((a, b) => a.record - b.record)
      .map(({ event }) => event);
    expect(records).toEqual(fixture.events);
  },
);

it("updates the actual current step after a tool finishes and keeps every detail collapsed", async () => {
  const initial = aiTraceFixtures[0];
  vi.mocked(apiRequest).mockResolvedValue({
    ...initial,
    events: [
      ...initial.events,
      {
        type: "tool",
        name: "record_source_inventory",
        toolCallId: "inventory",
        status: "ended",
        durationMs: 600,
      },
    ],
  });
  await act(async () => root.render(<AIJobDetailPage initialJob={initial} />));
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(container.querySelector('[role="status"]')?.textContent).toBe("核对扫描页题目数量");
  expect(container.textContent).toContain("用时 30 秒");
  await act(async () => vi.advanceTimersByTimeAsync(3000));
  expect(container.querySelector('[role="status"]')?.textContent).toBe("分析处理结果，确定下一步");
  expect(container.querySelectorAll("ol details[open]")).toHaveLength(0);
});

it("preserves the last known process on a polling failure and clears the error after recovery", async () => {
  const initial = aiTraceFixtures[0];
  vi.mocked(apiRequest)
    .mockRejectedValueOnce(new Error("网络中断，请刷新重试。"))
    .mockResolvedValueOnce({ ...initial, status: "COMPLETED", finishedAt: "2026-10-15T02:00:41Z" });
  await act(async () => root.render(<AIJobDetailPage initialJob={initial} />));
  await act(async () => vi.advanceTimersByTimeAsync(3000));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("网络中断");
  expect(container.querySelector('[role="status"]')?.textContent).toBe("核对扫描页题目数量");
  expect(traceRows()).toHaveLength(2);
  const refreshButton = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "刷新状态",
  )!;
  await act(async () => refreshButton.click());
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.querySelector('[role="status"]')?.textContent).toBe("处理完成");
  expect(container.querySelectorAll('ol > li[data-state="running"]')).toHaveLength(0);
});

it("renders the result as a readable list with formulas even when the complete event has the same summary", async () => {
  const fixture = aiTraceFixtures.find((item) => item.id === "trace-import-rich")!;
  await act(async () => root.render(<AIJobDetailPage initialJob={fixture} />));
  const result = [...container.querySelectorAll("section")].find(
    (section) => section.querySelector("h2")?.textContent === "处理结果",
  )!;
  expect(result.querySelectorAll("ol > li")).toHaveLength(3);
  expect(result.querySelector("strong")?.textContent).toBe("11 道题");
  expect(result.querySelectorAll(".katex").length).toBeGreaterThan(3);
  expect(result.textContent).not.toContain("\\n");
  expect(traceRows()).toHaveLength(4);
  expect(container.textContent).toContain("连续工具调用 · 8 次");
  expect(container.textContent).toContain("1 次未成功");
  expect(container.querySelector('pre[aria-label="命令"]')).toBeNull();
});

it("visualizes tool parameters, failures, output and images while retaining the original events", async () => {
  const fixture = aiTraceFixtures.find((item) => item.id === "trace-import-rich")!;
  await act(async () => root.render(<AIExecutionTrace job={fixture} />));
  await expandTrace();
  expect(container.querySelector('pre[aria-label="命令"]')?.textContent).toBe("python verify.py");
  expect(container.querySelector('pre[aria-label="错误输出"]')?.textContent).toContain(
    "No such file",
  );
  expect(container.querySelector('pre[aria-label="Python 代码"]')?.textContent).toContain(
    "\nprint(",
  );
  expect(container.querySelector('pre[aria-label="标准输出"]')?.textContent).toContain(
    "已核对全部 11 道题",
  );
  expect(
    container.querySelector(
      'a[href="/api/platform/assets/00000000-0000-0000-0000-000000000001"] img',
    ),
  ).toBeTruthy();
  expect(container.querySelector('[aria-label="本轮用量"]')?.textContent).toContain(
    "输入 Token1200",
  );
  expect(container.textContent).toContain("执行未成功 · 退出码 1");
});

it("shows running and interrupted calls inside a group without calling them completed", async () => {
  const fixture = {
    ...job,
    events: [
      { type: "tool", name: "python", toolCallId: "first", status: "started" },
      { type: "tool", name: "shell", toolCallId: "second", status: "started" },
    ],
  };
  await act(async () => root.render(<AIExecutionTrace job={fixture} />));
  expect(traceRows()[0].textContent).toContain("2 次进行中");
  await act(async () => root.render(<AIExecutionTrace job={{ ...fixture, status: "FAILED" }} />));
  expect(traceRows()[0].textContent).toContain("2 次已中断");
  expect(traceRows()[0].textContent).not.toContain("已完成");
});
