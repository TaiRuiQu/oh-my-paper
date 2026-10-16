// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PlatformState, Review, ScanSubmission } from "@/contracts/platform";
import { SubmissionReview } from "@/components/platform/reviews";

vi.mock("@/components/platform/questions", () => ({ QuestionBody: () => null }));
const submission = {
  id: "submission",
  assessmentId: "exam",
  paperId: "paper",
  studentId: "student",
  status: "REVIEW",
  answers: [],
  sourceFiles: [],
  alignment: null,
} as unknown as ScanSubmission;
function saved(score: number, source: "AI" | "HUMAN" = "HUMAN"): Review {
  return {
    id: "own-first",
    version: 1,
    submissionId: "submission",
    itemId: "item",
    reviewerId: "teacher",
    round: "FIRST",
    score,
    source,
    feedback: `外部反馈${score}`,
    createdAt: "2026-10-15T00:00:00.000Z",
    partScores: [
      { partId: "p1", score: score - 4, feedback: `第一问反馈${score}` },
      { partId: "p2", score: 4, feedback: "第二问反馈" },
    ],
  };
}
function stateFor(ownReview: Review | undefined, mixed: boolean): PlatformState {
  return {
    actor: { id: "teacher", role: "TEACHER" },
    users: [],
    reviews: ownReview ? [ownReview] : [],
    papers: [
      {
        id: "paper",
        items: [
          {
            id: "item",
            score: 10,
            snapshot: {
              type: mixed ? "MIXED" : "SUBJECTIVE",
              content: {
                stem: "计算",
                answers: [],
                options: [],
                images: [],
                rubric: "",
                parts: mixed
                  ? ["p1", "p2"].map((id) => ({
                      id,
                      type: "SUBJECTIVE",
                      stem: "小问",
                      score: 5,
                      answers: [],
                      options: [],
                      rubric: "",
                    }))
                  : [],
              },
            },
          },
        ],
      },
    ],
    assessments: [
      {
        id: "exam",
        rosterRevision: 1,
        rosterStatus: "CONFIRMED",
        participants: [
          {
            id: "participant",
            studentId: "student",
            classroomId: "class",
            classroomName: "测试班级",
            name: "学生",
            studentNumber: "123456",
            stage: "高中",
            cohort: "2027届",
            subjects: [{ paperId: "paper", status: "REQUIRED", reason: "" }],
          },
        ],
        published: false,
        papers: [{ paperId: "paper", gradingMode: "DOUBLE", arbitrationThreshold: 2 }],
      },
    ],
    analytics: { results: [] },
  } as unknown as PlatformState;
}
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});
async function render(ownReview?: Review, mixed = false, mutate = vi.fn()) {
  await act(async () =>
    root.render(
      <SubmissionReview
        submission={submission}
        state={stateFor(ownReview, mixed)}
        mutate={mutate}
        pending={false}
      />,
    ),
  );
}
async function input(selector: string, value: string) {
  await act(async () => {
    const element = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
    const prototype =
      element instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function assertDirty(expected: boolean) {
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(expected);
}

it("adopts a newly arrived AI first-review suggestion in a clean form", async () => {
  await render();
  expect(container.querySelector<HTMLInputElement>('input[name="score"]')!.value).toBe("");
  await render(saved(8, "AI"));
  expect(container.querySelector<HTMLInputElement>('input[name="score"]')!.value).toBe("8");
  expect(container.querySelector<HTMLTextAreaElement>('textarea[name="feedback"]')!.value).toBe(
    "外部反馈8",
  );
  expect(container.textContent).toContain("AI 分数作为建议");
  expect(container.textContent).toContain("本轮评分已提交");
  assertDirty(false);
});

it("adopts another session's updated own review and moves the clean baseline", async () => {
  await render(saved(8));
  await render(saved(6));
  expect(container.querySelector<HTMLInputElement>('input[name="score"]')!.value).toBe("6");
  expect(container.querySelector<HTMLTextAreaElement>('textarea[name="feedback"]')!.value).toBe(
    "外部反馈6",
  );
  assertDirty(false);
  await input('input[name="score"]', "7");
  assertDirty(true);
  await render(saved(6));
  expect(container.querySelector<HTMLInputElement>('input[name="score"]')!.value).toBe("7");
  await input('input[name="score"]', "6");
  assertDirty(false);
});

it("synchronizes compound-question scores and feedback together with the saved baseline", async () => {
  await render(saved(8), true);
  await render(saved(6), true);
  expect(
    [...container.querySelectorAll<HTMLInputElement>('.p-part input[type="number"]')].map(
      (element) => element.value,
    ),
  ).toEqual(["2", "4"]);
  expect(
    [...container.querySelectorAll<HTMLTextAreaElement>(".p-part textarea")].map(
      (element) => element.value,
    ),
  ).toEqual(["第一问反馈6", "第二问反馈"]);
  expect(container.querySelector<HTMLTextAreaElement>('textarea[name="feedback"]')!.value).toBe(
    "外部反馈6",
  );
  expect(container.textContent).toContain("合计 6 / 10 分");
  assertDirty(false);
});

it.each(["new AI", "own update", "AI confirmation"] as const)(
  "preserves a dirty draft when receiving %s",
  async (change) => {
    await render(
      change === "new AI" ? undefined : saved(8, change === "AI confirmation" ? "AI" : "HUMAN"),
    );
    await input('input[name="score"]', "5");
    await input('textarea[name="feedback"]', "本地未提交反馈");
    await render(saved(6, change === "new AI" ? "AI" : "HUMAN"));
    expect(container.querySelector<HTMLInputElement>('input[name="score"]')!.value).toBe("5");
    expect(container.querySelector<HTMLTextAreaElement>('textarea[name="feedback"]')!.value).toBe(
      "本地未提交反馈",
    );
    expect(container.textContent).toContain("本题评分有未提交修改");
    assertDirty(true);
  },
);

it("preserves edited compound-question fields when another session updates them", async () => {
  await render(saved(8), true);
  await input('.p-part input[type="number"]', "3");
  await input(".p-part textarea", "本地小问反馈");
  await render(saved(6), true);
  expect(container.querySelector<HTMLInputElement>('.p-part input[type="number"]')!.value).toBe(
    "3",
  );
  expect(container.querySelector<HTMLTextAreaElement>(".p-part textarea")!.value).toBe(
    "本地小问反馈",
  );
  assertDirty(true);
});

it.each([false, true])(
  "does not replay an external snapshot over an in-flight save (dirty=%s)",
  async (dirty) => {
    let finish!: (result: { id: string }) => void;
    const mutate = vi.fn(
      () =>
        new Promise<{ id: string }>((resolve) => {
          finish = resolve;
        }),
    );
    await render(saved(8), false, mutate);
    if (dirty) await input('input[name="score"]', "5");
    await act(async () =>
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    await render(saved(6), false, mutate);
    expect(container.querySelector<HTMLInputElement>('input[name="score"]')!.value).toBe(
      dirty ? "5" : "8",
    );
    await act(async () => finish({ id: "own-first" }));
    expect(container.querySelector<HTMLInputElement>('input[name="score"]')!.value).toBe(
      dirty ? "5" : "8",
    );
    expect(container.textContent).toContain("本轮评分已提交");
    assertDirty(false);
  },
);
