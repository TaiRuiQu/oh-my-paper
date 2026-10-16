// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Analytics } from "@/components/platform/analytics";
import type { Analytics as AnalyticsData, PlatformState } from "@/contracts/platform";
import { apiRequest } from "@/lib/http-client";

vi.mock("@/lib/http-client", () => ({ apiRequest: vi.fn() }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/components/platform/questions", () => ({ QuestionBody: () => null }));
const empty: AnalyticsData = { results: [], students: [], classrooms: [], knowledge: [] };
const loaded: AnalyticsData = {
  ...empty,
  knowledge: [{ tag: "已读取的知识点", earned: 4, maximum: 5, accuracy: 0.8, attempts: 1 }],
};
const state = {
  actor: { id: "self", role: "STUDENT", name: "本人" },
  analytics: empty,
  assessments: [
    { id: "a", name: "考试甲" },
    { id: "b", name: "考试乙" },
  ],
  classrooms: [],
  papers: [],
  questions: [],
  templates: [],
  users: [],
  reviews: [],
  submissions: [],
} as unknown as PlatformState;
let root: Root, container: HTMLDivElement, client: QueryClient;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
});
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 15));
  });
}
async function render(view = "results", role: "STUDENT" | "TEACHER" = "STUDENT") {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Analytics
          state={role === "STUDENT" ? state : { ...state, actor: { ...state.actor, role } }}
          fixedView={view}
        />
      </QueryClientProvider>,
    ),
  );
  await settle();
}
function retry() {
  return [...container.querySelectorAll("button")].find((b) => b.textContent === "重新读取学情")!;
}
it.each(["results", "knowledge", "learning"])(
  "shows read failure instead of invented empty %s data",
  async (view) => {
    vi.mocked(apiRequest).mockRejectedValue(new Error("网络读取中断"));
    await render(view);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("网络读取中断");
    expect(retry()).toBeTruthy();
    for (const falseEmpty of [
      "目前没有已发布的成绩",
      "根据题目知识点自动汇总",
      "选择一位学生查看",
      "当前没有错题记录",
    ])
      expect(container.textContent).not.toContain(falseEmpty);
  },
);
it("does not claim a teacher has no grades when the first request failed", async () => {
  vi.mocked(apiRequest).mockRejectedValue(new Error("服务暂时不可用"));
  await render("results", "TEACHER");
  expect(container.textContent).toContain("尚未读取到所选范围的学情");
  expect(container.textContent).not.toContain("尚无考试成绩");
});
it("explicit retry reads the same scope and replaces the error with successful data", async () => {
  vi.mocked(apiRequest)
    .mockRejectedValueOnce(new Error("读取失败"))
    .mockResolvedValue(loaded as never);
  await render("knowledge");
  await act(async () => retry().click());
  await settle();
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.textContent).toContain("已读取的知识点");
  expect(vi.mocked(apiRequest).mock.calls.map((call) => call[0])).toEqual([
    "/api/platform/analytics?",
    "/api/platform/analytics?",
  ]);
});
it("keeps successful cached data and labels it as possibly outdated after a refresh fails", async () => {
  vi.mocked(apiRequest)
    .mockResolvedValueOnce(loaded as never)
    .mockRejectedValue(new Error("更新失败"));
  await render("knowledge");
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["platform-analytics"] });
  });
  await settle();
  expect(container.textContent).toContain("已读取的知识点");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("可能不是最新结果");
  expect(retry()).toBeTruthy();
});
it("does not present the preceding scope as a new scope's result after its first read fails", async () => {
  vi.mocked(apiRequest)
    .mockResolvedValueOnce(loaded as never)
    .mockRejectedValue(new Error("乙读取失败"));
  await render("knowledge");
  const filter = container.querySelector('select[aria-label="筛选考试"]') as HTMLSelectElement;
  await act(async () => {
    filter.value = "b";
    filter.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
  expect(container.textContent).not.toContain("已读取的知识点");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("尚未读取到所选范围");
  expect(vi.mocked(apiRequest).mock.calls.at(-1)?.[0]).toContain("assessmentId=b");
});
it("still renders the real empty result after a successful read", async () => {
  vi.mocked(apiRequest).mockResolvedValue(empty as never);
  await render();
  expect(container.textContent).toContain("目前没有已发布的成绩");
  expect(container.querySelector('[role="alert"]')).toBeNull();
});
