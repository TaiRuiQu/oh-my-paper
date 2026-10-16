// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BankQuestion, PlatformCommand } from "@/contracts/platform";
import { QuestionEditor } from "@/components/platform/questions";
import { QuestionDetailPage, QuestionEditPage } from "@/components/platform/question-pages";
import { apiRequest } from "@/lib/http-client";

const { push, mutate } = vi.hoisted(() => ({ push: vi.fn(), mutate: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/components/platform/domain-provider", () => ({
  useDomain: () => ({ state: { papers: [] }, mutate, pending: false }),
}));
vi.mock("@/components/platform/ai", () => ({ PlatformAI: () => null }));
vi.mock("@/lib/http-client", () => ({ apiRequest: vi.fn() }));

let container: HTMLDivElement, root: Root;
const question: BankQuestion = {
  id: "question-1",
  ownerId: "teacher",
  subject: "数学",
  grade: "高中一年级",
  type: "MIXED",
  difficulty: 0.5,
  knowledgeTags: [],
  createdAt: "",
  updatedAt: "",
  content: {
    stem: "阅读材料后回答",
    options: [],
    answers: [],
    explanation: "",
    rubric: "",
    images: [],
    parts: [
      {
        id: "part-1",
        type: "SUBJECTIVE",
        stem: "说明原因",
        options: [],
        answers: ["理由"],
        explanation: "",
        rubric: "",
        knowledgeTags: [],
        score: 5,
      },
    ],
  },
};
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  mutate.mockResolvedValue({ id: "created" });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function render(node: ReactNode) {
  await act(async () => root.render(node));
}
async function click(text: string) {
  await act(async () =>
    [...container.querySelectorAll("button")].find((b) => b.textContent === text)!.click(),
  );
}
async function fillStem(value = "新题干") {
  const stem = container.querySelector<HTMLTextAreaElement>("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(stem, value);
    stem.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit() {
  await act(async () => {
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
function editor(close = vi.fn(), initial: BankQuestion | null = null) {
  return <QuestionEditor question={initial} mutate={mutate} pending={false} close={close} />;
}
function savedQuestion() {
  const command = mutate.mock.calls[0][0] as PlatformCommand;
  if (command.type !== "question.save") throw new Error("Expected question.save");
  return command.question;
}

it.each([0, 0.43, 0.123456789, 1])(
  "preserves the valid difficulty %s when saving another edit through native form validation",
  async (difficulty) => {
    await render(editor(vi.fn(), { ...question, difficulty }));
    await fillStem("只修改题干，保留原难度");
    const input = container.querySelector<HTMLInputElement>('input[name="difficulty"]')!;
    expect(input.validity.stepMismatch).toBe(false);
    expect(container.querySelector("form")!.checkValidity()).toBe(true);
    await act(async () =>
      container.querySelector<HTMLButtonElement>('button[type="submit"]')!.click(),
    );
    expect(mutate).toHaveBeenCalledOnce();
    expect(savedQuestion()).toMatchObject({
      difficulty,
      content: { stem: "只修改题干，保留原难度" },
    });
  },
);

it.each(["-0.01", "1.01", ""])(
  "rejects the invalid difficulty %j through native form validation",
  async (difficulty) => {
    await render(editor(vi.fn(), question));
    const input = container.querySelector<HTMLInputElement>('input[name="difficulty"]')!;
    input.value = difficulty;
    expect(input.checkValidity()).toBe(false);
    await act(async () =>
      container.querySelector<HTMLButtonElement>('button[type="submit"]')!.click(),
    );
    expect(mutate).not.toHaveBeenCalled();
  },
);

it("protects edited questions on cancel and closes an unchanged form without confirmation", async () => {
  const close = vi.fn(),
    confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  await render(editor(close));
  await click("取消");
  expect(close).toHaveBeenCalledOnce();
  expect(confirm).not.toHaveBeenCalled();
  close.mockClear();
  await fillStem();
  await click("关闭编辑");
  expect(close).not.toHaveBeenCalled();
  expect(confirm).toHaveBeenCalledWith("有未保存的试题修改，离开后会丢失。确定离开？");
  expect(container.querySelector("textarea")!.value).toBe("新题干");
  confirm.mockReturnValue(true);
  await click("取消");
  expect(close).toHaveBeenCalledOnce();
});

it("confirms removing mixed subquestions and saves only the selected type's content", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  await render(editor(vi.fn(), question));
  const select = [...container.querySelectorAll("select")].find((s) =>
    [...s.options].some((o) => o.value === "MIXED"),
  )!;
  async function changeType() {
    await act(async () => {
      select.value = "SUBJECTIVE";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
  await changeType();
  expect(select.value).toBe("MIXED");
  expect(container.textContent).toContain("第 1 小问");
  confirm.mockReturnValue(true);
  await changeType();
  expect(container.textContent).not.toContain("第 1 小问");
  await submit();
  expect(savedQuestion()).toMatchObject({
    type: "SUBJECTIVE",
    content: { parts: [], options: [] },
  });
});

it("waits for selected images before saving and includes the completed upload", async () => {
  let finish!: (value: { url: string }) => void;
  vi.mocked(apiRequest).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve as typeof finish;
      }),
  );
  await render(editor());
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", {
    value: [new File(["image"], "material.png", { type: "image/png" })],
  });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  expect(container.textContent).toContain("配图上传完成后可保存");
  await submit();
  expect(mutate).not.toHaveBeenCalled();
  await act(async () => finish({ url: "/api/assets/material.png" }));
  await submit();
  expect(savedQuestion().content.images).toEqual(["/api/assets/material.png"]);
});

it("keeps a failed image available for retry or explicit removal before saving", async () => {
  vi.mocked(apiRequest).mockRejectedValue(new Error("上传中断"));
  await render(editor());
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", {
    value: [new File(["image"], "material.png", { type: "image/png" })],
  });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  expect(container.textContent).toContain("上传中断");
  await submit();
  expect(mutate).not.toHaveBeenCalled();
  await click("重试上传");
  expect(apiRequest).toHaveBeenCalledTimes(2);
  await click("移除所选配图");
  await submit();
  expect(mutate).toHaveBeenCalledOnce();
});

