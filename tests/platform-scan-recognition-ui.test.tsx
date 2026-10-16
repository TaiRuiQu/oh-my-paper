// @vitest-environment jsdom
import { act, createElement } from "react";
import { withConfirmedRosters } from "./assessment-roster-fixture";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PlatformState, ScanSubmission } from "@/contracts/platform";
import { submissionNeedsScanReview } from "@/lib/scan-recognition";
import { SubmissionReview } from "@/components/platform/reviews";
import { ReviewQueuePage, ScanningOverviewPage } from "@/components/platform/review-pages";
import { Scans } from "@/components/platform/scans";
import { SubmissionScanDetails } from "@/components/platform/submission-scan-details";

vi.mock("@/components/platform/domain-provider", () => ({
  useDomain: () => ({ state, area: "exams" }),
  useOptionalDomain: () => null,
}));
vi.mock("@/components/platform/ai", () => ({ PlatformAI: () => null }));
vi.mock("@/components/platform/questions", () => ({ QuestionBody: () => null }));
vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    const imageProps = { ...props };
    delete imageProps.unoptimized;
    return createElement("img", imageProps);
  },
}));

const normal = {
  id: "normal",
  assessmentId: "exam",
  paperId: "paper",
  studentId: "student-normal",
  kind: "CARD",
  status: "REVIEW",
  sourceFiles: ["/api/platform/assets/normal"],
  answers: [],
  alignment: { "1": { corrected: true, needsReview: false } },
} as unknown as ScanSubmission;
const flagged = {
  ...normal,
  id: "flagged",
  studentId: "student-flagged",
  status: "PENDING",
  sourceFiles: ["/api/platform/assets/flagged"],
  alignment: { "/api/platform/assets/flagged": { corrected: true, needsReview: true } },
} satisfies ScanSubmission;
const state = {
  actor: { id: "teacher", role: "TEACHER" },
  papers: [{ id: "paper", subject: "数学", items: [] }],
  assessments: [
    {
      id: "exam",
      name: "期中考试",
      kind: "EXAM",
      classroomIds: ["class"],
      papers: [
        {
          paperId: "paper",
          subject: "数学",
          gradingMode: "SINGLE",
          arbitrationThreshold: 2,
          conversion: { enabled: false, bands: [] },
        },
      ],
    },
  ],
  classrooms: [
    {
      id: "class",
      name: "一班",
      students: [
        { id: "student-normal", name: "普通答卷学生", classroomId: "class" },
        { id: "student-flagged", name: "异常答卷学生", classroomId: "class" },
      ],
    },
  ],
  submissions: [normal, flagged],
  templates: [],
  reviews: [],
  analytics: { results: [] },
} as unknown as PlatformState;
Object.assign(state, withConfirmedRosters(state));
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
});

it.each([
  [null, false],
  [{ needsReview: true }, true],
  [{ "1": { needsReview: false } }, false],
  [{ "1": { needsReview: true } }, true],
  [{ "/api/platform/assets/normal": { needsReview: true } }, true],
])("uses saved recognition evidence rather than grading status (%j)", (alignment, expected) => {
  expect(submissionNeedsScanReview({ ...normal, alignment })).toBe(expected);
  const graded: ScanSubmission = { ...normal, status: "GRADED", alignment };
  expect(submissionNeedsScanReview(graded)).toBe(expected);
});

it("does not turn ordinary incomplete grading into a scan warning", async () => {
  const partialState = {
    ...state,
    users: [],
    papers: [
      {
        id: "paper",
        items: ["first", "second"].map((id) => ({
          id,
          score: 5,
          snapshot: {
            type: "SUBJECTIVE",
            content: { stem: "计算", options: [], answers: [], images: [], parts: [], rubric: "" },
          },
        })),
      },
    ],
    reviews: [
      {
        id: "saved-first",
        submissionId: normal.id,
        itemId: "first",
        reviewerId: "teacher",
        round: "FIRST",
        score: 4,
        feedback: "",
        createdAt: "2026-10-15T00:00:00.000Z",
      },
    ],
    analytics: {
      results: [
        {
          assessmentId: "exam",
          studentId: normal.studentId,
          subjects: [
            {
              paperId: "paper",
              grades: [
                { itemId: "first", status: "FINAL", score: 4 },
                { itemId: "second", status: "PENDING", score: null },
              ],
            },
          ],
        },
      ],
    },
  } as unknown as PlatformState;
  await act(async () =>
    root.render(
      <SubmissionReview
        submission={normal}
        state={partialState}
        mutate={vi.fn()}
        pending={false}
      />,
    ),
  );
  expect(container.textContent).toContain("最终得分 4");
  expect(container.textContent).toContain("等待评分");
  expect(container.textContent).not.toContain("扫描识别存在不确定信息");
  await act(async () =>
    root.render(
      <SubmissionReview submission={flagged} state={state} mutate={vi.fn()} pending={false} />,
    ),
  );
  expect(container.textContent).toContain("扫描识别存在不确定信息");
});

it("counts only recognition flags and routes normal partial grading back to grading", async () => {
  await act(async () => root.render(<ScanningOverviewPage />));
  const count = [...container.querySelectorAll(".p-summary-strip > div")].find((node) =>
    node.textContent?.includes("识别异常答卷"),
  );
  expect(count?.querySelector("strong")?.textContent).toBe("1 份");
  await act(async () =>
    root.render(<Scans state={state} refresh={vi.fn()} notify={vi.fn()} section="history" />),
  );
  expect(
    container.querySelector('a[href="/exams/grading/normal#question-review"]')?.textContent,
  ).toBe("继续阅卷");
  expect(
    container.querySelector('a[href="/exams/grading/flagged#scan-materials"]')?.textContent,
  ).toBe("核对扫描");
  expect(container.textContent).toContain("评阅中");
  expect(container.textContent).not.toContain("待复核");
});

it("filters scan uncertainty independently from pending and ongoing grading", async () => {
  await act(async () => root.render(<ReviewQueuePage />));
  const status = container.querySelector<HTMLSelectElement>('select[aria-label="筛选评阅状态"]')!;
  await act(async () => {
    status.value = "SCAN_REVIEW";
    status.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(container.querySelector("tbody")?.textContent).toContain("异常答卷学生");
  expect(container.querySelector("tbody")?.textContent).not.toContain("普通答卷学生");
  await act(async () => {
    status.value = "REVIEW";
    status.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(container.querySelector("tbody")?.textContent).toContain("普通答卷学生");
  expect(container.querySelector("tbody")?.textContent).not.toContain("异常答卷学生");
});

it("shows the same page evidence in scan details for AI imports keyed by source URL", async () => {
  await act(async () => root.render(<SubmissionScanDetails submission={flagged} />));
  expect(container.textContent).toContain("已完成页面定位与校正");
  expect(container.textContent).toContain("识别结果待复核");
  expect(container.textContent).not.toContain("未记录页面校正信息");
});
