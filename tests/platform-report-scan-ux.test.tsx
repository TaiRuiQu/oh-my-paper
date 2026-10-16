// @vitest-environment jsdom
import { act, createElement, type ReactElement } from "react";
import { withConfirmedRosters } from "./assessment-roster-fixture";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BankQuestion, PlatformState, ScanSubmission } from "@/contracts/platform";
import { apiRequest } from "@/lib/http-client";
import { useDomain } from "@/components/platform/domain-provider";
import {
  AssessmentReportPage,
  ClassReportPage,
  LearningReportPage,
  LearningResultsPage,
} from "@/components/platform/report-pages";
import { Scans } from "@/components/platform/scans";
import { SubmissionReviewPage } from "@/components/platform/review-pages";

vi.mock("@/lib/http-client", () => ({ apiRequest: vi.fn() }));
vi.mock("@/components/platform/domain-provider", () => ({
  useDomain: vi.fn(),
  useOptionalDomain: () => null,
}));
vi.mock("@/components/platform/assessment-pages", () => ({ AssessmentNavigation: () => null }));
vi.mock("@/components/platform/questions", () => ({ QuestionBody: () => null }));
vi.mock("@/components/platform/revision-paper-pages", () => ({ RevisionPaperLink: () => null }));
vi.mock("@/components/platform/reviews", () => ({
  SubmissionReview: () => createElement("p", {}, "逐题评分表单"),
}));
vi.mock("@/components/platform/ai", () => ({ PlatformAI: () => null }));
vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    const imageProps = { ...props };
    delete imageProps.unoptimized;
    return createElement("img", imageProps);
  },
}));

const question: BankQuestion = {
  id: "mixed",
  ownerId: "teacher",
  type: "MIXED",
  subject: "数学",
  grade: "高中一年级",
  difficulty: 0.5,
  knowledgeTags: [],
  createdAt: "",
  updatedAt: "",
  content: {
    stem: "计算各小问",
    options: [],
    images: [],
    answers: [],
    explanation: "",
    rubric: "",
    parts: [
      {
        id: "p1",
        type: "SUBJECTIVE",
        stem: "计算平方",
        options: [],
        answers: ["$x^2=4$"],
        explanation: "先**平方**再化简 $x=2$",
        rubric: "列式正确 $x^2$ 得 1 分",
        knowledgeTags: [],
        score: 2,
      },
      {
        id: "p2",
        type: "BLANK",
        stem: "计算立方",
        options: [],
        answers: ["$x^3=8$"],
        explanation: "代入 $x=2$",
        rubric: "结果正确得 3 分",
        knowledgeTags: [],
        score: 3,
      },
    ],
  },
};
const submission: ScanSubmission = {
  id: "scan-one",
  ownerId: "teacher",
  assessmentId: "exam-a",
  paperId: "math",
  studentId: "student",
  templateId: null,
  kind: "CARD",
  status: "REVIEW",
  sourceFiles: ["/api/platform/assets/original"],
  answers: [{ itemId: "item", text: "1", images: [] }],
  createdAt: "",
  alignment: { "1": { corrected: true, needsReview: true, studentNumber: { mode: "BARCODE" } } },
};
const state = {
  actor: { id: "teacher", name: "教师", role: "TEACHER" },
  questions: [],
  templates: [],
  reviews: [],
  users: [],
  papers: [{ id: "math", subject: "数学", items: [{ id: "item", score: 5, snapshot: question }] }],
  classrooms: [
    {
      id: "class-a",
      name: "一班",
      students: [{ id: "student", name: "小明", studentNumber: "000001", classroomId: "class-a" }],
    },
    { id: "class-b", name: "二班", students: [] },
  ],
  assessments: [
    {
      id: "exam-a",
      name: "考试 A",
      kind: "EXAM",
      classroomIds: ["class-a"],
      published: false,
      papers: [{ paperId: "math", subject: "数学" }],
    },
    {
      id: "exam-b",
      name: "考试 B",
      kind: "EXAM",
      classroomIds: ["class-b"],
      published: true,
      papers: [{ paperId: "math", subject: "数学" }],
    },
    {
      id: "homework-a",
      name: "作业 A",
      kind: "HOMEWORK",
      classroomIds: ["class-a"],
      published: false,
      papers: [{ paperId: "math", subject: "数学" }],
    },
  ],
  submissions: [submission],
  analytics: {
    results: [],
    knowledge: [],
    classrooms: [],
    students: [
      {
        studentId: "student",
        subjects: [],
        knowledge: [],
        recommendations: [question],
        wrongQuestions: [
          {
            assessmentId: "exam-a",
            paperId: "math",
            itemId: "item",
            question,
            score: 0,
            maximum: 5,
            answer: { itemId: "item", text: "1", images: [] },
            feedback: "注意计算过程",
          },
        ],
      },
    ],
  },
} as unknown as PlatformState;
Object.assign(state, withConfirmedRosters(state));
let container: HTMLDivElement, root: Root, client: QueryClient;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.mocked(apiRequest).mockResolvedValue(state.analytics);
  vi.mocked(useDomain).mockReturnValue({
    state,
    area: "exams",
    mutate: vi.fn(),
    pending: false,
  } as unknown as ReturnType<typeof useDomain>);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
});
async function render(element: ReactElement) {
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client }, element));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

