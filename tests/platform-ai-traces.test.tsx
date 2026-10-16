// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AiJobDTO } from "@/contracts/platform-ai";
import type { PlatformState } from "@/contracts/platform";
import { PlatformAI } from "@/components/platform/ai";
import { AIJobDetailPage } from "@/components/platform/ai-job-pages";
import { AIExecutionTrace } from "@/components/platform/ai-execution-trace";
import { useDomain } from "@/components/platform/domain-provider";
import { apiRequest } from "@/lib/http-client";
import { aiTraceActivities, aiTraceGroups } from "@/lib/ai-trace-display";
import { aiTraceFixtures } from "./fixtures/ai-traces";
import { aiCostFixture } from "./fixtures/ai-cost";
import { MockEventSource } from "./fixtures/event-source";

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
  useDomain: vi.fn(() => ({ state: { questions: [] }, refresh, notify })),
}));

const job: AiJobDTO = {
  id: "job",
  userId: "teacher",
  kind: "ASSEMBLE",
  modelId: "model",
  status: "RUNNING",
  input: { name: "练习", kind: "EXAM" },
  result: null,
  cost: null,
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
  MockEventSource.install();
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
  const snapshot = {
    models: [{ id: "model", name: "教学模型", providerName: "hidden-supplier" }],
    jobs: [job],
  };
  await act(async () =>
    root.render(
      <PlatformAI state={{} as PlatformState} tab="papers" refresh={refresh} notify={notify} />,
    ),
  );
  await act(async () => MockEventSource.current.snapshot(snapshot));
  expect(container.textContent).toContain("教学模型");
  expect(container.textContent).not.toContain("hidden-supplier");
  expect(container.textContent).not.toContain("private-event-details");
  expect(container.querySelector('a[href="/workspace/ai/job"]')).toBeTruthy();
  expect(container.querySelector("ol")).toBeNull();
});

it("updates a task's standalone timeline and preserves its complete execution record", async () => {
  const current = {
    ...job,
    status: "COMPLETED" as const,
    result: { summary: "全部题目已保存" },
    events: [...job.events, { type: "complete", summary: "全部题目已保存" }],
  };
  await act(async () => root.render(<AIJobDetailPage initialJob={job} />));
  expect(container.textContent).not.toContain("private-event-details");
  await act(async () => MockEventSource.current.snapshot({ models: [], jobs: [current] }));
  expect(MockEventSource.current.url).toBe("/api/platform/ai/job/events");
  expect(vi.mocked(apiRequest)).not.toHaveBeenCalled();
  expect(MockEventSource.current.close).toHaveBeenCalledOnce();
  expect(traceRows()).toHaveLength(2);
  await expandTrace();
  expect(container.textContent).toContain("全部题目已保存");
  expect(refresh).toHaveBeenCalledOnce();
});

it("shows RMB cost after completion and preserves the pricing and exchange rate details", async () => {
  await act(async () => root.render(<AIJobDetailPage initialJob={job} />));
  expect(container.querySelector('[aria-label="本次任务成本"]')).toBeNull();
  await act(async () =>
    MockEventSource.current.snapshot({
      models: [],
      jobs: [{ ...job, status: "COMPLETED", cost: aiCostFixture }],
    }),
  );
  const cost = container.querySelector<HTMLDetailsElement>('[aria-label="本次任务成本"]')!;
  expect(cost.querySelector("summary")?.textContent).toContain("估算成本 ¥0.014");
  expect(cost.open).toBe(false);
  expect(cost.textContent).toContain("$0.002");
  expect(cost.textContent).toContain("1 美元 = 7 元人民币");
  expect(cost.querySelector('a[href="https://models.dev/"]')).toBeTruthy();
  expect(cost.querySelector('a[href="https://www.exchangerate-api.com"]')).toBeTruthy();
});

