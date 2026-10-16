// @vitest-environment jsdom
import { act, createElement, type ReactElement } from "react";
import { withConfirmedRosters } from "./assessment-roster-fixture";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BankQuestion, PlatformState } from "@/contracts/platform";
import { apiRequest } from "@/lib/http-client";
import { useDomain } from "@/components/platform/domain-provider";
import { AssessmentReportPage } from "@/components/platform/report-pages";
import { RevisionPaperBuilder } from "@/components/platform/revision-paper-pages";

vi.mock("@/lib/http-client", () => ({ apiRequest: vi.fn() }));
vi.mock("@/components/platform/domain-provider", () => ({
  useDomain: vi.fn(),
  useOptionalDomain: () => null,
}));
vi.mock("@/components/platform/assessment-pages", () => ({ AssessmentNavigation: () => null }));
vi.mock("@/components/platform/questions", () => ({ QuestionBody: () => null }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const question: BankQuestion = {
  id: "q1",
  ownerId: "teacher",
  type: "BLANK",
  subject: "数学",
  grade: "高中一年级",
  difficulty: 0.5,
  knowledgeTags: ["有理数运算"],
  createdAt: "",
  updatedAt: "",
  content: {
    stem: "计算 2+2",
    options: [],
    images: [],
    answers: ["4"],
    explanation: "代入可得 4。",
    rubric: "",
    parts: [],
  },
};

function wrongQuestion(assessmentId: string) {
  return {
    assessmentId,
    paperId: "math",
    itemId: `item-${assessmentId}`,
    question,
    score: 0,
    maximum: 5,
    answer: { itemId: `item-${assessmentId}`, text: "3", images: [] },
    feedback: "注意进位",
  };
}

function learningReport(studentId: string, wrongAssessmentIds: string[]) {
  return {
    studentId,
    subjects: [{ subject: "数学", earned: 0, maximum: 5, accuracy: 0 }],
    knowledge: [{ tag: "有理数运算", earned: 0, maximum: 5, accuracy: 0, attempts: 1 }],
    wrongQuestions: wrongAssessmentIds.map(wrongQuestion),
    recommendations: [],
  };
}

function analyticsPayload(wrongAssessmentIds: string[]) {
  return {
    results: [],
    knowledge: [{ tag: "有理数运算", earned: 0, maximum: 5, accuracy: 0, attempts: 1 }],
    classrooms: [],
    students: [learningReport("student", wrongAssessmentIds)],
  };
}

const classrooms = [
  {
    id: "class-a",
    name: "一班",
    students: [{ id: "student", name: "小明", studentNumber: "000001", classroomId: "class-a" }],
  },
  { id: "class-b", name: "二班", students: [] },
];
const assessments = [
  {
    id: "exam-a",
    name: "考试 A",
    kind: "EXAM",
    classroomIds: ["class-a"],
    published: true,
    papers: [{ paperId: "math", subject: "数学" }],
  },
  {
    id: "homework-a",
    name: "作业 A",
    kind: "HOMEWORK",
    classroomIds: ["class-a"],
    published: true,
    papers: [{ paperId: "math", subject: "数学" }],
  },
];
const state = withConfirmedRosters({
  actor: { id: "teacher", name: "教师", role: "TEACHER" },
  questions: [],
  templates: [],
  reviews: [],
  users: [],
  papers: [],
  classrooms,
  assessments,
  submissions: [],
  analytics: {
    results: [],
    knowledge: [],
    classrooms: [],
    students: [learningReport("student", ["exam-a", "homework-a"])],
  },
} as unknown as PlatformState);

let container: HTMLDivElement, root: Root, client: QueryClient;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.mocked(apiRequest).mockResolvedValue(analyticsPayload(["exam-a"]));
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
});
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}
async function mount(element: ReactElement, area: "exams" | "homework" = "exams") {
  vi.mocked(useDomain).mockReturnValue({
    state,
    area,
    mutate: vi.fn(),
    pending: false,
  } as unknown as ReturnType<typeof useDomain>);
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client }, element));
  });
  await settle();
}
function tab(label: string) {
  const button = [...container.querySelectorAll(".p-tabs button")].find(
    (b) => b.textContent === label,
  );
  expect(button, `缺少「${label}」视图入口`).toBeTruthy();
  return button as HTMLButtonElement;
}
async function openLearningAndSelectStudent(assessmentId: string) {
  await act(async () => tab("错题与练习").click());
  const select = container.querySelector<HTMLSelectElement>('select[aria-label="查看学生学情"]')!;
  expect(select).toBeTruthy();
  await act(async () => {
    select.value = "student";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
  return `/workspace/revision-papers?studentId=student&assessmentId=${assessmentId}&kind=${
    assessmentId === "exam-a" ? "EXAM" : "HOMEWORK"
  }`;
}

it("exam report page offers the wrong-question view alongside results and knowledge", async () => {
  await mount(createElement(AssessmentReportPage, { id: "exam-a" }));
  expect(tab("成绩排名").getAttribute("aria-pressed")).toBe("true");
  expect(tab("知识点掌握").getAttribute("aria-pressed")).toBe("false");
  expect(tab("错题与练习").getAttribute("aria-pressed")).toBe("false");
  const scope = vi.mocked(apiRequest).mock.calls.at(-1)?.[0] as string;
  expect(scope).toContain("assessmentId=exam-a");
  expect(scope).toContain("kind=EXAM");
});

it("switching to the wrong-question view mounts per-student learning data with revision links", async () => {
  await mount(createElement(AssessmentReportPage, { id: "exam-a" }));
  const prefix = await openLearningAndSelectStudent("exam-a");
  expect(container.textContent).toContain("错题汇总 · 1 题");
  expect(container.textContent).toContain("0 / 5 分");
  expect(container.textContent).toContain("我的答案：3");
  expect(container.textContent).toContain("批改反馈");
  expect(container.textContent).toContain("注意进位");
  expect(container.querySelector<HTMLAnchorElement>(`a[href="${prefix}"]`)?.textContent).toBe(
    "错题复现",
  );
  expect(
    container.querySelector<HTMLAnchorElement>(`a[href="${prefix}&mode=CONSOLIDATE"]`)?.textContent,
  ).toBe("生成巩固卷");
  expect(vi.mocked(apiRequest).mock.calls.at(-1)?.[0]).toContain("studentId=student");
});

it("knowledge report route lands on the knowledge view and still exposes the switch", async () => {
  await mount(createElement(AssessmentReportPage, { id: "exam-a", knowledge: true }));
  expect(tab("知识点掌握").getAttribute("aria-pressed")).toBe("true");
  expect(container.querySelector('[aria-label="知识点掌握情况"]')).toBeTruthy();
  await act(async () => tab("错题与练习").click());
  expect(container.querySelector('select[aria-label="查看学生学情"]')).toBeTruthy();
});

it("homework report page offers the same entry scoped to the assignment", async () => {
  await mount(createElement(AssessmentReportPage, { id: "homework-a" }), "homework");
  const scope = vi.mocked(apiRequest).mock.calls.at(-1)?.[0] as string;
  expect(scope).toContain("assessmentId=homework-a");
  expect(scope).toContain("kind=HOMEWORK");
  await openLearningAndSelectStudent("homework-a");
  expect(container.textContent).toContain("错题汇总 · 1 题");
  expect(
    container.querySelector<HTMLAnchorElement>(
      'a[href="/workspace/revision-papers?studentId=student&assessmentId=homework-a&kind=HOMEWORK"]',
    ),
  ).toBeTruthy();
});

it("revision paper builder consumes the prefilled assessment and source from the report link", async () => {
  await mount(
    createElement(RevisionPaperBuilder, {
      initialStudentId: "student",
      initialAssessmentId: "exam-a",
      initialKind: "EXAM",
    }),
  );
  const byLabel = (label: string) =>
    container.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`)!;
  expect(byLabel("选择学生").value).toBe("student");
  expect(byLabel("筛选错题来源").value).toBe("EXAM");
  expect(byLabel("筛选教学安排").value).toBe("exam-a");
  expect(container.querySelectorAll('input[type="checkbox"]:checked')).toHaveLength(1);
  expect(container.textContent).toContain("已选 1 条错题记录");
});
