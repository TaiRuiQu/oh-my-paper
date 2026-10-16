// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BankQuestion, Paper, PlatformCommand } from "@/contracts/platform";
import { PaperEditorPage } from "@/components/platform/paper-pages";
import { DOCUMENT_DEFAULTS } from "@/lib/document-layout";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  mutate: vi.fn(),
  assessments: [] as { papers: { paperId: string }[] }[],
  papers: [] as Paper[],
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/components/platform/domain-provider", () => ({
  useDomain: () => ({
    state: { papers: mocks.papers, assessments: mocks.assessments },
    pending: false,
    mutate: mocks.mutate,
  }),
}));

const question: BankQuestion = {
  id: "question",
  ownerId: "teacher",
  subject: "数学",
  grade: "高中一年级",
  type: "SUBJECTIVE",
  difficulty: 0.5,
  knowledgeTags: [],
  createdAt: "",
  updatedAt: "",
  content: {
    stem: "原题干",
    options: [],
    answers: ["原答案"],
    explanation: "原解析",
    rubric: "原评分标准",
    images: [],
    parts: [],
  },
};
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { ready: Promise.resolve(), addEventListener: vi.fn(), removeEventListener: vi.fn() },
  });
  mocks.assessments = [];
  mocks.papers = [
    {
      id: "paper",
      ownerId: "teacher",
      name: "数学试卷",
      subject: "数学",
      grade: "高中一年级",
      kind: "EXAM",
      instructions: "原说明",
      layout: {
        ...DOCUMENT_DEFAULTS,
        textBlocks: [{ id: "text", text: "原自由文字" }],
      },
      items: [
        {
          id: "item",
          questionId: question.id,
          position: 0,
          score: 5,
          section: "解答题",
          snapshot: question,
        },
      ],
      createdAt: "",
      updatedAt: "",
    },
  ];
  mocks.mutate.mockResolvedValue({ id: "saved" });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function render(view: "edit" | "answers" | "layout" = "edit") {
  await act(async () => root.render(<PaperEditorPage id="paper" view={view} />));
}
async function submit() {
  await act(async () => {
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
function paperCommand() {
  const command = mocks.mutate.mock.calls[0][0] as PlatformCommand;
  if (command.type !== "paper.save") throw new Error("Expected paper.save");
  return command.paper;
}

it.each(["edit", "answers", "layout"] as const)(
  "freezes the %s workbench during saving, then restores the draft after failure",
  async (view) => {
    let finish!: (value: { error: string }) => void;
    mocks.mutate.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await render(view);
    const name = container.querySelector<HTMLElement>('.p-document-pages [aria-label="试卷名称"]')!;
    await act(async () => {
      name.innerText = "尚未保存的新标题";
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await submit();
    const form = container.querySelector("form")!;
    expect(form.hasAttribute("inert")).toBe(true);
    expect(form.getAttribute("aria-busy")).toBe("true");
    expect(container.textContent).toContain("正在保存试卷，暂时不能编辑");
    expect(form.querySelector('[contenteditable="plaintext-only"]')).toBeNull();
    expect(form.querySelector('button[type="submit"]')?.hasAttribute("disabled")).toBe(true);
    expect(paperCommand()).toMatchObject({
      name: "尚未保存的新标题",
      items: [{ score: 5, content: { stem: "原题干", answers: ["原答案"] } }],
    });
    await submit();
    expect(mocks.mutate).toHaveBeenCalledOnce();
    await act(async () => finish({ error: "保存失败" }));
    expect(form.hasAttribute("inert")).toBe(false);
    expect(form.querySelector('[contenteditable="plaintext-only"]')).not.toBeNull();
    expect(container.textContent).toContain("有未保存的修改");
    expect(mocks.push).not.toHaveBeenCalled();
    await submit();
    expect(mocks.mutate).toHaveBeenCalledTimes(2);
    expect(mocks.mutate.mock.calls[1][0].paper.name).toBe("尚未保存的新标题");
    expect(mocks.push).toHaveBeenCalledWith("/exams/papers/saved");
  },
);

it.each([false, true])(
  "keeps saved originals and new versions locked until navigation (used=%s)",
  async (used) => {
    if (used) mocks.assessments = [{ papers: [{ paperId: "paper" }] }];
    await render();
    await submit();
    expect(paperCommand().id).toBe(used ? undefined : "paper");
    expect(container.querySelector("form")?.hasAttribute("inert")).toBe(true);
    await submit();
    expect(mocks.mutate).toHaveBeenCalledOnce();
    expect(mocks.push).toHaveBeenCalledOnce();
  },
);

it("unlocks a rejected save without discarding the edited draft", async () => {
  mocks.mutate.mockRejectedValueOnce(new Error("请求中断"));
  await render();
  await submit();
  expect(container.querySelector("form")?.hasAttribute("inert")).toBe(false);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("请求中断");
  expect(mocks.push).not.toHaveBeenCalled();
});

it("uses the same saving lock for the separate copy action", async () => {
  let finish!: (value: { id: string }) => void;
  mocks.mutate.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render();
  const copy = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "另存一份",
  )!;
  await act(async () => copy.click());
  expect(container.querySelector("form")?.hasAttribute("inert")).toBe(true);
  expect(paperCommand()).toMatchObject({ id: undefined, name: "数学试卷（副本）" });
  await act(async () => copy.click());
  await submit();
  expect(mocks.mutate).toHaveBeenCalledOnce();
  await act(async () => finish({ id: "copy" }));
  expect(mocks.push).toHaveBeenCalledWith("/exams/papers/copy");
});
