// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  PlatformState,
  QuestionReviewRule,
  Review,
  ScanSubmission,
} from "@/contracts/platform";
import { reviewRoundAvailability } from "@/lib/review-round-availability";
import { SubmissionReview } from "@/components/platform/reviews";

vi.mock("@/components/platform/questions", () => ({ QuestionBody: () => null }));
const policy: QuestionReviewRule = {
  doubleReview: true,
  arbitrationEnabled: true,
  maxDifference: 2,
};
function review(
  round: Review["round"],
  reviewerId: string,
  score = 8,
  source: "HUMAN" | "AI" = "HUMAN",
): Review {
  return {
    id: round,
    version: 1,
    submissionId: "submission",
    itemId: "item",
    round,
    reviewerId,
    score,
    source,
    feedback: "",
    createdAt: "2026-10-15T00:00:00.000Z",
  };
}
const first = review("FIRST", "A", 8);
const second = review("SECOND", "B", 4);
const arbitration = review("ARBITRATION", "C", 6);

it.each([
  ["single empty", "A", [], { ...policy, doubleReview: false }, ["FIRST"]],
  ["single owner", "A", [first], { ...policy, doubleReview: false }, ["FIRST"]],
  ["single other", "B", [first], { ...policy, doubleReview: false }, []],
  ["double empty", "A", [], policy, ["FIRST", "SECOND"]],
  ["first owner", "A", [first], policy, ["FIRST"]],
  ["second teacher", "B", [first], policy, ["SECOND"]],
  ["AI suggestion owner", "A", [{ ...first, source: "AI" }], policy, ["FIRST"]],
  ["AI suggestion other", "B", [{ ...first, source: "AI" }], policy, ["SECOND"]],
  ["second before first", "A", [second], policy, ["FIRST"]],
  ["second owner", "B", [second], policy, ["SECOND"]],
  ["first participant before arbitration", "A", [first, second], policy, ["FIRST"]],
  ["second participant before arbitration", "B", [first, second], policy, ["SECOND"]],
  ["third teacher", "C", [first, second], policy, ["ARBITRATION"]],
  ["arbitration disabled", "C", [first, second], { ...policy, arbitrationEnabled: false }, []],
  ["difference equals threshold", "C", [first, { ...second, score: 6 }], policy, []],
  ["AI first not yet confirmed", "C", [{ ...first, source: "AI" }, second], policy, []],
  ["first locked after arbitration", "A", [first, second, arbitration], policy, []],
  ["second locked after arbitration", "B", [first, second, arbitration], policy, []],
  ["arbitrator updating own score", "C", [first, second, arbitration], policy, ["ARBITRATION"]],
  ["fourth teacher after arbitration", "D", [first, second, arbitration], policy, []],
] as const)(
  "matches server ownership and round rules: %s",
  (_, reviewerId, reviews, settings, expected) => {
    const choices = reviewRoundAvailability({
      reviewerId,
      reviews: [...reviews] as Review[],
      policy: settings,
    });
    expect(choices.filter((choice) => !choice.reason).map((choice) => choice.round)).toEqual(
      expected,
    );
    expect(
      choices.filter((choice) => choice.reason).every((choice) => choice.reason!.length > 0),
    ).toBe(true);
  },
);

