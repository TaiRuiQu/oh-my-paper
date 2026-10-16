// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BankQuestion } from "@/contracts/platform";
import { teachingCommandSchema, type TeachingSession } from "@/contracts/teaching";
import { PlanEditor, blankPlan } from "@/components/teaching/plan";
const mocks = vi.hoisted(() => ({ execute: vi.fn(), question: null as BankQuestion | null }));
vi.mock("@/components/teaching/provider", () => ({
  useTeaching: () => ({
    pending: false,
    stale: false,
    session: { canPrepare: true },
    execute: mocks.execute,
    refresh: vi.fn(),
  }),
}));
vi.mock("@/components/platform/question-bank-picker", () => ({
  QuestionBankPicker: ({
    open,
    onImport,
    onOpenChange,
  }: {
    open: boolean;
    onImport: (q: BankQuestion) => void;
    onOpenChange: (open: boolean) => void;
  }) =>
    open ? (
      <button
        onClick={() => {
          onImport(mocks.question!);
          onOpenChange(false);
        }}
      >
        导入完整题目
      </button>
    ) : null,
}));
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  mocks.execute.mockImplementation(async (command) => {
    teachingCommandSchema.parse(command);
    return { ok: true };
  });
  mocks.question = {
    id: "question",
    subject: "数学",
    grade: "高一",
    type: "SUBJECTIVE",
    updatedAt: "2026-10-15T00:00:00Z",
    content: {
      stem: "题干",
      answers: ["完整答案"],
      rubric: "保留评分依据",
      explanation: "完整解析",
      images: [],
      options: [],
      parts: [],
    },
  } as unknown as BankQuestion;
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
async function render() {
  const plan = {
    ...blankPlan(),
    title: "原教案",
    objectives: "教学目标",
    materials: [
      { id: "original", title: "原有材料", kind: "TEXT" as const, content: "教师已有内容" },
    ],
  };
  const session = {
    id: "session",
    version: 2,
    planVersion: 1,
    bindingVersion: 1,
    plan: { plan },
  } as unknown as TeachingSession;
  await act(async () => root.render(<PlanEditor session={session} close={() => {}} />));
  const title = host.querySelector<HTMLInputElement>("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      title,
      "保留本地修改",
    );
    title.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function click(text: string) {
  await act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === text)!.click(),
  );
}
function snapshot() {
  const q = mocks.question!;
  return JSON.stringify({
    source: "QUESTION_SNAPSHOT",
    questionId: q.id,
    updatedAt: q.updatedAt,
    type: q.type,
    subject: q.subject,
    grade: q.grade,
    content: q.content,
  });
}

it.each(["stem", "rubric"] as const)(
  "rejects a full snapshot with oversized %s while preserving an otherwise savable draft",
  async (field) => {
    mocks.question!.content[field] = "长".repeat(21000);
    await render();
    await click("从题库选取材料");
    await click("导入完整题目");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("20000 字符");
    expect(host.textContent).toContain("未加入教案");
    expect(host.textContent).not.toContain("材料 2");
    await click("保存教案草稿");
    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(mocks.execute.mock.calls[0][0].plan).toMatchObject({
      title: "保留本地修改",
      materials: [{ id: "original", content: "教师已有内容" }],
    });
    expect(mocks.question!.content[field]).toHaveLength(21000);
  },
);

it("accepts the complete schema boundary without truncating the frozen question, answer, or rubric", async () => {
  mocks.question!.content.stem = "";
  mocks.question!.content.stem = "题".repeat(20000 - snapshot().length);
  const expectedSnapshot = snapshot();
  expect(expectedSnapshot).toHaveLength(20000);
  await render();
  await click("从题库选取材料");
  await click("导入完整题目");
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.textContent).toContain("材料 2");
  await click("保存教案草稿");
  const saved = mocks.execute.mock.calls[0][0].plan.materials[1];
  expect(saved.content).toBe(expectedSnapshot);
  expect(JSON.parse(saved.content).content).toMatchObject({
    answers: ["完整答案"],
    rubric: "保留评分依据",
    explanation: "完整解析",
  });
});