it("identifies the fallback exchange rate and shows recorded costs for a failed task", async () => {
  await act(async () =>
    root.render(
      <AIJobDetailPage
        initialJob={{
          ...job,
          status: "FAILED",
          cost: {
            ...aiCostFixture,
            exchangeRate: { ...aiCostFixture.exchangeRate, source: "fallback" },
          },
        }}
      />,
    ),
  );
  const cost = container.querySelector('[aria-label="本次任务成本"]')!;
  expect(cost.textContent).toContain("动态汇率获取失败");
  expect(cost.textContent).toContain("备用汇率");
  expect(cost.textContent).toContain("仅包含已记录调用");
});

it("shows completed task costs on the list and never presents unavailable pricing as zero", async () => {
  const snapshot = {
    models: [],
    jobs: [
      { ...job, status: "COMPLETED" as const, cost: aiCostFixture },
      {
        ...job,
        id: "missing-price",
        status: "COMPLETED" as const,
        cost: {
          ...aiCostFixture,
          status: "unavailable" as const,
          reason: "price_unavailable" as const,
          cny: null,
          usd: null,
          pricing: null,
        },
      },
    ],
  };
  await act(async () =>
    root.render(
      <PlatformAI state={{} as PlatformState} tab="overview" refresh={refresh} notify={notify} />,
    ),
  );
  await act(async () => MockEventSource.current.snapshot(snapshot));
  expect(container.textContent).toContain("估算成本 ¥0.014");
  expect(container.textContent).toContain("成本暂无法估算");
  expect(container.textContent).not.toContain("¥0.00");
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
  expect(container.textContent).toContain("AI 服务连接暂时不稳定");
  expect(container.textContent).not.toContain("private-event-details");
});

it.each(aiTraceFixtures)(
  "uses the same compact, collapsed-detail activity log for $kind",
  async (fixture) => {
    await act(async () => root.render(<AIExecutionTrace job={fixture} />));
    expect(container.querySelector('section[aria-label="AI 执行过程"]')).toBeTruthy();
    expect(traceRows()).toHaveLength(aiTraceGroups(aiTraceActivities(fixture.events)).length);
    expect(container.querySelectorAll("ol details[open]")).toHaveLength(0);
    expect(container.querySelector('[aria-label="任务参数"]')).toBeNull();
    await expandTrace();
    expect(container.querySelector("pre")).toBeNull();
    expect(container.textContent).not.toMatch(/调用参数|退出码|输入 Token|工具调用|原始记录/);
  },
);

it("updates the actual current step after a tool finishes and keeps every detail collapsed", async () => {
  const initial = aiTraceFixtures[0];
  const current = {
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
  };
  await act(async () => root.render(<AIJobDetailPage initialJob={initial} />));
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(container.querySelector('[role="status"]')?.textContent).toBe("核对扫描页题目数量");
  expect(container.textContent).toContain("用时 30 秒");
  await act(async () => MockEventSource.current.snapshot({ models: [], jobs: [current] }));
  expect(container.querySelector('[role="status"]')?.textContent).toBe("分析处理结果，确定下一步");
  expect(container.querySelectorAll("ol details[open]")).toHaveLength(0);
});

it("preserves the last known process on a stream failure and clears the error after reconnecting", async () => {
  const initial = aiTraceFixtures[0];
  await act(async () => root.render(<AIJobDetailPage initialJob={initial} />));
  const first = MockEventSource.current;
  await act(async () => first.onerror?.());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("暂时无法更新进度");
  expect(container.querySelector('[role="status"]')?.textContent).toBe("核对扫描页题目数量");
  expect(traceRows()).toHaveLength(2);
  const refreshButton = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "刷新状态",
  )!;
  await act(async () => refreshButton.click());
  expect(first.close).toHaveBeenCalledOnce();
  expect(MockEventSource.current).not.toBe(first);
  await act(async () =>
    MockEventSource.current.snapshot({
      models: [],
      jobs: [{ ...initial, status: "COMPLETED", finishedAt: "2026-10-15T02:00:41Z" }],
    }),
  );
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
  expect(container.textContent).toContain("处理材料与整理结果");
  expect(container.textContent).not.toContain("未成功");
  expect(container.querySelector('pre[aria-label="命令"]')).toBeNull();
});