it("keeps an assessment report scoped to its route and only offers participating classes", async () => {
  await render(createElement(AssessmentReportPage, { id: "exam-a" }));
  expect(container.querySelector('select[aria-label="筛选考试"]')).toBeNull();
  expect(container.textContent).toContain("当前考试 / 作业：考试 A");
  expect(container.textContent).toContain("尚未发布");
  expect(
    [...container.querySelectorAll('select[aria-label="筛选班级"] option')].map(
      (option) => (option as HTMLOptionElement).value,
    ),
  ).toEqual(["", "class-a"]);
  expect(vi.mocked(apiRequest).mock.calls.at(-1)?.[0]).toContain("assessmentId=exam-a");
  await render(createElement(AssessmentReportPage, { id: "exam-b" }));
  expect(container.textContent).toContain("当前考试 / 作业：考试 B");
  expect(container.textContent).toContain("正式发布成绩");
  expect(vi.mocked(apiRequest).mock.calls.at(-1)?.[0]).toContain("assessmentId=exam-b");
});

it("keeps class reports fixed while filtering their assessments", async () => {
  await render(createElement(ClassReportPage, { id: "class-a" }));
  expect(container.querySelector('select[aria-label="筛选班级"]')).toBeNull();
  const select = container.querySelector<HTMLSelectElement>('select[aria-label="筛选考试"]')!;
  expect([...select.options].map((option) => option.value)).toEqual(["", "exam-a", "homework-a"]);
  await act(async () => {
    select.value = "exam-a";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(vi.mocked(apiRequest).mock.calls.at(-1)?.[0]).toContain("classroomId=class-a");
  expect(vi.mocked(apiRequest).mock.calls.at(-1)?.[0]).toContain("assessmentId=exam-a");
});

it("also fixes the subject of a student's single-assessment results page", async () => {
  await render(createElement(LearningResultsPage, { id: "exam-a" }));
  expect(container.querySelector('select[aria-label="筛选考试"]')).toBeNull();
  expect(vi.mocked(apiRequest).mock.calls.at(-1)?.[0]).toContain("assessmentId=exam-a");
});

it.each(["wrong", "practice"] as const)(
  "renders every compound-question answer, explanation and rubric with math in %s",
  async (view) => {
    await render(createElement(LearningReportPage, { view }));
    const answers = container.querySelector('[aria-label="参考答案与解析"]')!;
    expect(answers.textContent).toContain("小问 1 · 2 分");
    expect(answers.textContent).toContain("小问 2 · 3 分");
    expect(answers.textContent).toContain("列式正确");
    expect(answers.textContent).toContain("结果正确得 3 分");
    expect(answers.querySelector("strong")?.textContent).toBe("参考答案");
    expect(answers.querySelectorAll(".katex").length).toBeGreaterThanOrEqual(5);
    expect(answers.innerHTML).toContain("<strong>平方</strong>");
    expect(container.textContent).not.toContain("见小问答案");
  },
);

it("provides direct scan history links for reviewing and checking the selected submission", async () => {
  await render(
    createElement(Scans, {
      state: {
        ...state,
        submissions: [
          submission,
          { ...submission, id: "pending", status: "PENDING", alignment: null },
          {
            ...submission,
            id: "homework",
            assessmentId: "homework-a",
            kind: "WORKBOOK",
            status: "GRADED",
            alignment: null,
          },
        ],
      },
      section: "history",
      refresh: async () => {},
      notify: vi.fn(),
    }),
  );
  expect(container.querySelector('a[href="/exams/grading/scan-one"]')?.textContent).toBe(
    "查看答卷",
  );
  expect(
    container.querySelector('a[href="/exams/grading/scan-one#scan-materials"]')?.textContent,
  ).toBe("核对扫描");
  expect(
    container.querySelector('a[href="/exams/grading/pending#question-review"]')?.textContent,
  ).toBe("继续阅卷");
  expect(container.querySelector('a[href="/homework/grading/homework"]')?.textContent).toBe(
    "查看答卷",
  );
});

it("shows the saved originals and recognition evidence in the linked review detail", async () => {
  await render(createElement(SubmissionReviewPage, { id: "scan-one" }));
  const materials = container.querySelector("#scan-materials")!;
  expect(materials.textContent).toContain("保存 1 页原图");
  expect(materials.textContent).toContain("已完成页面定位与校正");
  expect(materials.textContent).toContain("使用条码识别学号");
  expect(materials.textContent).toContain("识别结果待复核");
  expect(materials.querySelector('a[href="/api/platform/assets/original"]')).toBeTruthy();
  expect(materials.querySelector('img[alt="扫描原图第 1 页"]')).toBeTruthy();
  expect(container.querySelector("#question-review")?.textContent).toContain("逐题评分表单");
});
