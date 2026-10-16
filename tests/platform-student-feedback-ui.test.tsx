// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ParticipationStatus, PlatformState } from "@/contracts/platform";
import { StudentAnswerFeedback } from "@/components/platform/student-answer-feedback";
vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    const next = { ...props };
    delete next.unoptimized;
    return createElement("img", next);
  },
}));
let state: PlatformState, container: HTMLDivElement, root: Root;
function fixture(): PlatformState {
  const content = {
    stem: "独立求解",
    options: [],
    images: [],
    answers: ["正确答案4"],
    explanation: "参考解析",
    rubric: "给分标准",
    parts: [],
  };
  const question = {
    id: "q",
    ownerId: "teacher",
    type: "SUBJECTIVE",
    subject: "数学",
    grade: "高中一年级",
    content,
    knowledgeTags: [],
    difficulty: 0.5,
    createdAt: "",
    updatedAt: "",
  };
  return {
    actor: { id: "account", role: "STUDENT", name: "本人" },
    users: [],
    reviews: [],
    templates: [],
    questions: [],
    classrooms: [
      {
        id: "class",
        students: [
          { id: "self", userId: "account" },
          { id: "peer", userId: "peer-account" },
        ],
      },
    ],
    assessments: [
      {
        id: "exam",
        name: "期中考试",
        published: true,
        rosterStatus: "CONFIRMED",
        rosterRevision: 1,
        papers: [{ paperId: "paper", subject: "数学" }],
        participants: ["self", "peer"].map((studentId) => ({
          id: studentId,
          studentId,
          name: studentId,
          classroomName: "考试时班级",
          subjects: [{ paperId: "paper", status: "REQUIRED", reason: "" }],
        })),
      },
    ],
    papers: [
      {
        id: "paper",
        name: "数学试卷",
        items: [
          { id: "full", questionId: "q", score: 5, snapshot: question },
          {
            id: "mixed",
            questionId: "mixed-q",
            score: 20,
            snapshot: {
              ...question,
              id: "mixed-q",
              type: "MIXED",
              content: {
                ...content,
                answers: [],
                parts: [
                  {
                    id: "p1",
                    type: "SUBJECTIVE",
                    stem: "第一小问",
                    score: 4,
                    answers: ["子题参考A"],
                    explanation: "子题解析A",
                    rubric: "子题标准A",
                    options: [],
                    knowledgeTags: [],
                  },
                  {
                    id: "p2",
                    type: "SUBJECTIVE",
                    stem: "第二小问",
                    score: 6,
                    answers: ["子题参考B"],
                    explanation: "子题解析B",
                    rubric: "子题标准B",
                    options: [],
                    knowledgeTags: [],
                  },
                ],
              },
            },
          },
        ],
      },
    ],
    submissions: ["self", "peer"].map((studentId) => ({
      id: `scan-${studentId}`,
      assessmentId: "exam",
      studentId,
      paperId: "paper",
      sourceFiles: [`/${studentId}-original`],
      answers: [
        {
          itemId: "full",
          text: studentId === "self" ? "本人满分作答" : "PEER_SECRET",
          images: [`/${studentId}-full-image`],
        },
        { itemId: "mixed", text: "本人综合题作答", images: ["/self-mixed1", "/self-mixed2"] },
      ],
    })),
    analytics: {
      results: ["self", "peer"].map((studentId) => ({
        assessmentId: "exam",
        studentId,
        subjects: [
          {
            paperId: "paper",
            subject: "数学",
            participationStatus: "REQUIRED",
            rawScore: 23,
            score: 90,
            maxScore: 25,
            grades: [
              {
                itemId: "full",
                status: "FINAL",
                score: 5,
                maxScore: 5,
                feedback: studentId === "self" ? "满分仍有老师建议" : "PEER_FEEDBACK",
              },
              {
                itemId: "mixed",
                status: "FINAL",
                score: 18,
                maxScore: 20,
                feedback: "整体反馈",
                partScores: [
                  { partId: "p1", score: 8, feedback: "正确小问建议" },
                  { partId: "p2", score: 10, feedback: "失分小问建议" },
                ],
              },
            ],
          },
        ],
      })),
      students: [],
      classrooms: [],
      knowledge: [],
    },
  } as unknown as PlatformState;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state = fixture();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});
