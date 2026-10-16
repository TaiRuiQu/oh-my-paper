// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Assessment, PlatformState, ScanSubmission } from "@/contracts/platform";
import { HomeOverviewPage } from "@/components/platform/home-pages";

let state: PlatformState;
vi.mock("@/components/platform/domain-provider", () => ({ useDomain: () => ({ state }) }));
function arrangement(id: string, kind: Assessment["kind"] = "EXAM"): Assessment {
  return {
    id,
    ownerId: "teacher",
    name: id,
    kind,
    reviewScope: "CLASSROOM",
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
    published: false,
    rosterRevision: 1,
    rosterStatus: "CONFIRMED",
    createdAt: "",
    participants: [
      {
        id: `participant-${id}`,
        studentId: "student",
        classroomId: "class",
        classroomName: "一班",
        name: "学生",
        studentNumber: "1001",
        stage: "高中",
        cohort: "2027",
        subjects: [{ paperId: "paper", status: "REQUIRED", reason: "" }],
      },
    ],
  };
}
function addSubmission(
  a: Assessment,
  status: ScanSubmission["status"] = "PENDING",
  available = true,
) {
  state.assessments.push(a);
  state.submissions.push({
    id: a.id,
    ownerId: "teacher",
    assessmentId: a.id,
    studentId: "student",
    paperId: "paper",
    templateId: null,
    kind: "CARD",
    status,
    sourceFiles: [],
    answers: [],
    alignment: null,
    createdAt: "",
  });
  state.reviewAssignments!.push({
    submissionId: a.id,
    itemId: "item",
    blind: false,
    rounds: [],
    availableRounds: [
      { round: "FIRST", label: "第一评", reason: available ? null : "当前教学身份无本题阅卷权限" },
    ],
  });
}
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state = {
    actor: { id: "teacher", role: "TEACHER", name: "教师" },
    questions: [],
    papers: [],
    classrooms: [],
    assessments: [],
    submissions: [],
    templates: [],
    reviews: [],
    reviewAssignments: [],
    users: [],
    analytics: { results: [], knowledge: [], students: [], classrooms: [] },
  };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
async function render() {
  await act(async () => root.render(<HomeOverviewPage />));
}
function metric(label: string) {
  return [...container.querySelectorAll(".p-summary-strip > div")].find(
    (el) => el.querySelector("small")?.textContent === label,
  )!;
}

it("counts only actionable confirmed work in the summary and both shortcuts, retaining paused records separately", async () => {
  addSubmission(arrangement("可评考试"));
  addSubmission(arrangement("可评作业", "HOMEWORK"), "REVIEW");
  for (const status of ["ABSENT", "EXEMPT", "WITHDRAWN"] as const) {
    const a = arrangement(status);
    a.participants[0].subjects[0].status = status;
    addSubmission(a); // Intentionally stale available metadata must not bypass the current roster.
  }
  const legacy = arrangement("未确认历史");
  legacy.rosterStatus = "NEEDS_REVIEW";
  legacy.published = true;
  addSubmission(legacy);
  const missing = arrangement("名单外答卷");
  missing.participants = [];
  addSubmission(missing);
  const published = arrangement("已发布");
  published.published = true;
  addSubmission(published);
  addSubmission(arrangement("只读教师"), "PENDING", false);
  addSubmission(arrangement("轮次已占用"), "REVIEW", false);
  addSubmission(arrangement("已完成"), "GRADED");
  await render();
  expect(metric("待完成评阅").querySelector("strong")?.textContent).toBe("2 份");
  expect(metric("待完成评阅").textContent).toContain("5 份暂停评阅记录保留");
  expect(container.querySelector('a[href="/exams/grading"]')?.textContent).toContain(
    "1 份考试答卷待处理",
  );
  expect(container.querySelector('a[href="/homework/grading"]')?.textContent).toContain(
    "1 份作业答卷待处理",
  );
});

