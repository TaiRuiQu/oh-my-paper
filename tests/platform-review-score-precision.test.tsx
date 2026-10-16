// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PlatformState, ScanSubmission } from "@/contracts/platform";
import { SubmissionReview } from "@/components/platform/reviews";

vi.mock("@/components/platform/questions", () => ({ QuestionBody: () => null }));
let host: HTMLDivElement, root: Root;
const mutate = vi.fn();
const submission = {
  id: "submission",
  assessmentId: "exam",
  paperId: "paper",
  studentId: "student",
  answers: [],
  sourceFiles: [],
  alignment: null,
} as unknown as ScanSubmission;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mutate.mockReset().mockResolvedValue({ id: "review", reviewVersion: 2 });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
async function render(maximum: number, mixed = false) {
  const state = {
    actor: { id: "teacher", role: "TEACHER" },
    users: [],
    reviews: [
      {
        id: "review",
        version: 1,
        submissionId: "submission",
        itemId: "item",
        reviewerId: "teacher",
        round: "FIRST",
        source: "AI",
        score: mixed ? 6.75 : 7.25,
        feedback: "AI建议，待教师核对",
        createdAt: "2026-10-15T00:00:00Z",
        partScores: mixed
          ? [
              { partId: "p1", score: 3.25, feedback: "小问一" },
              { partId: "p2", score: 3.5, feedback: "小问二" },
            ]
          : [],
      },
    ],
    assessments: [
      {
        id: "exam",
        published: false,
        rosterStatus: "CONFIRMED",
        participants: [
          { studentId: "student", subjects: [{ paperId: "paper", status: "REQUIRED" }] },
        ],
        papers: [{ paperId: "paper", gradingMode: "DOUBLE", arbitrationThreshold: 2 }],
      },
    ],
    papers: [
      {
        id: "paper",
        items: [
          {
            id: "item",
            score: maximum,
            snapshot: {
              type: mixed ? "MIXED" : "SUBJECTIVE",
              content: {
                stem: "说明理由",
                answers: [],
                images: [],
                options: [],
                rubric: "按实际完成情况评分",
                parts: mixed
                  ? ["p1", "p2"].map((id) => ({
                      id,
                      type: "SUBJECTIVE",
                      stem: "小问",
                      score: 1,
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
    analytics: { results: [] },
  } as unknown as PlatformState;
  await act(async () => {
    root.render(
      <SubmissionReview state={state} submission={submission} mutate={mutate} pending={false} />,
    );
  });
}
it("lets a teacher confirm a legal 7.25 AI first review without changing its score", async () => {
  await render(10);
  const score = host.querySelector<HTMLInputElement>('input[name="score"]')!;
  expect(score.value).toBe("7.25");
  expect(score.validity.stepMismatch).toBe(false);
  expect(score.checkValidity()).toBe(true);
  const feedback = host.querySelector<HTMLTextAreaElement>('textarea[name="feedback"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      feedback,
      "教师已核对，保留7.25分",
    );
    feedback.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => host.querySelector("form")!.requestSubmit());
  expect(mutate).toHaveBeenCalledWith({
    type: "review.save",
    review: expect.objectContaining({
      score: 7.25,
      feedback: "教师已核对，保留7.25分",
      expectedVersion: 1,
    }),
  });
});
it("accepts a non-half-point maximum while keeping ordinary score bounds", async () => {
  await render(7.3);
  const score = host.querySelector<HTMLInputElement>('input[name="score"]')!;
  score.value = "7.3";
  expect(score.checkValidity()).toBe(true);
  score.value = "7.3001";
  expect(score.validity.rangeOverflow).toBe(true);
  expect(score.checkValidity()).toBe(false);
  score.value = "-0.01";
  expect(score.validity.rangeUnderflow).toBe(true);
  expect(score.checkValidity()).toBe(false);
  score.value = "";
  expect(score.validity.valueMissing).toBe(true);
});
it("preserves mixed-question precision and the weighted maximum for each part", async () => {
  await render(7.3, true);
  const parts = [...host.querySelectorAll<HTMLInputElement>('input[type="number"]')];
  expect(parts).toHaveLength(2);
  expect(parts.map((part) => part.value)).toEqual(["3.25", "3.5"]);
  expect(parts.every((part) => part.checkValidity())).toBe(true);
  for (const part of parts) {
    expect(part.max).toBe("3.65");
    part.value = "3.65";
    expect(part.checkValidity()).toBe(true);
    part.value = "3.6501";
    expect(part.validity.rangeOverflow).toBe(true);
    expect(part.checkValidity()).toBe(false);
    part.value = "-0.01";
    expect(part.validity.rangeUnderflow).toBe(true);
  }
});
