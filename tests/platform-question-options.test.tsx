// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QuestionEditor } from "@/components/platform/questions";
import type { BankQuestion, PlatformCommand } from "@/contracts/platform";

let container: HTMLDivElement, root: Root;
const mutate = vi.fn<(command: PlatformCommand) => Promise<{ id: string }>>(async () => ({
  id: "saved",
}));
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mutate.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(question: BankQuestion | null = null) {
  await act(async () =>
    root.render(
      <QuestionEditor question={question} mutate={mutate} pending={false} close={() => {}} />,
    ),
  );
}
async function fill(element: HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      element,
      value,
    );
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function click(element: HTMLElement) {
  await act(async () => element.click());
}
async function save() {
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  const command = mutate.mock.calls[0][0];
  if (command.type !== "question.save") throw new Error("Expected a saved question");
  return command.question;
}

it("starts with four labeled fields, keeps line breaks inside an option, and adds options directly", async () => {
  await render();
  const editor = container.querySelector("fieldset")!;
  expect(editor.querySelectorAll("textarea")).toHaveLength(4);
  expect(editor.textContent).toContain("选项 A");
  expect(editor.textContent).not.toContain("每行一个");
  await fill(editor.querySelector("textarea")!, "第一段\n第二段");
  await click(
    [...editor.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("添加选项"),
    )!,
  );
  expect(editor.querySelectorAll("textarea")).toHaveLength(5);
  expect(editor.textContent).toContain("选项 E");
  const question = await save();
  expect(question.content.options[0]).toEqual({ label: "A", text: "第一段\n第二段" });
});

it("renumbers remaining choices and follows the selected answer when a preceding choice is removed", async () => {
  await render();
  const editor = container.querySelector("fieldset")!;
  await fill(editor.querySelectorAll("textarea")[2], "正确内容");
  await click(editor.querySelector('input[value="C"]')!);
  await click(editor.querySelector('[aria-label="删除选项 A"]')!);
  expect(editor.querySelectorAll("textarea")).toHaveLength(3);
  expect(editor.querySelector<HTMLInputElement>('input[value="B"]')!.checked).toBe(true);
  await click(editor.querySelector('[aria-label="删除选项 C"]')!);
  expect(
    [...editor.querySelectorAll<HTMLButtonElement>('button[aria-label^="删除"]')].every(
      (button) => button.disabled,
    ),
  ).toBe(true);
  const question = await save();
  expect(question.content.options).toEqual([
    { label: "A", text: "" },
    { label: "B", text: "正确内容" },
  ]);
  expect(question.content.answers).toEqual(["B"]);
});

it("supports several correct answers and clears an answer when its option is deleted", async () => {
  await render();
  const type = [...container.querySelectorAll("select")].find((select) =>
    [...select.options].some((option) => option.value === "MULTIPLE"),
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(
      type,
      "MULTIPLE",
    );
    type.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const editor = container.querySelector("fieldset")!;
  await click(editor.querySelector('input[value="A"]')!);
  await click(editor.querySelector('input[value="C"]')!);
  await click(editor.querySelector('[aria-label="删除选项 A"]')!);
  const question = await save();
  expect(question.content.answers).toEqual(["B"]);
});

it("keeps correct-answer selections independent across choice subquestions", async () => {
  await render({
    id: "mixed",
    ownerId: "teacher",
    subject: "数学",
    grade: "高中一年级",
    type: "MIXED",
    difficulty: 0.5,
    knowledgeTags: [],
    createdAt: "",
    updatedAt: "",
    content: {
      stem: "阅读材料后回答问题",
      options: [],
      answers: [],
      explanation: "",
      rubric: "",
      images: [],
      parts: [1, 2].map((number) => ({
        id: String(number),
        type: "SINGLE",
        stem: `第 ${number} 问`,
        options: [
          { label: "A", text: "第一项" },
          { label: "B", text: "第二项" },
        ],
        answers: [],
        explanation: "",
        rubric: "",
        knowledgeTags: [],
        score: 5,
      })),
    },
  });
  const editors = container.querySelectorAll("fieldset");
  await click(editors[0].querySelector('input[value="A"]')!);
  await click(editors[1].querySelector('input[value="B"]')!);
  expect(editors[0].querySelector<HTMLInputElement>('input[value="A"]')!.checked).toBe(true);
  const question = await save();
  expect(question.content.parts.map((part) => part.answers)).toEqual([["A"], ["B"]]);
});

it("keeps multiline answers and punctuation inside separate rows, including empty blank positions", async () => {
  await render();
  const type = [...container.querySelectorAll("select")].find((select) =>
    [...select.options].some((option) => option.value === "BLANK"),
  )!;
  await act(async () => {
    type.value = "BLANK";
    type.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const group = (label: string) =>
    [...container.querySelectorAll<HTMLElement>('[role="group"]')].find(
      (node) =>
        document.getElementById(node.getAttribute("aria-labelledby")!)?.textContent === label,
    )!;
  const answers = group("各空标准答案");
  const addAnswer = () =>
    [...answers.querySelectorAll("button")].find((b) => b.textContent === "添加填空答案")!;
  await click(addAnswer());
  await fill(answers.querySelector("textarea")!, "第一步，计算\n第二步，化简");
  await click(addAnswer());
  await click(addAnswer());
  await fill(answers.querySelectorAll("textarea")[2], "第三空");
  const tags = group("知识点");
  await click([...tags.querySelectorAll("button")].find((b) => b.textContent === "添加知识点")!);
  const tag = tags.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      tag,
      "函数，定义域",
    );
    tag.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(mutate).not.toHaveBeenCalled();
  const question = await save();
  expect(question.content.answers).toEqual(["第一步，计算\n第二步，化简", "", "第三空"]);
  expect(question.knowledgeTags).toEqual(["函数，定义域"]);
});