async function render(refresh?: () => Promise<void>) {
  await act(async () =>
    root.render(<StudentAnswerFeedback state={state} assessmentId="exam" refresh={refresh} />),
  );
}
it("shows all own questions, including full marks, images and original pages without peer answers", async () => {
  await render();
  expect(container.querySelectorAll('article[aria-label$="题作答与反馈"]')).toHaveLength(2);
  expect(container.textContent).toContain("本人满分作答");
  expect(container.textContent).toContain("满分仍有老师建议");
  expect(container.textContent).toContain("原始分：23 / 25 · 赋分：90");
  expect([...container.querySelectorAll("img")].map((image) => image.getAttribute("src"))).toEqual([
    "/self-full-image",
    "/self-mixed1",
    "/self-mixed2",
  ]);
  expect(container.querySelector('a[href="/self-original"]')).not.toBeNull();
  expect(container.innerHTML).not.toContain("PEER_SECRET");
  expect(container.innerHTML).not.toContain("PEER_FEEDBACK");
  expect(container.innerHTML).not.toContain("/peer-");
});
it("shows both correct and incorrect part feedback with the actual paper allocation and collapsible references", async () => {
  await render();
  expect(container.querySelector('[aria-label="第 2 题第 1 小问评分"]')?.textContent).toContain(
    "8 / 8 分",
  );
  expect(container.querySelector('[aria-label="第 2 题第 2 小问评分"]')?.textContent).toContain(
    "10 / 12 分",
  );
  expect(container.textContent).toContain("正确小问建议");
  expect(container.textContent).toContain("失分小问建议");
  const details = [...container.querySelectorAll("details")].find(
    (detail) => detail.querySelector("summary")?.textContent === "查看第 2 题参考答案与解析",
  )!;
  expect(details.open).toBe(false);
  expect(details.textContent).toContain("小问 1 · 8 分");
  expect(details.textContent).toContain("子题参考B");
  expect(state.papers[0].items[1].snapshot.content.parts[0].score).toBe(4);
});
it.each(["ABSENT", "EXEMPT", "WITHDRAWN"] as ParticipationStatus[])(
  "labels %s without presenting retained work or a zero score",
  async (status) => {
    state.assessments[0].participants[0].subjects[0] = {
      paperId: "paper",
      status,
      reason: "登记说明",
    };
    await render();
    expect(container.textContent).toContain(
      { ABSENT: "缺考", EXEMPT: "免考", WITHDRAWN: "退出", REQUIRED: "" }[status],
    );
    expect(container.textContent).toContain("不计零分");
    expect(container.textContent).toContain("登记说明");
    expect(container.textContent).not.toContain("本人满分作答");
    expect(container.querySelector("article")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  },
);
it.each(["unpublished", "unconfirmed", "not-student"])(
  "never renders answer data for %s state",
  async (condition) => {
    if (condition === "unpublished") state.assessments[0].published = false;
    if (condition === "unconfirmed") state.assessments[0].rosterStatus = "NEEDS_REVIEW";
    if (condition === "not-student") state.actor.role = "TEACHER";
    await render();
    expect(container.innerHTML).toBe("");
  },
);
it("requires the live account binding as well as the saved participant identity", async () => {
  state.classrooms[0].students[0].userId = "other-account";
  await render();
  expect(container.textContent).toContain("没有可查看的本人作答记录");
  expect(container.textContent).not.toContain("本人满分作答");
});
it("keeps displayed feedback and a retry action on a failed read, and hides after publication is withdrawn", async () => {
  const refresh = vi
    .fn()
    .mockRejectedValueOnce(new Error("读取失败"))
    .mockImplementationOnce(async () => {
      state = { ...state, assessments: [{ ...state.assessments[0], published: false }] };
      root.render(<StudentAnswerFeedback state={state} assessmentId="exam" refresh={refresh} />);
    });
  await render(refresh);
  await act(async () => container.querySelector("button")!.click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("读取失败");
  expect(container.textContent).toContain("本人满分作答");
  await act(async () => container.querySelector("button")!.click());
  expect(container.innerHTML).toBe("");
  expect(refresh).toHaveBeenCalledTimes(2);
});
it("does not invent answers or small-question feedback when archived fields are missing", async () => {
  state.submissions = [];
  state.analytics.results[0].subjects[0].grades[1].partScores = [];
  await render();
  expect(container.textContent).toContain("未保留本题作答内容");
  expect(container.textContent).toContain("尚无小问评分");
  expect(container.textContent).toContain("本小问暂无文字反馈");
});
it("shows the paper's shared reading before its anchored question in the published answer review", async () => {
  state.papers[0].instructions = "先读公共文章再作答";
  state.papers[0].layout = {
    paperSize: "A4",
    columns: 1,
    textBlocks: [
      { id: "reading", beforeQuestionId: "mixed-q", text: "公共文章：原题使用的完整阅读材料" },
    ],
  };
  await render();
  expect(container.textContent).toContain("先读公共文章再作答");
  const block = container.querySelector('[aria-label="数学第2题前说明与共享阅读材料"]')!;
  expect(block.textContent).toContain("公共文章：原题使用的完整阅读材料");
  expect(block.nextElementSibling?.getAttribute("aria-label")).toBe("第 2 题作答与反馈");
  state.assessments[0].published = false;
  await render();
  expect(container.innerHTML).toBe("");
});
