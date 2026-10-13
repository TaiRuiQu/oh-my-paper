// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UsageDashboardPanel } from "@/components/usage-dashboard";
import { UserModelSettings } from "@/components/user-ai-settings";
import { CreditGrantForm } from "@/components/credit-grant-form";
import type { UsageDashboard } from "@/contracts/usage";
import type { UserAiSettings } from "@/contracts/user-ai";
const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/http-client", () => ({
  apiRequest: request,
  jsonBody: (body: unknown) => ({ body: JSON.stringify(body) }),
}));
const dashboard: UsageDashboard = {
  totals: { credits: "2.7", inputTokens: 4000, outputTokens: 1200, cachedTokens: 600, calls: 5 },
  users: [
    {
      id: "one",
      name: "高消费用户",
      balance: "-0.2",
      credits: "2.5",
      inputTokens: 1000,
      outputTokens: 1000,
      cachedTokens: 500,
      calls: 2,
    },
    {
      id: "two",
      name: "高用量用户",
      balance: "99.8",
      credits: "0.2",
      inputTokens: 3000,
      outputTokens: 200,
      cachedTokens: 100,
      calls: 3,
    },
  ],
  models: [
    {
      id: "one",
      name: "高倍率模型",
      provider: "测试",
      credits: "2.5",
      inputTokens: 1000,
      outputTokens: 1000,
      cachedTokens: 500,
      calls: 2,
    },
    {
      id: "two",
      name: "低倍率模型",
      provider: "测试",
      credits: "0.2",
      inputTokens: 3000,
      outputTokens: 200,
      cachedTokens: 100,
      calls: 3,
    },
  ],
};
const settings: UserAiSettings = {
  credits: "-0.2",
  models: [{ id: "one", name: "可选模型", creditMultiplier: 2 }],
  selections: { exam: null, answer: null, grading: null },
  defaults: { exam: "one", answer: "one", grading: "one" },
};
let root: Root, container: HTMLDivElement, client: QueryClient;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  request.mockResolvedValue(settings);
});
afterEach(() => {
  act(() => root.unmount());
  client.clear();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
function mount(element: React.ReactNode) {
  act(() => root.render(<QueryClientProvider client={client}>{element}</QueryClientProvider>));
}
describe("credit and usage interfaces", () => {
  it("retries a failed credit addition with the same request ID", async () => {
    request.mockRejectedValueOnce(new Error("网络中断")).mockResolvedValueOnce({ credits: "200" });
    const saved = vi.fn(async () => {});
    mount(
      <CreditGrantForm user={{ id: "user", name: "老师" }} onSaved={saved} onCancel={() => {}} />,
    );
    const submit = async () => {
      await act(async () => {
        container
          .querySelector("form")!
          .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      });
    };
    await submit();
    await submit();
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][1].body).toBe(request.mock.calls[1][1].body);
    expect(JSON.parse(request.mock.calls[0][1].body).amount).toBe(100);
    expect(saved).toHaveBeenCalledWith(100);
  });
  it("shows accurate totals and reorders both rankings by token usage", () => {
    mount(<UsageDashboardPanel initialData={dashboard} />);
    expect(container.textContent).toContain("5,200");
    expect(container.querySelector("#user-usage-title")?.textContent).toBe("用户消耗排行榜");
    expect(container.querySelector(".usage-table tbody tr")?.textContent).toContain("高消费用户");
    const select = container.querySelector<HTMLSelectElement>("#usage-sort")!;
    act(() => {
      select.value = "tokens";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.querySelector(".usage-table tbody tr")?.textContent).toContain("高用量用户");
    expect(
      container.querySelectorAll(".usage-table")[1].querySelector("tbody tr")?.textContent,
    ).toContain("低倍率模型");
    expect(container.textContent).toContain("缓存命中输入 600");
  });
  it("displays debt policy and saves a selected model for only its purpose", async () => {
    mount(<UserModelSettings initialSettings={settings} />);
    expect(container.textContent).toContain("-0.2 credit");
    expect(container.textContent).toContain("当前处理会继续完成");
    expect(container.textContent).not.toContain("输入 token");
    expect(container.textContent).toContain("低倍率模型通常更快");
    const select = container.querySelector<HTMLSelectElement>("#user-model-answer")!;
    act(() => {
      select.value = "one";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      select
        .closest("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(request).toHaveBeenCalledWith("/api/ai/settings", {
      method: "PUT",
      body: JSON.stringify({ purpose: "answer", modelId: "one" }),
    });
    expect(container.querySelector<HTMLSelectElement>("#user-model-exam")?.value).toBe("");
  });
  it("shows unlimited administrator balances and provides credit management for ordinary users", () => {
    mount(
      <UsageDashboardPanel
        initialData={{
          ...dashboard,
          users: [{ ...dashboard.users[0], unlimited: true }, dashboard.users[1]],
        }}
      />,
    );
    expect(container.querySelector(".usage-table tbody tr")?.textContent).toContain("不限量");
    expect(container.querySelector('button[aria-label="为高消费用户添加 credit"]')).toBeNull();
    const button = container.querySelector<HTMLButtonElement>(
      'button[aria-label="为高用量用户添加 credit"]',
    )!;
    act(() => button.click());
    expect(container.querySelector('form[aria-label="为高用量用户添加 credit"]')).not.toBeNull();
  });
});
