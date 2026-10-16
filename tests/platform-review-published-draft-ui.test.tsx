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
const saved = (id: string, mixed = false): Review => ({
  id: `review-${id}`,
  version: 1,
  submissionId: "submission",
  itemId: id,
  round: "FIRST",
  reviewerId: "teacher",
  source: "HUMAN",
  score: 8,
  feedback: `已保存${id}`,
  createdAt: "2026-10-15T10:00:00Z",
  ...(mixed ? { partScores: [{ partId: "part", score: 8, feedback: "已保存小问" }] } : {}),
});
let container: HTMLDivElement, root: Root, published: boolean, mixed: boolean;
const mutate = vi.fn(),
  refresh = vi.fn();
function view() {
  const state = {
    actor: { id: "teacher", role: "TEACHER" },
    users: [],
    reviews: [saved("item1", mixed), saved("item2")],
    analytics: { results: [] },
    assessments: [
      {
        id: "exam",
        published,
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
        items: ["item1", "item2"].map((id) => ({
          id,
          score: 10,
          snapshot: {
            type: mixed && id === "item1" ? "MIXED" : "SUBJECTIVE",
            content: {
              stem: "求解",
              answers: [],
              images: [],
              options: [],
              rubric: "",
              parts:
                mixed && id === "item1"
                  ? [
                      {
                        id: "part",
                        type: "SUBJECTIVE",
                        stem: "小问",
                        score: 10,
                        answers: [],
                        options: [],
                        rubric: "",
                      },
                    ]
                  : [],
            },
          },
        })),
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
const forms = () => [...container.querySelectorAll<HTMLFormElement>("form")];
const article = (index: number) => container.querySelectorAll<HTMLElement>(".p-review-work")[index];
const field = (index: number, selector: string) =>
  article(index).querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
async function render() {
  await act(async () => root.render(view()));
}
async function input(node: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const proto =
      node instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find((b) => b.textContent === label)!;
  expect(button).toBeTruthy();
  await act(async () => button.click());
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  published = false;
  mixed = false;
  mutate.mockReset().mockResolvedValue({ error: "成绩已发布", errorStatus: 409 });
  refresh.mockReset().mockImplementation(async () => {
    published = true;
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
it("keeps both question drafts mounted when comparison refresh discovers publication", async () => {
  await render();
  const firstScore = field(0, 'input[name="score"]'),
    firstFeedback = field(0, 'textarea[name="feedback"]');
  await input(firstScore, "7.25");
  await input(firstFeedback, "第一题尚未提交的独立说明");
  await input(field(1, 'input[name="score"]'), "6.25");
  await act(async () =>
    forms()[1].dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(mutate).toHaveBeenCalledTimes(1);
  await click("重新读取最新评分并比较");
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(field(0, 'input[name="score"]')).toBe(firstScore);
  expect(firstScore.value).toBe("7.25");
  expect(firstFeedback.value).toBe("第一题尚未提交的独立说明");
  expect(firstScore.matches(":disabled")).toBe(true);
  expect(field(1, 'input[name="score"]').value).toBe("6.25");
  const draftLabels = [...container.querySelectorAll('[aria-label$="已发布后的本地评分草稿"]')].map(
    (section) => section.getAttribute("aria-label"),
  );
  expect(draftLabels).toEqual(["第 1 题已发布后的本地评分草稿", "第 2 题已发布后的本地评分草稿"]);
  expect(new Set(draftLabels).size).toBe(draftLabels.length);
  for (const form of forms())
    await act(async () =>
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
  expect(mutate).toHaveBeenCalledTimes(1);
  const leave = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(leave);
  expect(leave.defaultPrevented).toBe(true);
  published = false;
  await render();
  expect(field(0, 'input[name="score"]')).toBe(firstScore);
  expect(firstScore.value).toBe("7.25");
  expect(firstScore.matches(":disabled")).toBe(false);
});
it("keeps clean publication read-only and requires explicit confirmation before discarding a dirty draft", async () => {
  await render();
  await input(field(0, 'textarea[name="feedback"]'), "需要保留的草稿");
  published = true;
  await render();
  expect(forms()).toHaveLength(1);
  await click("放弃本题未提交草稿");
  expect(forms()).toHaveLength(1);
  expect(field(0, 'textarea[name="feedback"]').value).toBe("需要保留的草稿");
  vi.mocked(window.confirm).mockReturnValue(true);
  await click("放弃本题未提交草稿");
  expect(forms()).toHaveLength(0);
  published = false;
  await render();
  expect(field(0, 'textarea[name="feedback"]').value).toBe("已保存item1");
  expect(field(1, 'textarea[name="feedback"]').value).toBe("已保存item2");
});
it("retains mixed-question subscore and feedback during publication and after withdrawal", async () => {
  mixed = true;
  await render();
  const subscore = field(0, 'input[type="number"]'),
    subfeedback = field(0, "textarea");
  await input(subscore, "4.125");
  await input(subfeedback, "本地小问依据");
  published = true;
  await render();
  expect(field(0, 'input[type="number"]')).toBe(subscore);
  expect(subscore.value).toBe("4.125");
  expect(subfeedback.value).toBe("本地小问依据");
  expect(subscore.matches(":disabled")).toBe(true);
  published = false;
  await render();
  expect(subscore.matches(":disabled")).toBe(false);
  expect(subscore.value).toBe("4.125");
  expect(subfeedback.value).toBe("本地小问依据");
});
