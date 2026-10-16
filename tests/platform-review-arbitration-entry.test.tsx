// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  FinalGrade,
  PlatformState,
  ScanSubmission,
  StudentResult,
} from "@/contracts/platform";
import { ReviewQueuePage } from "@/components/platform/review-pages";

let current: PlatformState;
let area: "exams" | "homework" = "exams";
const mutate = vi.fn();
vi.mock("@/components/platform/domain-provider", () => ({
  useDomain: () => ({ state: current, area, mutate, pending: false }),
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
  status: "GRADED",
  answers: [],
  sourceFiles: [],
  alignment: null,
} as unknown as ScanSubmission;
function result(grade: FinalGrade): StudentResult {
  return {
    assessmentId: "exam",
    studentId: "student",
    studentName: "考试时姓名",
    studentNumber: "123456",
    classroomId: "class",
    classroomName: "本次班级",
    total: null,
    rank: null,
    classRank: null,
    subjects: [
      {
        paperId: "paper",
        subject: "数学",
        participationStatus: "REQUIRED",
        participationReason: "",
        rawScore: null,
        score: null,
        maxScore: 10,
        rank: null,
        grades: [grade],
      },
    ],
  };
}
function fixture(grade: FinalGrade): PlatformState {
  return {
    actor: { id: "teacher-c", name: "第三评教师", role: "TEACHER" },
    users: [],
    templates: [],
    questions: [],
    reviews: [],
    assessments: [
      {
        id: "exam",
        ownerId: "teacher-a",
        name: "期中考试",
        kind: "EXAM",
        classroomIds: ["class"],
        published: false,
        rosterStatus: "CONFIRMED",
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
            subjects: [{ paperId: "paper", status: "REQUIRED", reason: "" }],
          },
        ],
        papers: [{ paperId: "paper", subject: "数学", gradingMode: "DOUBLE" }],
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
    analytics: {
      results: [result(grade)],
      knowledge: [],
      students: [],
      classrooms: [],
    },
  } as unknown as PlatformState;
}
const arbitrating = {
  itemId: "item",
  score: null,
  maxScore: 10,
  status: "ARBITRATION",
  feedback: "",
} as FinalGrade;
const finalized = {
  itemId: "item",
  score: 8,
  maxScore: 10,
  status: "FINAL",
  feedback: "",
} as FinalGrade;
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  area = "exams";
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

it("marks rows with pending arbitration grades and links to the arbitration queue", async () => {
  current = fixture(arbitrating);
  await act(async () => root.render(<ReviewQueuePage />));
  expect(container.querySelector("tbody")?.textContent).toContain("待仲裁");
  expect(container.querySelector('a[href="/exams/grading/arbitration"]')).not.toBeNull();
  expect(container.querySelector("tbody")?.textContent).toContain("0 / 1 题");
  expect(container.querySelector("tbody")?.textContent).toContain("已完成");
});

it("lists the arbitrated submission on the arbitration queue without a self entry", async () => {
  current = fixture(arbitrating);
  await act(async () => root.render(<ReviewQueuePage arbitration />));
  expect(container.textContent).toContain("处理双评分差超出阈值的题目");
  expect(container.querySelector('a[href="/exams/grading/submission"]')?.textContent).toBe(
    "进入评阅",
  );
  expect(container.querySelector('a[href*="/grading/arbitration"]')).toBeNull();
});

it("shows no arbitration badge or entry when every grade is final", async () => {
  current = fixture(finalized);
  await act(async () => root.render(<ReviewQueuePage />));
  expect(container.querySelector("tbody")?.textContent).not.toContain("待仲裁");
  expect(container.querySelector('a[href*="/grading/arbitration"]')).toBeNull();
  await act(async () => root.render(<ReviewQueuePage arbitration />));
  expect(container.textContent).toContain("当前没有需要第三评仲裁的题目。");
  expect(container.querySelector("tbody")).toBeNull();
});

it("points the homework queue entry at the homework arbitration queue", async () => {
  current = fixture(arbitrating);
  area = "homework";
  await act(async () => root.render(<ReviewQueuePage />));
  expect(container.querySelector('a[href="/homework/grading/arbitration"]')).not.toBeNull();
  expect(container.querySelector('a[href="/exams/grading/arbitration"]')).toBeNull();
});
