// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AiJobDTO } from "@/contracts/platform-ai";
import type { PlatformState } from "@/contracts/platform";
import { PlatformAI } from "@/components/platform/ai";
import { AIJobDetailPage } from "@/components/platform/ai-job-pages";
import { apiRequest } from "@/lib/http-client";

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
beforeEach(() => {
  vi.useFakeTimers();
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
  expect(container.querySelectorAll("ol > li")).toHaveLength(2);
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
