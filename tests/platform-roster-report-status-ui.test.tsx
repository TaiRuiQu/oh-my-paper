// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  Assessment,
  ParticipationStatus,
  PlatformState,
  StudentResult,
} from "@/contracts/platform";
import { AssessmentPublishPage } from "@/components/platform/assessment-pages";
import { ReportListPage, AssessmentReportPage } from "@/components/platform/report-pages";
import { Analytics } from "@/components/platform/analytics";

const domain = vi.hoisted(() => ({
  state: {} as PlatformState,
  area: "exams",
  mutate: vi.fn(),
  pending: false,
}));
vi.mock("@/components/platform/domain-provider", () => ({ useDomain: () => domain }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: domain.state.analytics, isPending: false, error: null }),
}));
vi.mock("@/components/platform/questions", () => ({ QuestionBody: () => null }));
vi.mock("@/components/platform/revision-paper-pages", () => ({ RevisionPaperLink: () => null }));

let container: HTMLDivElement, root: Root;
function setup(
  statuses: ParticipationStatus[] = ["REQUIRED"],
  confirmed = true,
  published = false,
) {
  const exam: Assessment = {
    id: "exam",
    ownerId: "teacher",
    name: "期中考试",
    kind: "EXAM",
    reviewScope: "CLASSROOM",
    classroomIds: ["class"],
    published,
    createdAt: "",
    canManage: true,
    rosterRevision: 1,
    rosterStatus: confirmed ? "CONFIRMED" : "NEEDS_REVIEW",
    papers: statuses.map((_, index) => ({
      paperId: `paper${index}`,
      subject: `学科${index}`,
      gradingMode: "SINGLE",
      arbitrationThreshold: 2,
      conversion: { enabled: false, bands: [] },
    })),
    participants: [
      {
        id: "participant",
        studentId: "student",
        classroomId: "class",
        classroomName: "一班",
        name: "小明",
        studentNumber: "1001",
        stage: "高中",
        cohort: "2027",
        subjects: statuses.map((status, index) => ({
          paperId: `paper${index}`,
          status,
          reason: "",
        })),
      },
    ],
  };
  const result: StudentResult = {
    assessmentId: exam.id,
    studentId: "student",
    studentName: "小明",
    studentNumber: "1001",
    classroomId: "class",
    classroomName: "一班",
    subjects: statuses.map((status, index) => ({
      paperId: `paper${index}`,
      subject: `学科${index}`,
      participationStatus: status,
      participationReason: "",
      rawScore: status === "REQUIRED" ? 8 : null,
      score: status === "REQUIRED" ? 8 : null,
      maxScore: 10,
      rank: null,
      grades: [],
    })),
    total: confirmed && statuses.every((s) => s === "REQUIRED") ? statuses.length * 8 : null,
    totalRestricted: !confirmed,
    rank: null,
    classRank: null,
  };
  domain.state = {
    actor: { id: "teacher", role: "TEACHER", name: "教师" },
    assessments: [exam],
    classrooms: [],
    papers: [],
    submissions: [],
    reviews: [],
    users: [],
    questions: [],
    templates: [],
    analytics: { results: [result], students: [], classrooms: [], knowledge: [] },
  } as unknown as PlatformState;
  return { exam, result };
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  setup();
  domain.mutate.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
async function render(element: ReactElement) {
  await act(async () => root.render(element));
}

it.each([false, true])(
  "does not claim student visibility or official results with an unconfirmed roster (published=%s)",
  async (published) => {
    setup(["REQUIRED"], false, published);
    await render(<AssessmentPublishPage id="exam" />);
    expect(container.textContent).toContain("名单尚未确认，学生暂不可查看本次成绩与反馈");
    expect(container.textContent).not.toContain("学生已可查看本人反馈");
    expect(container.querySelector("h2")?.textContent).toBe("参与名单待核对");
    const publishButton = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === (published ? "撤回成绩发布" : "发布成绩与学习反馈"),
    );
    expect(publishButton?.disabled).toBe(!published);
    await render(<ReportListPage />);
    expect(container.querySelector("tbody")?.textContent).toContain("名单待核对，学生暂不可见");
    expect(container.querySelector("tbody")?.textContent).not.toContain("正式成绩");
    await render(<AssessmentReportPage id="exam" />);
    expect(container.querySelector(".p-heading")?.textContent).toContain("名单待核对");
    expect(container.querySelector(".p-heading")?.textContent).not.toContain("正式发布成绩");
    expect(container.querySelector(".p-score")?.textContent).toBe("名单待核对");
  },
);

it.each([
  ["ABSENT"],
  ["EXEMPT"],
  ["REQUIRED", "ABSENT"],
  ["REQUIRED", "EXEMPT"],
] as ParticipationStatus[][])(
  "reports completed participation without comparable all-subject totals (%j)",
  async (...statuses) => {
    setup(statuses);
    await render(<AssessmentPublishPage id="exam" />);
    expect(container.querySelector("h2")?.textContent).toBe("已具备发布条件");
    await render(<ReportListPage />);
    expect(container.querySelector("tbody")?.textContent).toContain("无可比全科成绩");
    expect(container.querySelector("tbody")?.textContent).not.toContain("待评分");
  },
);

it("keeps unfinished required work distinct from completed non-comparable totals", async () => {
  const { result } = setup(["REQUIRED", "ABSENT"]);
  result.subjects[0].score = null;
  await render(<ReportListPage />);
  expect(container.querySelector("tbody")?.textContent).toContain("待评分");
  expect(container.querySelector("tbody")?.textContent).not.toContain("无可比全科成绩");
});

it("preserves confirmed publication and numerical all-subject averages", async () => {
  setup(["REQUIRED"], true, true);
  await render(<AssessmentPublishPage id="exam" />);
  expect(container.textContent).toContain("学生已可查看本人反馈");
  await render(<ReportListPage />);
  expect(container.querySelector("tbody")?.textContent).toContain("正式成绩");
  expect(container.querySelector("tbody")?.textContent).toContain("8.0");
});

it("keeps the server canManage decision when reporting blocked publication", async () => {
  const { exam } = setup(["REQUIRED"], false, true);
  exam.canManage = false;
  await render(<AssessmentPublishPage id="exam" />);
  expect(container.textContent).toContain("当前仅可查看发布状态");
  expect(
    [...container.querySelectorAll("button")].some((b) => b.textContent === "撤回成绩发布"),
  ).toBe(false);
});

it("does not describe full-scope restricted totals as authorization limits", async () => {
  const { result } = setup();
  result.totalRestricted = true;
  result.total = null;
  await render(<Analytics state={domain.state} fixedView="results" />);
  expect(container.querySelector(".p-score")?.textContent).toBe("总分暂不可用");
  domain.state.assessments[0].papers.push({
    ...domain.state.assessments[0].papers[0],
    paperId: "hidden",
    subject: "未授权学科",
  });
  await render(<Analytics state={domain.state} fixedView="results" />);
  expect(container.querySelector(".p-score")?.textContent).toBe("仅授权学科");
});