it("shows teaching explanations and useful images without exposing code, errors or internal output", async () => {
  const fixture = aiTraceFixtures.find((item) => item.id === "trace-import-rich")!;
  await act(async () => root.render(<AIExecutionTrace job={fixture} />));
  await expandTrace();
  expect(container.querySelector("pre")).toBeNull();
  expect(container.textContent).not.toMatch(
    /python verify|No such file|PIL|退出码|stdout|输入 Token|crop.png|工具：|原始记录/,
  );
  expect(container.textContent).toContain("AI 已继续处理，请以最终保存的结果为准");
  expect(container.textContent).toContain("已完成这一步的材料检查和计算");
  expect(
    container.querySelector(
      'a[href="/api/platform/assets/00000000-0000-0000-0000-000000000001"] img',
    ),
  ).toBeTruthy();
});
it("distinguishes images in two expanded activities that use the same tool", async () => {
  const fixture = {
    ...job,
    status: "COMPLETED" as const,
    events: [1, 2].map((number) => ({
      type: "sandbox",
      name: "python",
      toolCallId: `image-${number}`,
      images: [
        {
          name: `material-${number}.png`,
          url: `/api/platform/assets/00000000-0000-0000-0000-${String(number).padStart(12, "0")}`,
        },
      ],
    })),
  };
  await act(async () => root.render(<AIExecutionTrace job={fixture} />));
  await expandTrace();
  const regions = [...container.querySelectorAll('section[aria-label$="的相关图片"]')];
  expect(regions).toHaveLength(2);
  const names = regions.map((region) => region.getAttribute("aria-label"));
  expect(new Set(names).size).toBe(2);
  expect(names[0]).toContain("处理记录 1");
  expect(names[1]).toContain("处理记录 2");
  for (const region of regions) expect(region.querySelector("img")).not.toBeNull();
});

it.each(aiTraceFixtures)(
  "preserves complete diagnostics separately for an administrator: $id",
  async (fixture) => {
    await act(async () => root.render(<AIExecutionTrace job={fixture} showDiagnostics />));
    const raw = container.querySelector('pre[aria-label="完整技术记录"]')!;
    expect(raw.closest("details")?.open).toBe(false);
    expect(JSON.parse(raw.textContent!).events).toEqual(fixture.events);
    expect(JSON.parse(raw.textContent!).input).toEqual(fixture.input);
  },
);

