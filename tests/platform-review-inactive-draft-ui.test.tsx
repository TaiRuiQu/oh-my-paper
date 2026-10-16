// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PlatformState, ScanSubmission, Review } from "@/contracts/platform";
import { SubmissionReviewPage } from "@/components/platform/review-pages";
import { ApiRequestError } from "@/lib/http-client";
vi.mock("@/components/platform/questions", () => ({
  QuestionBody: ({ question }: { question: { content: { stem: string } } }) => (
    <p>{question.content.stem}</p>
  ),
}));
vi.mock("@/components/platform/ai", () => ({ PlatformAI: () => null }));
vi.mock("@/components/platform/scans", () => ({ Scans: () => null }));
vi.mock("@/components/platform/domain-provider", () => ({
  useDomain: () => ({ state, area: "homework", mutate, pending: false, refresh }),
}));
let state: PlatformState, host: HTMLDivElement, root: Root;
const mutate = vi.fn(),
  refresh = vi.fn();
const savedReview = (itemId: string): Review => ({
  id: `review-${itemId}`,
  version: 1,
  itemId,
  submissionId: "old",
  round: "FIRST",
  reviewerId: "teacher",
  source: "HUMAN",
  score: 8,
  feedback: `SERVER_OLD_FEEDBACK_${itemId}`,
  createdAt: "2026-10-15T00:00:00Z",
});
const submission = {
  id: "old",
  assessmentId: "homework",
  paperId: "paper",
  studentId: "student",
  kind: "WORKBOOK",
  status: "REVIEW",
  sourceFiles: [],
  answers: [{ itemId: "one", text: "OLD_STUDENT_ANSWER", images: [] }],
  alignment: null,
} as unknown as ScanSubmission;
function fixture(): PlatformState {
  return {
    reviewing: true,
    actor: { id: "teacher", role: "TEACHER" },
    questions: [],
    users: [],
    classrooms: [],
    templates: [],
    submissions: [submission],
    reviews: [savedReview("one"), savedReview("two")],
    analytics: { results: [] },
    assessments: [
      {
        id: "homework",
        name: "作业",
        kind: "HOMEWORK",
        published: false,
        rosterStatus: "CONFIRMED",
        papers: [{ paperId: "paper", subject: "数学", gradingMode: "SINGLE" }],
        participants: [
          {
            studentId: "student",
            name: "学生旧姓名",
            studentNumber: "000001",
            subjects: [{ paperId: "paper", status: "REQUIRED" }],
          },
        ],
      },
    ],
    papers: [
      {
        id: "paper",
        subject: "数学",
        items: ["one", "two"].map((id) => ({
          id,
          score: 10,
          snapshot: {
            type: "SUBJECTIVE",
            content: {
              stem: `PRIVATE_STEM_${id}`,
              options: [],
              images: [],
              answers: [],
              rubric: "",
              parts: [],
            },
          },
        })),
      },
    ],
  } as unknown as PlatformState;
}
beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state = fixture();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  mutate.mockResolvedValue({ error: "已退回或新提交替代", errorStatus: 409 });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
async function render() {
  await act(async () => root.render(<SubmissionReviewPage id="old" />));
}
const work = (index: number) => host.querySelectorAll<HTMLElement>(".p-review-work")[index];
const field = (index: number, selector: string) =>
  work(index).querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
async function input(node: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(node), "value")!.set!.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function click(text: string) {
  const button = [...host.querySelectorAll("button")].find((entry) => entry.textContent === text)!;
  expect(button).toBeTruthy();
  await act(async () => button.click());
}
async function conflictAndRead() {
  await act(async () => work(1).querySelector("form")!.requestSubmit());
  await click("重新读取最新评分并比较");
}
function retire(replacement = false) {
  const previous = state;
  state = {
    ...previous,
    submissions: replacement ? [{ ...submission, id: "replacement" }] : [],
    reviews: [],
    requestedReview: {
      submission,
      reviews: [savedReview("one"), savedReview("two")],
      reviewHistory: [],
    },
  };
}

it.each([false, true])(
  "keeps both drafts mounted and read-only after return/replacement=%s with explicit authorized history",
  async (replacement) => {
    await render();
    const first = field(0, 'input[name="score"]'),
      firstFeedback = field(0, 'textarea[name="feedback"]');
    await input(first, "7.25");
    await input(firstFeedback, "LOCAL_Q1_DRAFT");
    await input(field(1, 'input[name="score"]'), "6.25");
    refresh.mockImplementation(async (requestedId: string) => {
      expect(requestedId).toBe("old");
      retire(replacement);
      await render();
    });
    await conflictAndRead();
    expect(field(0, 'input[name="score"]')).toBe(first);
    expect(first.value).toBe("7.25");
    expect(firstFeedback.value).toBe("LOCAL_Q1_DRAFT");
    expect(field(1, 'input[name="score"]').value).toBe("6.25");
    expect(first.matches(":disabled")).toBe(true);
    expect(host.textContent).toContain("不能写入旧提交或自动转移到新提交");
    expect(
      host.querySelector('a[href="/homework/assignments/homework/collection"]'),
    ).not.toBeNull();
    for (const form of host.querySelectorAll("form"))
      await act(async () =>
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
      );
    expect(mutate).toHaveBeenCalledOnce();
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await click("放弃本题未提交草稿");
    expect(first.value).toBe("7.25");
    confirm.mockReturnValue(true);
    await click("放弃本题未提交草稿");
    expect(work(0).querySelector("form")).toBeNull();
    expect(field(1, 'input[name="score"]').value).toBe("6.25");
  },
);

