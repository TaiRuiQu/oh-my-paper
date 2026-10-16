// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type {
  PracticeAttemptDetail,
  PracticeReference,
  PracticeStudentPaper,
} from "@/contracts/practice";
import { PracticeAttemptReading, PracticeReferenceReading } from "@/components/practice/feedback";

const paper: PracticeStudentPaper = {
  id: "paper",
  name: "函数练习",
  subject: "数学",
  instructions: "请独立完成",
  textBlocks: [],
  studentImageUrls: [],
  items: [
    {
      id: "item",
      position: 0,
      section: "",
      score: 10,
      type: "SUBJECTIVE",
      stem: "说明函数变化",
      options: [],
      parts: [],
      studentImageUrls: [],
    },
  ],
};
const reference: PracticeReference = {
  items: [
    {
      itemId: "item",
      answers: ["函数递增"],
      explanation: "比较相邻值。",
      rubric: "给出理由。",
      images: [],
      parts: [],
    },
  ],
};
function detail(role: "TEACHER" | "STUDENT"): PracticeAttemptDetail {
  return {
    actor: { id: role === "TEACHER" ? "teacher" : "learner", role, name: "当前读者" },
    timezone: "Asia/Shanghai",
    session: {
      id: "session",
      version: 3,
      sourceKind: "SET",
      setId: "set",
      name: "函数练习",
      subject: "数学",
      student: {
        studentId: "student",
        userId: "learner",
        name: "学生",
        studentNumber: "001",
        classroomId: "class",
        classroomName: "一班",
        stage: "高中",
        cohort: "2026",
      },
      status: "SUBMITTED",
      createdAt: "2026-10-15T00:00:00Z",
      submittedAt: "2026-10-15T01:00:00Z",
      currentAttemptId: "attempt-2",
      attemptCount: 2,
      reviewRequestedAt: null,
      feedbackState: "WAITING",
    },
    attempt: {
      id: "attempt-1",
      sessionId: "session",
      sequence: 1,
      submittedAt: "2026-10-15T00:30:00Z",
      attemptFingerprint: "a".repeat(64),
      contentFingerprint: "b".repeat(64),
      evaluationVersion: 0,
      eligibility: [
        {
          itemId: "item",
          originalQuestionId: "question",
          promptFingerprint: "c".repeat(64),
          eligibility: "UNEXPOSED_IN_SYSTEM",
          reasons: ["提交前未提供参考"],
        },
      ],
      canSelfAssess: false,
      canRequestReview: false,
      canRequestAi: false,
      canConfirmReview: false,
      blockReasons: ["本轮已进入历史"],
    },
    papers: [paper],
    answers: [{ itemId: "item", text: "本轮独立作答", images: [] }],
    reference,
    evaluations: [],
  };
}
function view(markup: string) {
  const host = document.createElement("div");
  host.innerHTML = markup;
  return host;
}
it("labels teacher-only reference access without claiming it was revealed to the student", () => {
  const host = view(
    renderToStaticMarkup(<PracticeAttemptReading detail={detail("TEACHER")} context="教师历史" />),
  );
  expect(host.textContent).toContain("教师核验用参考（不代表学生已查看）");
  expect(host.textContent).toContain("不能据此认定学生已查看参考或参考已向学生开放");
  expect(host.textContent).not.toContain("已明确开放的参考答案与解析");
  expect(host.textContent).toContain("函数递增");
  expect(host.querySelector('[aria-label="教师历史教师核验用参考"]')).not.toBeNull();
});
it("labels the student's explicitly revealed reference as currently available", () => {
  const host = view(
    renderToStaticMarkup(
      <PracticeReferenceReading
        reference={reference}
        papers={[paper]}
        context="本人当前练习"
        audience="STUDENT"
      />,
    ),
  );
  expect(host.textContent).toContain("已明确开放的参考答案与解析");
  expect(host.textContent).toContain("以下为当前已开放的参考");
  expect(host.textContent).not.toContain("教师核验用参考");
});
it("keeps historical submission exposure distinct from the student's currently revealed reference", () => {
  const host = view(
    renderToStaticMarkup(<PracticeAttemptReading detail={detail("STUDENT")} context="历史第1次" />),
  );
  expect(host.textContent).toContain("第 1 次提交");
  expect(host.textContent).toContain(
    "以下参考情况是本次提交时的记录，不代表学生当前是否已查看参考",
  );
  expect(host.textContent).toContain("系统尚未提供参考");
  expect(host.textContent).toContain("以下为当前已开放的参考");
  expect(host.textContent).toContain("各次提交时的参考情况以该次提交记录为准");
});
it("renders embedded reference images once and keeps loose gallery images in their original order", () => {
  const image = (n: number) =>
    `/api/platform/assets/00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const current = structuredClone(reference);
  current.items[0].explanation = `参考示意 ![示意图](${image(1)})`;
  current.items[0].images = [image(3), image(1), image(2)];
  const original = structuredClone(current);
  const host = view(
    renderToStaticMarkup(
      <PracticeReferenceReading
        reference={current}
        papers={[paper]}
        context="本人参考"
        audience="STUDENT"
      />,
    ),
  );
  expect([...host.querySelectorAll("img")].map((node) => node.getAttribute("src"))).toEqual([
    image(1),
    image(3),
    image(2),
  ]);
  expect(current).toEqual(original);
});