it("explains a partial batch error without showing identifiers, validation paths or error codes", async () => {
  const partial = {
    ...job,
    status: "COMPLETED" as const,
    events: [
      {
        type: "tool",
        name: "propose_enrichment",
        status: "started",
        toolCallId: "batch",
        input: { items: [{ questionId: "private-q1" }, { questionId: "private-q2" }] },
      },
      {
        type: "tool",
        name: "propose_enrichment",
        status: "ended",
        toolCallId: "batch",
        error: JSON.stringify([
          {
            index: 1,
            success: false,
            error: {
              code: "REQUEST_422",
              message: "每道题和每个子题必须有完整标准答案",
              status: 422,
            },
          },
        ]),
      },
    ],
  };
  await act(async () => root.render(<AIExecutionTrace job={partial} />));
  await expandTrace();
  expect(container.textContent).toContain("部分题目的答案或解析还不完整");
  expect(container.textContent).toContain("已继续处理");
  expect(container.textContent).not.toMatch(/REQUEST_422|private-q|questionId|success|index|422/);
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it("gives teachers a useful next action when the task really fails, without showing a traceback", async () => {
  const failed = {
    ...job,
    status: "FAILED" as const,
    error: "APICallError: HTTP 503 Service Unavailable (错误编号：private-error-id)",
    events: [
      {
        type: "tool",
        name: "unknown_internal_tool",
        status: "ended",
        error: "Traceback private details",
      },
    ],
  };
  await act(async () => root.render(<AIExecutionTrace job={failed} />));
  await expandTrace();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("请稍后重试");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("联系管理员");
  expect(container.textContent).not.toMatch(
    /APICallError|HTTP|503|private-error-id|Traceback|unknown_internal_tool/,
  );
});

it("does not describe a failed task as still checking problems", async () => {
  await act(async () =>
    root.render(
      <AIExecutionTrace
        job={{
          ...job,
          status: "FAILED",
          events: [
            { type: "tool", name: "python", status: "ended", error: "Traceback" },
            { type: "tool", name: "read_question", status: "ended", error: "InvalidToolInput" },
          ],
        }}
      />,
    ),
  );
  expect(traceRows()[0].textContent).toContain("已停止");
  expect(traceRows()[0].textContent).not.toMatch(/正在|已完成/);
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
  expect(traceRows()[0].textContent).toContain("正在处理");
  await act(async () => root.render(<AIExecutionTrace job={{ ...fixture, status: "FAILED" }} />));
  expect(traceRows()[0].textContent).toContain("已停止");
  expect(traceRows()[0].textContent).not.toContain("已完成");
});

it("shows persisted unreadable questions and their reasons after a task completes normally", async () => {
  await act(async () =>
    root.render(
      <AIJobDetailPage
        initialJob={{
          ...job,
          status: "COMPLETED",
          kind: "IMPORT",
          result: {
            summary: "已处理可辨认题目，跳过1题",
            result: {
              skipped: [
                {
                  id: "第2页第3题",
                  sourceUrl: "/api/platform/assets/page2",
                  reason: "题干模糊，无法辨认",
                },
              ],
            },
          },
        }}
      />,
    ),
  );
  const region = container.querySelector('[aria-label="跳过的题目及原因"]');
  expect(region?.textContent).toContain("第2页第3题");
  expect(region?.textContent).toContain("题干模糊，无法辨认");
  expect(region?.querySelector("a")?.getAttribute("href")).toBe("/api/platform/assets/page2");
  expect(container.textContent).not.toContain("重试任务");
});

it("shows the real question number for a skipped answer and keeps internal IDs out of the teacher's view", async () => {
  vi.mocked(useDomain).mockReturnValueOnce({
    state: {
      questions: [],
      classrooms: [{ students: [{ id: "private-student-id", name: "小明" }] }],
      papers: [{ items: [{ id: "private-item-id", position: 4 }] }],
    },
    refresh,
    notify,
  } as unknown as ReturnType<typeof useDomain>);
  await act(async () =>
    root.render(
      <AIJobDetailPage
        initialJob={{
          ...job,
          status: "COMPLETED",
          kind: "GRADE",
          result: {
            summary: "已处理可辨认题目",
            result: {
              assessmentId: "assessment",
              assessmentKind: "EXAM",
              classroomId: "class",
              paperId: "paper",
              students: [],
              pendingPages: [],
              skipped: [{ id: "private-student-id:private-item-id", reason: "作答看不清" }],
            },
          },
        }}
      />,
    ),
  );
  const skipped = container.querySelector('[aria-label="跳过的题目及原因"]')!;
  expect(skipped.textContent).toContain("第 5 题");
  expect(container.textContent).not.toContain("private-item-id");
  expect(container.querySelector('[aria-label="完整技术记录"]')).toBeNull();
});

it("only offers the optional technical record to an administrator on the task page", async () => {
  vi.mocked(useDomain).mockReturnValueOnce({
    state: { actor: { role: "ADMIN" }, questions: [] },
    refresh,
    notify,
  } as unknown as ReturnType<typeof useDomain>);
  await act(async () =>
    root.render(<AIJobDetailPage initialJob={{ ...job, status: "COMPLETED" }} />),
  );
  const raw = container.querySelector('pre[aria-label="完整技术记录"]')!;
  expect(raw.closest("details")?.open).toBe(false);
  expect(JSON.parse(raw.textContent!).events).toEqual(job.events);
});
