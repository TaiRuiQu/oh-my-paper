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
  answers: [],
  sourceFiles: [],
  alignment: null,
} as unknown as ScanSubmission;
const saved = (version = 1, score = 8): Review => ({
  id: "review",
  version,
  submissionId: "submission",
  itemId: "item",
  round: "FIRST",
  reviewerId: "teacher",
  source: "HUMAN",
  score,
  feedback: `已保存反馈${score}`,
  createdAt: "",
  partScores: [
    { partId: "p1", score: score - 4, feedback: `小问反馈${score}` },
    { partId: "p2", score: 4, feedback: "第二问反馈" },
  ],
});
let own: Review | undefined, latest: Review | undefined, mixed: boolean;
let container: HTMLDivElement, root: Root;
const mutate = vi.fn(),
  refresh = vi.fn();
function view() {
  const state = {
    actor: { id: "teacher", role: "TEACHER" },
    users: [],
    reviews: own ? [own] : [],
    analytics: { results: [] },
    assessments: [
      {
        id: "exam",
        published: false,
        rosterRevision: 1,
        rosterStatus: "CONFIRMED",
        participants: [
          { studentId: "student", subjects: [{ paperId: "paper", status: "REQUIRED" }] },
        ],
        papers: [{ paperId: "paper", gradingMode: "SINGLE" }],
      },
    ],
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
                stem: "求解",
                answers: [],
                images: [],
                options: [],
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
  } as unknown as PlatformState;
  return (
    <SubmissionReview
      state={state}
      submission={submission}
      mutate={mutate}
      pending={false}
      refresh={refresh}
    />
  );
}
async function render() {
  await act(async () => root.render(view()));
}
async function input(selector: string, value: string) {
  await act(async () => {
    const node = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
    const proto =
      node instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit() {
  await act(async () => {
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find((b) => b.textContent === label)!;
  expect(button).toBeTruthy();
  await act(async () => button.click());
}
const scoreInput = () => container.querySelector<HTMLInputElement>('input[name="score"]')!;
function dirty(expected: boolean) {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(expected);
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  own = saved();
  latest = own;
  mixed = false;
  mutate.mockReset().mockResolvedValue({ id: "review", reviewVersion: 3 });
  refresh.mockReset().mockImplementation(async () => {
    own = latest;
    root.render(view());
  });
  vi.spyOn(window, "confirm").mockReturnValue(false);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

it("preserves a stale dirty draft and requires explicit read, comparison and discard before adopting a new baseline", async () => {
  await render();
  await input('input[name="score"]', "9");
  await input('textarea[name="feedback"]', "本地反馈");
  own = latest = saved(2, 6);
  await render();
  expect(scoreInput().value).toBe("9");
  expect(container.textContent).toContain("本地草稿已保留");
  dirty(true);
  await submit();
  expect(mutate).not.toHaveBeenCalled();
  await click("重新读取最新评分并比较");
  expect(container.querySelector('[aria-label="评分版本核对"]')?.textContent).toContain("本地反馈");
  expect(container.querySelector('[aria-label="评分版本核对"]')?.textContent).toContain(
    "版本 2 · 得分 6",
  );
  await click("放弃本地草稿并采用最新评分");
  expect(scoreInput().value).toBe("9");
  dirty(true);
  vi.mocked(window.confirm).mockReturnValue(true);
  await click("放弃本地草稿并采用最新评分");
  expect(scoreInput().value).toBe("6");
  dirty(false);
  await input('input[name="score"]', "7");
  await submit();
  expect(mutate).toHaveBeenCalledWith(
    expect.objectContaining({
      review: expect.objectContaining({ expectedVersion: 2, score: 7, feedback: "已保存反馈6" }),
    }),
  );
});

it("blocks a 409 immediately and retains the draft through failed reads and successful comparison", async () => {
  mutate.mockResolvedValueOnce({ error: "评分版本已更新", errorStatus: 409 });
  await render();
  await input('input[name="score"]', "9");
  await submit();
  expect(scoreInput().value).toBe("9");
  dirty(true);
  await submit();
  expect(mutate).toHaveBeenCalledTimes(1);
  refresh.mockRejectedValueOnce(new Error("读取离线"));
  await click("重新读取最新评分并比较");
  expect(container.textContent).toContain("读取离线");
  expect(scoreInput().value).toBe("9");
  latest = saved(2, 6);
  await click("重新读取最新评分并比较");
  await submit();
  expect(mutate).toHaveBeenCalledTimes(1);
  expect(scoreInput().value).toBe("9");
  expect(container.textContent).toContain("已保存反馈6");
});

it("compares and preserves all compound-question scores and feedback", async () => {
  mixed = true;
  await render();
  await input('input[type="number"]', "5");
  await input("textarea", "本地小问反馈");
  own = latest = saved(2, 6);
  await render();
  await click("重新读取最新评分并比较");
  const comparison = container.querySelector('[aria-label="评分版本核对"]')!;
  expect(comparison.textContent).toContain("本地小问反馈");
  expect(comparison.textContent).toContain("小问反馈6");
  expect(container.querySelector<HTMLInputElement>('input[type="number"]')!.value).toBe("5");
  await submit();
  expect(mutate).not.toHaveBeenCalled();
  dirty(true);
});

it("lets a network failure retry only the original baseline", async () => {
  mutate.mockResolvedValueOnce({ error: "离线" });
  await render();
  await input('input[name="score"]', "9");
  await submit();
  dirty(true);
  await submit();
  expect(mutate).toHaveBeenCalledTimes(2);
  expect(mutate.mock.calls.map(([command]) => command.review.expectedVersion)).toEqual([1, 1]);
});

it("advances the accepted baseline even when refreshed props still contain the old version", async () => {
  mutate.mockResolvedValueOnce({ id: "review", reviewVersion: 2 });
  await render();
  await input('input[name="score"]', "9");
  await submit();
  dirty(false);
  await input('input[name="score"]', "7");
  await submit();
  expect(mutate.mock.calls.map(([command]) => command.review.expectedVersion)).toEqual([1, 2]);
});

it("adopts a clean external version and sends its version on the next edit", async () => {
  await render();
  own = latest = saved(2, 6);
  await render();
  expect(scoreInput().value).toBe("6");
  dirty(false);
  await input('input[name="score"]', "7");
  await submit();
  expect(mutate).toHaveBeenCalledWith(
    expect.objectContaining({ review: expect.objectContaining({ expectedVersion: 2 }) }),
  );
});