it("on permission loss retains only locally changed fields and never revives old source data or untouched saved scores", async () => {
  await render();
  await input(field(0, 'textarea[name="feedback"]'), "LOCAL_ONLY_FEEDBACK");
  await input(field(1, 'input[name="score"]'), "6.25");
  refresh.mockImplementation(async () => {
    state = { ...fixture(), assessments: [], papers: [], submissions: [], reviews: [] };
    await render();
  });
  await conflictAndRead();
  expect(host.textContent).toContain("LOCAL_ONLY_FEEDBACK");
  expect(host.textContent).toContain("本人修改的得分：6.25");
  expect(host.textContent).not.toContain("SERVER_OLD_FEEDBACK");
  expect(host.textContent).not.toContain("PRIVATE_STEM");
  expect(host.textContent).not.toContain("OLD_STUDENT_ANSWER");
  expect(host.textContent).not.toContain("学生旧姓名");
  expect(host.querySelector("form")).toBeNull();
  expect(host.querySelector('a[href*="collection"]')).toBeNull();
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  vi.spyOn(window, "confirm").mockReturnValue(false);
  await click("明确放弃本人本地评分输入");
  expect(host.textContent).toContain("LOCAL_ONLY_FEEDBACK");
  vi.mocked(window.confirm).mockReturnValue(true);
  await click("明确放弃本人本地评分输入");
  expect(host.textContent).not.toContain("LOCAL_ONLY_FEEDBACK");
  expect(mutate).toHaveBeenCalledOnce();
});

it("allows an explicitly authorized inactive URL to be read without creating editable forms or using a cached source", async () => {
  state = { ...fixture(), submissions: [], reviews: [] };
  refresh.mockImplementation(async (id: string) => {
    expect(id).toBe("old");
    retire();
    await render();
  });
  await render();
  expect(refresh).toHaveBeenCalledOnce();
  expect(host.textContent).toContain("PRIVATE_STEM_one");
  expect(host.textContent).toContain("旧提交仅供查看");
  expect(host.querySelector("form")).toBeNull();
  expect(mutate).not.toHaveBeenCalled();
});

it.each([401, 403, 404])(
  "archives local deltas on an authorization response %s but preserves the authorized page on a server failure",
  async (status) => {
    await render();
    await input(field(0, 'textarea[name="feedback"]'), "LOCAL_AUTH_DELTA");
    refresh.mockRejectedValueOnce(new ApiRequestError("权限已变化", status));
    await act(async () => work(0).querySelector("form")!.requestSubmit());
    await act(async () => {
      await click("重新读取最新评分并比较");
    });
    expect(host.textContent).toContain("LOCAL_AUTH_DELTA");
    expect(host.textContent).not.toContain("PRIVATE_STEM");
    expect(host.querySelector("form")).toBeNull();
    state = fixture();
    await render();
    await input(field(0, 'textarea[name="feedback"]'), "LOCAL_NETWORK_DELTA");
    refresh.mockRejectedValueOnce(new Error("暂时不可读"));
    await act(async () => work(0).querySelector("form")!.requestSubmit());
    await act(async () => {
      await click("重新读取最新评分并比较");
    });
    expect(host.querySelector("form")).not.toBeNull();
    expect(field(0, 'textarea[name="feedback"]').value).toBe("LOCAL_NETWORK_DELTA");
  },
);

it.each(["active", "retired"])(
  "keeps detached local inputs visible with leave protection after permission is restored to %s",
  async (restored) => {
    await render();
    await input(field(0, 'textarea[name="feedback"]'), "LOCAL_RESTORED_FEEDBACK");
    await input(field(1, 'input[name="score"]'), "6.25");
    refresh.mockImplementationOnce(async () => {
      state = { ...fixture(), assessments: [], papers: [], submissions: [], reviews: [] };
      await render();
    });
    await conflictAndRead();
    expect(host.textContent).toContain("LOCAL_RESTORED_FEEDBACK");
    refresh.mockImplementationOnce(async () => {
      state = fixture();
      if (restored === "retired") {
        retire();
        state.requestedReview!.reviewAssignments = ["one", "two"].map((itemId) => ({
          submissionId: "old",
          itemId,
          blind: false,
          rounds: [],
          availableRounds: [{ round: "FIRST", label: "第一评", reason: "旧提交只读" }],
        }));
      }
      await render();
    });
    await click("重新读取当前答卷权限");
    const retained = host.querySelector('[aria-label="曾脱离授权答卷的本人本地输入"]')!;
    expect(retained).not.toBeNull();
    expect(retained.textContent).toContain("LOCAL_RESTORED_FEEDBACK");
    expect(retained.textContent).toContain("6.25");
    expect(retained.textContent).not.toContain("SERVER_OLD_FEEDBACK");
    expect(retained.textContent).not.toContain("PRIVATE_STEM");
    if (restored === "active") {
      expect(field(0, 'textarea[name="feedback"]').value).toBe("SERVER_OLD_FEEDBACK_one");
      expect(field(1, 'input[name="score"]').value).toBe("8");
    } else expect(host.querySelector("form")).toBeNull();
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    await click("明确放弃本人本地评分输入");
    expect(host.textContent).toContain("LOCAL_RESTORED_FEEDBACK");
    vi.mocked(window.confirm).mockReturnValue(true);
    await click("明确放弃本人本地评分输入");
    expect(host.textContent).not.toContain("LOCAL_RESTORED_FEEDBACK");
    expect(mutate).toHaveBeenCalledOnce();
  },
);
