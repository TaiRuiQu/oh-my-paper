// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BankQuestion } from "@/contracts/platform";
import { QuestionListPage, QuestionDetailPage } from "@/components/platform/question-pages";
import { QuestionBankPicker } from "@/components/platform/question-bank-picker";
import {
  QuestionMaterialGallery,
  QuestionMaterialSummary,
} from "@/components/platform/question-materials";
import { MarkdownText } from "@/components/markdown-text";

vi.mock("@/components/platform/domain-provider", () => ({
  useDomain: () => ({ state: { papers: [] } }),
}));
vi.mock("@/components/platform/ai", () => ({ PlatformAI: () => null }));
const url = (index: number) =>
  `/api/platform/assets/00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const question = (images = [url(1), url(2)]): BankQuestion => ({
  id: "question",
  ownerId: "teacher",
  subject: "数学",
  grade: "高中一年级",
  type: "SUBJECTIVE",
  difficulty: 0.43,
  knowledgeTags: [],
  createdAt: "2026-10-15T00:00:00Z",
  updatedAt: "2026-10-15T00:00:00Z",
  content: {
    stem: "根据图像判断函数性质",
    images,
    options: [],
    answers: [],
    explanation: "",
    rubric: "",
    parts: [],
  },
});
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.useFakeTimers();
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
  vi.restoreAllMocks();
});
async function render(node: ReactNode) {
  await act(async () => root.render(node));
}
async function settle() {
  await act(async () => vi.advanceTimersByTimeAsync(200));
}
async function click(text: string, parent: ParentNode = container) {
  const button = [...parent.querySelectorAll("button")].find((entry) => entry.textContent === text);
  expect(button, text).toBeTruthy();
  await act(async () => button!.click());
}
function fetchQuestions(q = question()) {
  const fetch = vi.fn().mockImplementation(async (request: string) => ({
    ok: true,
    json: async () =>
      request.includes("?id=")
        ? { question: q }
        : { questions: [q], total: 1, page: 1, pageSize: 20 },
  }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
const imagePath = (image: HTMLImageElement) => new URL(image.src, window.location.href).pathname;

it("makes all image materials discoverable in the list without initially requesting any original image", async () => {
  fetchQuestions(question(Array.from({ length: 20 }, (_, index) => url(index))));
  await render(<QuestionListPage />);
  await settle();
  expect(container.textContent).toContain("图像材料 · 20 张");
  expect(container.querySelector("img")).toBeNull();
  expect(
    container.querySelector('a[href="/questions/question#question-materials"]')?.textContent,
  ).toBe("查看全部材料（20 张）");
  await click("预览首张材料");
  const image = container.querySelector("img")!;
  expect(container.querySelectorAll("img")).toHaveLength(1);
  expect(imagePath(image)).toBe(url(0));
  expect(image.getAttribute("loading")).toBe("lazy");
  expect(image.getAttribute("decoding")).toBe("async");
  expect(image.getAttribute("srcset")).toBeNull();
  expect(image.getAttribute("alt")).toContain("未提供文字描述");
  expect(container.querySelector('button[aria-expanded="true"]')).not.toBeNull();
  await click("收起材料预览");
  expect(container.querySelector("img")).toBeNull();
});
it("renders every material in detail in the same order and gives the list link a real target", async () => {
  fetchQuestions();
  await render(<QuestionDetailPage id="question" />);
  expect(container.querySelector('#question-materials[aria-label="题目图像材料"]')).not.toBeNull();
  expect([...container.querySelectorAll("img")].map(imagePath)).toEqual([url(1), url(2)]);
  expect(container.textContent).toContain("图像材料（2 张）");
  const originals = [...container.querySelectorAll<HTMLAnchorElement>('a[target="_blank"]')];
  expect(originals.map((link) => link.getAttribute("href"))).toEqual([url(1), url(2)]);
  expect(originals.every((link) => link.rel === "noreferrer")).toBe(true);
});
it("leaves text-only questions free of empty material sections and preview controls", async () => {
  fetchQuestions(question([]));
  await render(<QuestionListPage />);
  await settle();
  expect(container.textContent).not.toContain("图像材料");
  expect(container.querySelector("img")).toBeNull();
  await render(<QuestionMaterialGallery images={[]} />);
  expect(container.innerHTML).toBe("");
});
it("allows retrying a failed private image without losing other materials or offering an unprotected proxy", async () => {
  await render(<QuestionMaterialGallery images={[url(1), url(2)]} />);
  const image = container.querySelector("img")!;
  await act(async () => image.dispatchEvent(new Event("error")));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("检查网络或访问权限");
  expect(container.querySelectorAll("img")).toHaveLength(1);
  await click("重试材料 1");
  expect([...container.querySelectorAll("img")].map(imagePath)).toEqual([url(1), url(2)]);
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.innerHTML).not.toContain("/_next/image");
});
it.each(["https://outside.invalid/tracker.png", "javascript:alert(1)"])(
  "explains an invalid image reference without loading or linking it: %s",
  async (invalid) => {
    await render(<QuestionMaterialGallery images={[invalid]} />);
    expect(container.textContent).toContain("材料引用无效");
    expect(container.querySelector("img,a")).toBeNull();
    expect(container.textContent).toContain("图像材料（1 张）");
  },
);
it("uses a text material link for inline markdown in list mode while preserving its default rendering", async () => {
  const text = `参照下图：![函数图像](${url(1)})\n\n![第二张图](${url(2)})`;
  await render(<MarkdownText text={text} imageHref="/questions/question" />);
  expect(container.querySelector("img")).toBeNull();
  expect([...container.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toEqual([
    "/questions/question",
    "/questions/question",
  ]);
  expect(container.textContent).toContain("函数图像（在试题详情查看）");
  await render(<MarkdownText text={text} />);
  expect(container.querySelectorAll("img")).toHaveLength(2);
});
it("keeps a real list row free of automatic inline image downloads as well as attached image downloads", async () => {
  const q = question();
  q.content.stem = `参照图像 ![图像说明](${url(1)})`;
  fetchQuestions(q);
  await render(<QuestionListPage />);
  await settle();
  expect(container.querySelector("img")).toBeNull();
  expect(container.textContent).toContain("图像说明（在试题详情查看）");
  expect(container.textContent).toContain("图像材料 · 2 张");
});
it("keeps material previews available in the picker and imports the complete original question", async () => {
  const q = question(),
    onImport = vi.fn();
  fetchQuestions(q);
  await render(
    <QuestionBankPicker
      open
      onOpenChange={() => {}}
      subject="数学"
      usedIds={[]}
      onImport={onImport}
    />,
  );
  await settle();
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("图像材料 · 2 张");
  expect(dialog.querySelector("img")).toBeNull();
  await click("预览首张材料", dialog);
  expect(dialog.querySelectorAll("img")).toHaveLength(1);
  await click("导入本题", dialog);
  expect(onImport).toHaveBeenCalledWith(q);
  expect(onImport.mock.calls[0][0].content.images).toEqual([url(1), url(2)]);
});
it("resets a failed preview when the question's first image is replaced", async () => {
  await render(<QuestionMaterialSummary images={[url(1)]} detailHref="/questions/question" />);
  await click("预览首张材料");
  await act(async () => container.querySelector("img")!.dispatchEvent(new Event("error")));
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  await render(<QuestionMaterialSummary images={[url(2)]} detailHref="/questions/question" />);
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(imagePath(container.querySelector("img")!)).toBe(url(2));
});
