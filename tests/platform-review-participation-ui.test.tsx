// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ParticipationStatus, PlatformState, ScanSubmission } from "@/contracts/platform";
import { projectReviewVisibility } from "@/server/platform/review-visibility";
import { SubmissionReview } from "@/components/platform/reviews";
import { Scans } from "@/components/platform/scans";
import { ReviewQueuePage, SubmissionReviewPage } from "@/components/platform/review-pages";

let current: PlatformState;
const mutate = vi.fn();
vi.mock("@/components/platform/domain-provider", () => ({
  useDomain: () => ({ state: current, area: "exams", mutate, pending: false }),
  useOptionalDomain: () => null,
}));
vi.mock("@/components/platform/ai", () => ({ PlatformAI: () => null }));
vi.mock("@/components/platform/questions", () => ({ QuestionBody: () => null }));
const submission = {
  id: "submission",
  assessmentId: "exam",
  paperId: "paper",
  studentId: "student",
  kind: "CARD",
  status: "PENDING",
  answers: [],
  sourceFiles: [],
  alignment: null,
} as unknown as ScanSubmission;
function fixture(status: ParticipationStatus = "REQUIRED", confirmed = true): PlatformState {
  return {
    actor: { id: "teacher", name: "教师", role: "ADMIN" },
    users: [],
    templates: [],
    questions: [],
    reviews: [],
    assessments: [
      {
        id: "exam",
        ownerId: "teacher",
        name: "期中考试",
        kind: "EXAM",
        classroomIds: ["class"],
        published: false,
        rosterStatus: confirmed ? "CONFIRMED" : "NEEDS_REVIEW",
        rosterRevision: 3,
        participants: [
          {
            id: "participant",
            studentId: "student",
            name: "考试时姓名",
            studentNumber: "123456",
            classroomId: "class",
            classroomName: "本次班级",
            stage: "高中",
            cohort: "2027届",
            subjects: [{ paperId: "paper", status, reason: "登记原因" }],
          },
        ],
        papers: [{ paperId: "paper", subject: "数学", gradingMode: "SINGLE" }],
      },
    ],
    papers: [
      {
        id: "paper",
        subject: "数学",
        items: [
          {
            id: "item",
            score: 10,
            snapshot: {
              type: "SUBJECTIVE",
              content: {
                stem: "求解",
                answers: [],
                options: [],
                parts: [],
                images: [],
                rubric: "",
              },
            },
          },
        ],
      },
    ],
    classrooms: [
      {
        id: "class",
        name: "现在班级",
        students: [
          { id: "student", name: "现在姓名", studentNumber: "999999", classroomId: "class" },
        ],
      },
    ],
    submissions: [submission],
    analytics: { results: [], knowledge: [], students: [], classrooms: [] },
  } as unknown as PlatformState;
}
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  current = fixture();
  mutate.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});
async function renderReview() {
  await act(async () =>
    root.render(
      <SubmissionReview submission={submission} state={current} mutate={mutate} pending={false} />,
    ),
  );
}

it.each([
  ["ABSENT", "缺考"],
  ["EXEMPT", "免考"],
  ["WITHDRAWN", "退出"],
] as const)(
  "blocks retained %s submissions in the server metadata and form",
  async (status, label) => {
    current = projectReviewVisibility(fixture(status));
    expect(
      current.reviewAssignments?.[0].availableRounds.every((choice) =>
        choice.reason?.includes(label),
      ),
    ).toBe(true);
    await renderReview();
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector("input, textarea")).toBeNull();
    expect(container.textContent).toContain(`本次科目已登记${label}`);
    expect(container.textContent).toContain("暂停评阅");
  },
);

it("blocks unconfirmed roster reconstruction even when a retained submission has no round yet", async () => {
  current = projectReviewVisibility(fixture("REQUIRED", false));
  expect(
    current.reviewAssignments?.[0].availableRounds.every((choice) =>
      choice.reason?.includes("尚未确认"),
    ),
  ).toBe(true);
  await renderReview();
  expect(container.querySelector("form")).toBeNull();
  expect(container.textContent).toContain("尚未确认");
});