it("labels legacy published arrangements as awaiting roster confirmation, not released to students", async () => {
  const legacy = arrangement("旧已发布安排");
  legacy.published = true;
  legacy.rosterStatus = "NEEDS_REVIEW";
  addSubmission(legacy);
  const draft = arrangement("待核对草稿");
  draft.rosterStatus = "NEEDS_REVIEW";
  addSubmission(draft);
  const published = arrangement("正常已发布");
  published.published = true;
  addSubmission(published);
  addSubmission(arrangement("正常进行中"));
  await render();
  expect(metric("正在进行").querySelector("strong")?.textContent).toBe("1 场");
  expect(metric("正在进行").textContent).toContain("另有 2 场名单待确认");
  const row = container.querySelector('a[href="/exams/旧已发布安排"]')!.closest(".p-list-row")!;
  expect(row.textContent).toContain("名单待确认 · 学生暂不可见");
  expect(row.textContent).not.toContain("成绩已发布");
  expect(
    container.querySelector('a[href="/exams/正常已发布"]')!.closest(".p-list-row")!.textContent,
  ).toContain("成绩已发布");
});

it("does not show student result links for unconfirmed or unpublished arrangements", async () => {
  state.actor = { id: "student-account", role: "STUDENT", name: "学生" };
  const legacy = arrangement("旧结果");
  legacy.published = true;
  legacy.rosterStatus = "NEEDS_REVIEW";
  const draft = arrangement("草稿结果");
  const published = arrangement("正式结果");
  published.published = true;
  state.assessments = [legacy, draft, published];
  state.analytics.results = state.assessments.map((a) => ({
    assessmentId: a.id,
    studentId: "student",
    studentName: "学生",
    studentNumber: "1001",
    classroomId: "class",
    classroomName: "一班",
    total: 8,
    rank: 1,
    classRank: 1,
    subjects: [],
  }));
  await render();
  expect(container.querySelector('a[href="/learning/results/旧结果"]')).toBeNull();
  expect(container.querySelector('a[href="/learning/results/草稿结果"]')).toBeNull();
  expect(container.querySelector('a[href="/learning/results/正式结果"]')).not.toBeNull();
});

it("never treats absent availability metadata as permission to process a retained answer", async () => {
  addSubmission(arrangement("缺少权限元数据"));
  state.reviewAssignments = [];
  await render();
  expect(metric("待完成评阅").querySelector("strong")?.textContent).toBe("0 份");
});

it.each(["ABSENT", "EXEMPT"] as const)(
  "keeps a released result link when %s prevents an all-subject total",
  async (status) => {
    state.actor = { id: "student-account", role: "STUDENT", name: "学生" };
    const published = arrangement("部分科目已发布");
    published.published = true;
    state.assessments = [published];
    state.analytics.results = [
      {
        assessmentId: published.id,
        studentId: "student",
        studentName: "学生",
        studentNumber: "1001",
        classroomId: "class",
        classroomName: "一班",
        total: null,
        rank: null,
        classRank: null,
        subjects: [
          {
            paperId: "math",
            subject: "数学",
            participationStatus: "REQUIRED",
            participationReason: "",
            score: 8,
            rawScore: 8,
            maxScore: 10,
            rank: 1,
            grades: [],
          },
          {
            paperId: "english",
            subject: "英语",
            participationStatus: status,
            participationReason: "已登记",
            score: null,
            rawScore: null,
            maxScore: 10,
            rank: null,
            grades: [],
          },
        ],
      },
    ];
    await render();
    const row = container
      .querySelector('a[href="/learning/results/部分科目已发布"]')
      ?.closest(".p-list-row");
    expect(row).toBeTruthy();
    expect(row?.textContent).toContain("数学 8");
    expect(row?.textContent).toContain(status === "ABSENT" ? "英语 缺考" : "英语 免考");
    expect(row?.querySelector("strong")?.textContent).toBe("不计总分");
    expect(row?.textContent).not.toContain("待评分");
    expect(container.textContent).not.toContain("老师发布成绩后，你可以在这里查看成绩和学习反馈");
    published.rosterStatus = "NEEDS_REVIEW";
    await render();
    expect(container.querySelector('a[href="/learning/results/部分科目已发布"]')).toBeNull();
  },
);
