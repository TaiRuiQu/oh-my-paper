// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QuestionAnalysisPage } from "@/components/platform/question-pages";
import type { QuestionStatistics } from "@/contracts/platform";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/platform/ai", () => ({ PlatformAI: () => null }));

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn<typeof fetch>();
const statistics: QuestionStatistics = {
  total: 3,
  subjects: { 数学: 3 },
  types: { SINGLE: 3 },
  missingAnswers: 1,
  missingExplanations: 2,
  tags: [{ tag: "函数", count: 3, subjects: ["数学"], difficulty: 0.5 }],
};
function response(stats: QuestionStatistics = statistics) {
  return new Response(JSON.stringify(stats), { status: 200 });
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it.each([false, true])(
  "ends failed loading and lets the teacher retry statistics (knowledge=%s)",
  async (knowledge) => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await act(async () => root.render(<QuestionAnalysisPage knowledge={knowledge} />));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "暂时无法读取题库统计",
    );
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.textContent).not.toContain("Failed to fetch");

    let finish!: (value: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toBe("正在统计题库…");
    expect(container.querySelector("button")).toBeNull();
    await act(async () => finish(response()));
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.textContent).toContain(knowledge ? "函数" : "题目总量");
  },
);

it("provides recovery for HTTP errors as well as network errors", async () => {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify({ error: "统计服务暂不可用" }), { status: 503 }),
  );
  await act(async () => root.render(<QuestionAnalysisPage />));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("重新统计");
  expect(container.querySelector('[role="status"]')).toBeNull();
});

it.each([false, true])("distinguishes an empty question bank (knowledge=%s)", async (knowledge) => {
  fetchMock.mockResolvedValueOnce(
    response({ ...statistics, total: 0, subjects: {}, types: {}, tags: [] }),
  );
  await act(async () => root.render(<QuestionAnalysisPage knowledge={knowledge} />));
  expect(container.textContent).toContain("题库中还没有试题");
  expect(container.querySelector('a[href="/questions/new"]')).not.toBeNull();
  expect(container.querySelector('a[href="/questions/import"]')).not.toBeNull();
  expect(container.querySelector('[role="status"], [role="alert"]')).toBeNull();
});

it("aborts a departed page's request and ignores its late response", async () => {
  let finish!: (value: Response) => void;
  fetchMock.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => root.render(<QuestionAnalysisPage key="departed" />));
  const signal = fetchMock.mock.calls[0][1]?.signal;
  expect(signal?.aborted).toBe(false);
  fetchMock.mockResolvedValueOnce(response());
  await act(async () => root.render(<QuestionAnalysisPage key="current" knowledge />));
  expect(signal?.aborted).toBe(true);
  expect(container.textContent).toContain("函数");
  await act(async () => finish(response({ ...statistics, total: 0, tags: [] })));
  expect(container.textContent).toContain("函数");
  expect(container.textContent).not.toContain("题库中还没有试题");
});
