// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SubmissionReview } from "@/components/platform/reviews";
import type { PlatformState, ScanSubmission } from "@/contracts/platform";
const submission = {
  id: "submission",
  assessmentId: "exam",
  paperId: "paper",
  studentId: "student",
  status: "PENDING",
  answers: [],
} as unknown as ScanSubmission;
const state = {
  actor: { id: "teacher", role: "TEACHER", name: "教师" },
  papers: [
    {
      id: "paper",
      items: [
        {
          id: "item",
          score: 10,
          snapshot: {
            type: "SUBJECTIVE",
            content: { stem: "求解", answers: [], options: [], images: [], parts: [], rubric: "" },
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
      papers: [{ paperId: "paper", gradingMode: "SINGLE" }],
    },
  ],
  reviews: [],
  users: [],
  analytics: { results: [] },
} as unknown as PlatformState;
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
async function inputScore() {
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>('input[name="score"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "8");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("keeps rejected scores dirty, then clears the warning only after a successful submission", async () => {
  const mutate = vi
    .fn()
    .mockResolvedValueOnce({ error: "offline" })
    .mockResolvedValueOnce({ id: "review" });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  await act(async () =>
    root.render(
      <>
        <SubmissionReview submission={submission} state={state} mutate={mutate} pending={false} />
        <a href="/elsewhere">离开</a>
      </>,
    ),
  );
  expect(container.textContent).toContain("本轮评分尚未提交");
  await inputScore();
  expect(container.textContent).toContain("本题评分有未提交修改");
  await act(async () => {
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  const rejectedClick = new MouseEvent("click", { bubbles: true, cancelable: true });
  container.querySelector("a")!.dispatchEvent(rejectedClick);
  expect(rejectedClick.defaultPrevented).toBe(true);
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining("评分或反馈"));
  expect(container.querySelector<HTMLInputElement>('input[name="score"]')!.value).toBe("8");
  await act(async () => {
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(container.textContent).toContain("本轮评分已提交");
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(false);
  expect(mutate).toHaveBeenLastCalledWith(
    expect.objectContaining({ review: expect.objectContaining({ score: 8 }) }),
  );
});