it("blocks every round after publication and preserves threshold tolerance", () => {
  expect(
    reviewRoundAvailability({
      reviewerId: "C",
      reviews: [first, second],
      policy,
      published: true,
    }).every((choice) => choice.reason),
  ).toBe(true);
  const choices = reviewRoundAvailability({
    reviewerId: "C",
    reviews: [
      { ...first, score: 8.1 },
      { ...second, score: 8 },
    ],
    policy: { ...policy, maxDifference: 0.1 },
  });
  expect(choices.find((choice) => choice.round === "ARBITRATION")?.reason).toContain("未超出");
});

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
function stateFor(reviewerId: string, reviews: Review[], published = false) {
  return {
    actor: { id: reviewerId, role: "TEACHER" },
    users: [],
    reviews,
    papers: [
      {
        id: "paper",
        items: [
          {
            id: "item",
            score: 10,
            snapshot: {
              type: "SUBJECTIVE",
              content: {
                stem: "计算",
                answers: [],
                options: [],
                images: [],
                parts: [],
                rubric: "",
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
        published,
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
async function render(reviewerId: string, reviews: Review[], published = false, mutate = vi.fn()) {
  await act(async () =>
    root.render(
      <SubmissionReview
        key={reviewerId}
        submission={submission}
        state={stateFor(reviewerId, reviews, published)}
        mutate={mutate}
        pending={false}
      />,
    ),
  );
}
it("disables occupied and same-teacher rounds before input while keeping the owner's round editable", async () => {
  await render("B", [first]);
  const select = container.querySelector("select")!;
  expect(select.value).toBe("SECOND");
  expect(select.querySelector<HTMLOptionElement>('option[value="FIRST"]')!.disabled).toBe(true);
  expect(container.textContent).toContain("第一评：本轮已由其他教师提交");
  await render("A", [first]);
  expect(container.querySelector("select")!.value).toBe("FIRST");
  expect(container.querySelector<HTMLOptionElement>('option[value="SECOND"]')!.disabled).toBe(true);
  expect(container.querySelector<HTMLInputElement>('input[name="score"]')!.value).toBe("8");
});

it("provides reasons without a score or feedback form when no round is executable", async () => {
  await render("A", [first, second, arbitration]);
  expect(container.querySelector("form")).toBeNull();
  expect(container.querySelector("input, textarea")).toBeNull();
  expect(container.textContent).toContain("本题当前没有可执行的评阅轮次");
  expect(container.textContent).toContain("前两评已锁定");
  expect(container.querySelector("select")!.disabled).toBe(true);
  await render("C", [first, second, arbitration]);
  expect(container.querySelector("select")!.value).toBe("ARBITRATION");
  expect(container.querySelector("form")).not.toBeNull();
});

it("keeps dirty-score protection when switching between available rounds", async () => {
  await render("A", []);
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  await act(async () => {
    const score = container.querySelector<HTMLInputElement>('input[name="score"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(score, "5");
    score.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    const select = container.querySelector("select")!;
    select.value = "SECOND";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining("评分或反馈"));
  expect(container.querySelector("select")!.value).toBe("FIRST");
  expect(container.querySelector<HTMLInputElement>('input[name="score"]')!.value).toBe("5");
  confirm.mockReturnValue(true);
  await act(async () => {
    const select = container.querySelector("select")!;
    select.value = "SECOND";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(container.querySelector("select")!.value).toBe("SECOND");
  expect(container.querySelector<HTMLInputElement>('input[name="score"]')!.value).toBe("");
});

it("retains the existing read-only view after publication", async () => {
  await render("A", [first], true);
  expect(container.querySelector("form")).toBeNull();
  expect(container.textContent).toContain("已发布评分 · 只读");
});

it.each([false, true])(
  "preserves a dirty round when refreshed reviews revoke it (all rounds blocked=%s)",
  async (allBlocked) => {
    const mutate = vi.fn();
    await render("A", [], false, mutate);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await act(async () => {
      const score = container.querySelector<HTMLInputElement>('input[name="score"]')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(score, "5");
      score.dispatchEvent(new Event("input", { bubbles: true }));
      const feedback = container.querySelector<HTMLTextAreaElement>('textarea[name="feedback"]')!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        feedback,
        "保留批改意见",
      );
      feedback.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const occupied = [
      review("FIRST", "B"),
      ...(allBlocked ? [review("SECOND", "C", 4), review("ARBITRATION", "D", 6)] : []),
    ];
    await render("A", occupied, false, mutate);
    expect(container.querySelector("select")!.value).toBe("FIRST");
    expect(container.querySelector<HTMLInputElement>('input[name="score"]')!.value).toBe("5");
    expect(container.querySelector<HTMLTextAreaElement>('textarea[name="feedback"]')!.value).toBe(
      "保留批改意见",
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("已保留本题草稿");
    expect(container.querySelector<HTMLFieldSetElement>("fieldset")!.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(
      true,
    );
    expect(confirm).not.toHaveBeenCalled();
    await act(async () =>
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(mutate).not.toHaveBeenCalled();
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    if (!allBlocked) {
      await act(async () => {
        const select = container.querySelector("select")!;
        select.value = "SECOND";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
      expect(confirm).toHaveBeenCalledWith(expect.stringContaining("评分或反馈"));
      expect(container.querySelector("select")!.value).toBe("FIRST");
      expect(container.querySelector<HTMLInputElement>('input[name="score"]')!.value).toBe("5");
      confirm.mockReturnValue(true);
      await act(async () => {
        const select = container.querySelector("select")!;
        select.value = "SECOND";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
      expect(container.querySelector("select")!.value).toBe("SECOND");
      expect(container.querySelector<HTMLInputElement>('input[name="score"]')!.value).toBe("");
    }
  },
);

it("uses server assignments when independent review hides another teacher's score", async () => {
  const state = stateFor("B", []);
  state.reviewAssignments = [
    {
      submissionId: "submission",
      itemId: "item",
      blind: true,
      rounds: [{ round: "FIRST", reviewerId: "A", source: "HUMAN" }],
      availableRounds: [
        { round: "FIRST", label: "第一评", reason: "本轮已由其他教师提交" },
        { round: "SECOND", label: "第二评", reason: null },
        { round: "ARBITRATION", label: "仲裁三评", reason: "须先完成教师第一评与第二评" },
      ],
    },
  ];
  await act(async () =>
    root.render(
      <SubmissionReview state={state} submission={submission} mutate={vi.fn()} pending={false} />,
    ),
  );
  const selector = container.querySelector<HTMLSelectElement>("select")!;
  expect(selector.value).toBe("SECOND");
  expect(selector.querySelector<HTMLOptionElement>('option[value="FIRST"]')!.disabled).toBe(true);
  expect(container.textContent).toContain("两位教师完成评分前，仅显示您自己的评分和反馈");
  expect(container.textContent).not.toContain("评阅记录（");
  expect(container.querySelector<HTMLInputElement>('input[name="score"]')!.value).toBe("");
});
