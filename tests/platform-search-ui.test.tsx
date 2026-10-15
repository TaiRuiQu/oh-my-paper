// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QuestionListPage } from "@/components/platform/question-pages";
import { EmbeddingSettings } from "@/components/platform/embedding-settings";
import { apiRequest } from "@/lib/http-client";
import type { AdminSearchConfiguration } from "@/contracts/platform-search";

vi.mock("@/lib/http-client", () => ({
  apiRequest: vi.fn(),
  jsonBody: (body: unknown) => ({ body: JSON.stringify(body) }),
}));
vi.mock("@/components/platform/ai", () => ({ PlatformAI: () => null }));
vi.mock("@/components/markdown-text", () => ({
  MarkdownText: ({ text }: { text: string }) => <p>{text}</p>,
}));

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
  vi.unstubAllGlobals();
});

const question = {
  id: "q1",
  type: "BLANK",
  subject: "数学",
  grade: "高一",
  knowledgeTags: [],
  content: { stem: "原关键词结果" },
};
function results(overrides = {}) {
  return { questions: [question], total: 45, page: 1, pageSize: 20, ...overrides };
}
async function settle() {
  await act(async () => vi.advanceTimersByTimeAsync(200));
}
async function click(text: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (element) => element.textContent === text,
  );
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}
async function choose(label: string, value: string) {
  const element = container.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement;
  await act(async () => {
    element.value = value;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function input(text: string) {
  const element = container.querySelector('input[aria-label="搜索试题"]') as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, text);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submitSearch() {
  await act(async () => {
    container
      .querySelector('form[role="search"]')!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

it("submits semantic searches explicitly and resets pagination when changing mode or filters", async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => results() });
  vi.stubGlobal("fetch", fetcher);
  await act(async () => root.render(<QuestionListPage />));
  await settle();
  await click("下一页");
  await settle();
  expect(fetcher.mock.calls.at(-1)![0]).toContain("page=2");
  await input("函数");
  await settle();
  const calls = fetcher.mock.calls.length;
  await choose("搜索方式", "semantic");
  await settle();
  expect(fetcher).toHaveBeenCalledTimes(calls);
  expect(container.textContent).not.toContain("原关键词结果");
  await input("用图像判断一次函数的变化趋势");
  await settle();
  expect(fetcher).toHaveBeenCalledTimes(calls);
  await submitSearch();
  await settle();
  let url = new URL(fetcher.mock.calls.at(-1)![0], "http://localhost");
  expect(url.searchParams.get("searchMode")).toBe("semantic");
  expect(url.searchParams.get("q")).toBe("用图像判断一次函数的变化趋势");
  expect(url.searchParams.get("page")).toBe("1");
  await click("下一页");
  await settle();
  await choose("筛选学科", "数学");
  await settle();
  url = new URL(fetcher.mock.calls.at(-1)![0], "http://localhost");
  expect(url.searchParams.get("subject")).toBe("数学");
  expect(url.searchParams.get("page")).toBe("1");
});

it("clears previous search results on failure and retries the same semantic query", async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => results() });
  vi.stubGlobal("fetch", fetcher);
  await act(async () => root.render(<QuestionListPage />));
  await settle();
  expect(container.textContent).toContain("原关键词结果");
  await choose("搜索方式", "semantic");
  await input("抛物线与坐标轴的交点");
  fetcher.mockResolvedValueOnce({
    ok: false,
    json: async () => ({ error: "语义搜索暂不可用，请联系管理员检查配置。" }),
  });
  await submitSearch();
  expect(container.textContent).not.toContain("原关键词结果");
  await settle();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("语义搜索暂不可用");
  expect(container.textContent).not.toContain("没有匹配的试题");
  fetcher.mockResolvedValueOnce({
    ok: true,
    json: async () => results({ warning: "部分题目尚未建立索引。" }),
  });
  await click("重新查询");
  await settle();
  expect(container.textContent).toContain("原关键词结果");
  expect(container.textContent).toContain("部分题目尚未建立索引");
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(new URL(fetcher.mock.calls.at(-1)![0], "http://localhost").searchParams.get("q")).toBe(
    "抛物线与坐标轴的交点",
  );
});

it("preserves the saved embedding secret and shows queued indexing until the background work completes", async () => {
  const notify = vi.fn();
  const configuration: AdminSearchConfiguration = {
    embedding: {
      name: "题意模型",
      apiType: "openai",
      baseURL: "https://embedding.example/v1",
      model: "embedding-model",
      dimensions: 768,
      enabled: true,
      hasApiKey: true,
      version: "v1",
    },
    searchIndex: { total: 8, indexed: 0, pending: 0, failed: 0, enabled: true },
  };
  vi.mocked(apiRequest).mockImplementation(async (_url, init) => {
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      if (body.type === "embedding.reindex") {
        configuration.searchIndex.pending = 8;
        return { queued: 8 } as never;
      }
      return {} as never;
    }
    return structuredClone(configuration) as never;
  });
  await act(async () => root.render(<EmbeddingSettings notify={notify} />));
  await click("编辑向量化配置");
  expect(container.querySelector<HTMLInputElement>('input[name="apiKey"]')!.value).toBe("");
  await act(async () => {
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  const saved = vi.mocked(apiRequest).mock.calls.find(([, init]) => init?.method === "POST")![1]!;
  expect(JSON.parse(String(saved.body))).toMatchObject({
    type: "embedding.save",
    embedding: { dimensions: 768, enabled: true },
  });
  expect(JSON.parse(String(saved.body)).embedding).not.toHaveProperty("apiKey");
  await click("重建题目索引");
  expect(notify).toHaveBeenLastCalledWith("已安排 8 道题重新索引，后台将逐题处理。");
  expect(container.textContent).toContain("8 道待处理");
  expect(
    Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent === "正在建立索引…",
    )?.disabled,
  ).toBe(true);
  configuration.searchIndex = { ...configuration.searchIndex, pending: 0, indexed: 8 };
  await act(async () => vi.advanceTimersByTimeAsync(3000));
  expect(container.textContent).toContain("8 / 8 道题");
  expect(
    Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent === "重建题目索引",
    )?.disabled,
  ).toBe(false);
});