it("navigates exactly once to the created question and prevents repeated creates", async () => {
  const confirm = vi.spyOn(window, "confirm");
  await render(<QuestionEditPage />);
  await fillStem();
  await submit();
  expect(push.mock.calls).toEqual([["/questions/created"]]);
  expect(confirm).not.toHaveBeenCalled();
  await submit();
  expect(mutate).toHaveBeenCalledOnce();
});

it("prevents concurrent submissions and keeps failed content editable for retry", async () => {
  let finish!: (value: { error: string }) => void;
  mutate.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render(editor());
  await fillStem("需要保留的完整题干");
  await submit();
  expect(container.querySelector("form")?.hasAttribute("inert")).toBe(true);
  expect(container.querySelector("form")?.getAttribute("aria-busy")).toBe("true");
  expect(container.textContent).toContain("正在保存试题，暂时不能编辑");
  expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  expect(savedQuestion()).toMatchObject({
    subject: "数学",
    grade: "高中一年级",
    difficulty: 0.5,
    content: { stem: "需要保留的完整题干" },
  });
  await submit();
  expect(mutate).toHaveBeenCalledOnce();
  await act(async () => finish({ error: "网络中断，请重试" }));
  expect(container.textContent).toContain("网络中断，请重试");
  expect(container.querySelector("textarea")!.value).toBe("需要保留的完整题干");
  expect(container.querySelector("form")?.hasAttribute("inert")).toBe(false);
  expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
  await submit();
  expect(mutate).toHaveBeenCalledTimes(2);
});

it.each(["detail", "edit"])(
  "offers recovery after a %s request fails and keeps its route",
  async (page) => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ question }) });
    vi.stubGlobal("fetch", fetch);
    await render(
      page === "detail" ? (
        <QuestionDetailPage id={question.id} />
      ) : (
        <QuestionEditPage id={question.id} />
      ),
    );
    expect(container.textContent).toContain("试题加载失败");
    expect(container.textContent).not.toContain("内容不存在或无权访问");
    await click("重新加载");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain(page === "detail" ? question.content.stem : "编辑试题");
    expect(push).not.toHaveBeenCalled();
  },
);

it("distinguishes forbidden access from an unavailable request", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: "Forbidden" }) }),
  );
  await render(<QuestionDetailPage id={question.id} />);
  expect(container.textContent).toContain("无权访问此试题");
  expect(container.textContent).not.toContain("检查网络连接");
});