it.each(["ABSENT", "NEEDS_REVIEW"] as const)(
  "preserves dirty score and feedback after refreshed participation changes to %s",
  async (change) => {
    current = projectReviewVisibility(fixture());
    await renderReview();
    await act(async () => {
      const score = container.querySelector<HTMLInputElement>('input[name="score"]')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(score, "5");
      score.dispatchEvent(new Event("input", { bubbles: true }));
      const feedback = container.querySelector<HTMLTextAreaElement>('textarea[name="feedback"]')!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        feedback,
        "保留本地反馈",
      );
      feedback.dispatchEvent(new Event("input", { bubbles: true }));
    });
    current = projectReviewVisibility(
      change === "ABSENT" ? fixture("ABSENT") : fixture("REQUIRED", false),
    );
    await renderReview();
    expect(container.querySelector<HTMLInputElement>('input[name="score"]')!.value).toBe("5");
    expect(container.querySelector<HTMLTextAreaElement>('textarea[name="feedback"]')!.value).toBe(
      "保留本地反馈",
    );
    expect(container.querySelector<HTMLFieldSetElement>("fieldset")!.disabled).toBe(true);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("已保留本题草稿");
    await act(async () =>
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(mutate).not.toHaveBeenCalled();
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
  },
);

it("labels retained records and details from the saved participant identity and excludes them from pending work", async () => {
  current = projectReviewVisibility(fixture("EXEMPT"));
  await act(async () => root.render(<ReviewQueuePage />));
  expect(container.querySelector("tbody")?.textContent).toContain("考试时姓名");
  expect(container.querySelector("tbody")?.textContent).toContain("本次班级");
  expect(container.querySelector("tbody")?.textContent).toContain("免考");
  expect(container.querySelector('a[href="/exams/grading/submission"]')?.textContent).toBe(
    "查看作答",
  );
  const select = container.querySelector<HTMLSelectElement>('select[aria-label="筛选评阅状态"]')!;
  await act(async () => {
    select.value = "PENDING";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(container.querySelector("tbody")).toBeNull();
  await act(async () => {
    select.value = "PAUSED";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(container.querySelector("tbody")?.textContent).toContain("免考");
  await act(async () => root.render(<SubmissionReviewPage id="submission" />));
  expect(container.textContent).toContain("考试时姓名 · 作答记录");
  expect(container.textContent).toContain("本次科目已登记免考");
  expect(container.querySelector('a[href="/exams/exam/roster"]')).not.toBeNull();
  expect(container.querySelector("form")).toBeNull();
});

it("does not trust previously available round metadata after the current roster becomes blocked", async () => {
  current = projectReviewVisibility(fixture());
  current.assessments[0].participants[0].subjects[0].status = "WITHDRAWN";
  const scoped = projectReviewVisibility(current);
  expect(
    scoped.reviewAssignments?.[0].availableRounds.every((choice) =>
      choice.reason?.includes("退出"),
    ),
  ).toBe(true);
  await renderReview();
  expect(container.querySelector("form")).toBeNull();
});

it("shows retained scans with the saved identity and no invitation to continue scoring", async () => {
  current = fixture("WITHDRAWN");
  await act(async () =>
    root.render(<Scans state={current} section="history" refresh={vi.fn()} notify={vi.fn()} />),
  );
  expect(container.querySelector("tbody")?.textContent).toContain("考试时姓名");
  expect(container.querySelector("tbody")?.textContent).not.toContain("现在姓名");
  expect(container.querySelector("tbody")?.textContent).toContain("暂停评阅 · 原记录保留");
  expect(container.textContent).not.toContain("继续阅卷");
  expect(container.querySelector('a[href="/exams/grading/submission"]')).not.toBeNull();
});
