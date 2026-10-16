// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  PracticeAttemptDetail,
  PracticeCommand,
  PracticeEvaluation,
  PracticeHistory,
  PracticeSessionDetail,
} from "@/contracts/practice";
import { PracticeWorkspace } from "@/components/practice/workspace";
import { apiRequest } from "@/lib/http-client";

vi.mock("@/lib/http-client", async (original) => ({
  ...(await original<typeof import("@/lib/http-client")>()),
  apiRequest: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/platform/use-ai-progress", () => ({
  useAiProgress: () => ({ models: [], jobs: [], loading: false, failure: "", reconnect: vi.fn() }),
}));
const api = vi.mocked(apiRequest);
let host: HTMLDivElement, root: Root, detail: PracticeSessionDetail;

function evaluation(sequence: number): PracticeEvaluation {
  return {
    id: `evaluation-${sequence}`,
    attemptId: `attempt-${sequence}`,
    version: 1,
    source: "TEACHER_CONFIRMED",
    actorId: "teacher",
    actorName: "张老师",
    createdAt: `2026-10-${15 + sequence}T04:00:00Z`,
    candidateId: null,
    aiJobId: null,
    evaluation: {
      summary: `第${sequence}轮核验说明`,
      items: [{ itemId: "item", judgment: "CORRECT", feedback: "推导正确", parts: [] }],
    },
  };
}
function submitted(sequence: number): PracticeSessionDetail {
  const eligibility = [
    {
      itemId: "item",
      originalQuestionId: "question",
      promptFingerprint: "c".repeat(64),
      eligibility: "UNEXPOSED_IN_SYSTEM" as const,
      reasons: [],
    },
  ];
  return {
    actor: { id: "student-user", name: "李同学", role: "STUDENT" },
    timezone: "Asia/Shanghai",
    session: {
      id: "session",
      version: sequence * 2,
      sourceKind: "SET",
      setId: "set",
      name: "函数练习",
      subject: "数学",
      student: {
        studentId: "student",
        userId: "student-user",
        name: "李同学",
        studentNumber: "1001",
        classroomId: "class",
        classroomName: "一班",
        stage: "高中",
        cohort: "2028届",
      },
      status: "SUBMITTED",
      createdAt: "2026-10-15T01:00:00Z",
      submittedAt: `2026-10-${15 + sequence}T03:00:00Z`,
      attemptCount: sequence,
      currentAttemptId: `attempt-${sequence}`,
      reviewRequestedAt: null,
      feedbackState: "TEACHER_CONFIRMED",
    },
    papers: [
      {
        id: "paper",
        name: "函数练习",
        subject: "数学",
        instructions: "独立作答",
        textBlocks: [],
        studentImageUrls: [],
        items: [
          {
            id: "item",
            position: 0,
            score: 10,
            section: "",
            type: "SUBJECTIVE",
            stem: "说明函数变化",
            options: [],
            parts: [],
            studentImageUrls: [],
          },
        ],
      },
    ],
    draft: { version: 1, answers: [], updatedAt: "2026-10-15T02:00:00Z" },
    currentAttempt: {
      id: `attempt-${sequence}`,
      sessionId: "session",
      sequence,
      submittedAt: `2026-10-${15 + sequence}T03:00:00Z`,
      attemptFingerprint: "a".repeat(64),
      contentFingerprint: "b".repeat(64),
      evaluationVersion: 1,
      eligibility,
      canSelfAssess: false,
      canRequestReview: true,
      canRequestAi: false,
      canConfirmReview: false,
      blockReasons: [],
    },
    evaluations: [evaluation(sequence)],
    reference: null,
    revealedItemIds: [],
    eligibility,
    capabilities: {
      canSaveDraft: false,
      canUpload: false,
      canSubmit: false,
      canRetry: true,
      canRevealReference: false,
      canViewHistory: true,
      blockReasons: [],
    },
  };
}
function makeRetry() {
  detail.session.status = "DRAFT";
  detail.session.version++;
  detail.session.feedbackState = "NONE";
  detail.draft = { version: 2, answers: [], updatedAt: "2026-10-17T05:00:00Z" };
  detail.currentAttempt!.canRequestReview = false;
  detail.capabilities = {
    ...detail.capabilities,
    canSaveDraft: true,
    canUpload: true,
    canSubmit: true,
    canRetry: false,
  };
}
function historical(sequence: number): PracticeAttemptDetail {
  const original = submitted(sequence);
  return {
    actor: original.actor,
    timezone: original.timezone,
    session: structuredClone(detail.session),
    attempt: original.currentAttempt!,
    papers: original.papers,
    answers: [{ itemId: "item", text: `第${sequence}轮原始作答`, images: [] }],
    reference: null,
    evaluations: original.evaluations,
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  detail = submitted(1);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  api.mockImplementation(async (url, init) => {
    if (url === "/api/platform/practice/sessions/session") return structuredClone(detail) as never;
    if (url === "/api/platform/practice/commands") {
      const command = JSON.parse(String(init?.body)) as PracticeCommand;
      if (command.type === "practice.review.request") {
        detail.session.version++;
        detail.session.reviewRequestedAt = "2026-10-17T06:00:00Z";
        detail.session.feedbackState = "WAITING";
        return {
          id: "session",
          sessionId: "session",
          version: detail.session.version,
          attemptId: detail.currentAttempt!.id,
          evaluationVersion: detail.currentAttempt!.evaluationVersion,
        } as never;
      }
      if (command.type !== "practice.retry") throw new Error("Unexpected command");
      makeRetry();
      return {
        id: "session",
        sessionId: "session",
        version: detail.session.version,
        draftVersion: 2,
      } as never;
    }
    if (url.includes("/history?"))
      return {
        sessionId: "session",
        timezone: detail.timezone,
        events: [],
        attempts: [historical(2), historical(1)],
        nextBeforeId: null,
      } satisfies PracticeHistory as never;
    throw new Error(`Unexpected ${url}`);
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
async function render() {
  await act(async () => root.render(<PracticeWorkspace sessionId="session" />));
}
async function click(label: string) {
  const button = [...host.querySelectorAll("button")].find((entry) => entry.textContent === label);
  if (!button) throw new Error(`Missing ${label}`);
  await act(async () => button.click());
}
function feedbackHeadings(element: Element = host) {
  return [...element.querySelectorAll("h3")].map((entry) => entry.textContent);
}
it("opens the exact evidence source's first submission and evaluation while the current session is on its third attempt", async () => {
  detail = submitted(3);
  const source = historical(1);
  api.mockImplementation(async (url) => {
    expect(url).toBe(
      "/api/platform/practice/sessions/session/history?attemptId=attempt-1&evaluationId=evaluation-1",
    );
    return {
      sessionId: "session",
      timezone: detail.timezone,
      events: [],
      attempts: [source],
      nextBeforeId: null,
    } as PracticeHistory as never;
  });
  await act(async () =>
    root.render(
      <PracticeWorkspace
        sessionId="session"
        source={{ attemptId: "attempt-1", evaluationId: "evaluation-1" }}
      />,
    ),
  );
  expect(host.textContent).toContain("证据来源 · 第 1 次提交");
  expect(host.textContent).toContain("第1轮原始作答");
  expect(host.textContent).toContain("第1轮核验说明");
  expect(host.textContent).not.toContain("第3轮核验说明");
  expect(host.querySelector("textarea")).toBeNull();
  expect(host.querySelector('a[href="/learning/practice/session"]')?.textContent).toBe(
    "返回当前练习",
  );
});
it("shows a failed evidence source read with retry instead of falling back to current-attempt feedback", async () => {
  detail = submitted(3);
  api.mockRejectedValue(new Error("记录不存在或无权访问"));
  await act(async () =>
    root.render(
      <PracticeWorkspace
        sessionId="session"
        source={{ attemptId: "missing", evaluationId: "foreign" }}
      />,
    ),
  );
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("无权访问");
  expect(host.textContent).not.toContain("第3轮核验说明");
  expect(host.querySelector("textarea")).toBeNull();
});
it("keeps the prior teacher feedback explicitly historical after creating a retry draft", async () => {
  await render();
  await click("开始下一轮再练");
  await click("确认创建下一轮草稿");
  expect(host.textContent).toContain("练习草稿 · 本轮尚未提交、尚未核验");
  expect(host.textContent).toContain("上次提交回执：第 1 次提交");
  expect(host.textContent).toContain(
    "以下为上次第 1 次提交的历史反馈；本轮草稿尚未提交、尚未核验。",
  );
  expect(feedbackHeadings()).toContain("第 1 次提交 · 教师已核验 · 记录版本 v1");
  expect(host.textContent).toContain("第1轮核验说明");
  expect(host.querySelector("textarea")).not.toBeNull();
});
it("labels feedback for a newer submitted attempt by submission sequence rather than its reset version", async () => {
  detail = submitted(2);
  await render();
  expect(feedbackHeadings()).toContain("第 2 次提交 · 教师已核验 · 记录版本 v1");
  expect(feedbackHeadings()).not.toContain("第 1 次提交 · 教师已核验 · 记录版本 v1");
  expect(host.textContent).not.toContain("上次第 2 次提交的历史反馈");
  expect(host.textContent).not.toContain("本轮尚未提交、尚未核验");
});
it("labels every historical attempt's feedback with its own sequence even when all versions are v1", async () => {
  detail = submitted(2);
  makeRetry();
  await render();
  await click("读取练习历史");
  for (const disclosure of host.querySelectorAll("details")) disclosure.open = true;
  const history = [...host.querySelectorAll("details")];
  const first = history.find(
    (entry) => entry.querySelector("summary")?.textContent === "查看第 1 次提交与反馈记录",
  );
  const second = history.find(
    (entry) => entry.querySelector("summary")?.textContent === "查看第 2 次提交与反馈记录",
  );
  expect(first).toBeDefined();
  expect(second).toBeDefined();
  expect(feedbackHeadings(first!)).toContain("第 1 次提交 · 教师已核验 · 记录版本 v1");
  expect(feedbackHeadings(second!)).toContain("第 2 次提交 · 教师已核验 · 记录版本 v1");
});
it("keeps a real re-review request pending after refresh while retaining the prior teacher confirmation", async () => {
  await render();
  expect(host.textContent).toContain("教师核验已完成");
  await click("请求教师核验");
  const input = host.querySelector<HTMLTextAreaElement>("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      input,
      "请再核对函数区间",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click("确认请求教师核验");
  const posts = () => api.mock.calls.filter(([url]) => url === "/api/platform/practice/commands");
  expect(JSON.parse(String(posts()[0][1]?.body))).toMatchObject({
    type: "practice.review.request",
    attemptId: "attempt-1",
    expectedEvaluationVersion: 1,
    message: "请再核对函数区间",
  });
  expect(host.textContent).toContain("已提交 · 已请求教师核验，待教师处理");
  expect(host.textContent).not.toContain("教师核验已完成");
  expect(feedbackHeadings()).toContain("第 1 次提交 · 教师已核验 · 记录版本 v1 · 复核前版本");
  expect(host.textContent).toContain("第1轮核验说明");
  expect(host.textContent).toContain("本次核验请求尚待教师处理");
  await click("重新读取本次练习");
  expect(posts()).toHaveLength(1);
  expect(host.textContent).toContain("已提交 · 已请求教师核验，待教师处理");
  expect(feedbackHeadings()).toContain("第 1 次提交 · 教师已核验 · 记录版本 v1 · 复核前版本");
  detail.session.reviewRequestedAt = null;
  detail.session.feedbackState = "TEACHER_CONFIRMED";
  detail.currentAttempt!.evaluationVersion = 2;
  detail.evaluations.push({
    ...evaluation(1),
    id: "corrected",
    version: 2,
    evaluation: { ...evaluation(1).evaluation, summary: "教师复核后的新确认" },
  });
  await click("重新读取本次练习");
  expect(host.textContent).toContain("教师核验已完成");
  expect(host.textContent).not.toContain("本次核验请求尚待教师处理");
  expect(feedbackHeadings()).toContain("第 1 次提交 · 教师已核验 · 记录版本 v2");
  expect(host.textContent).toContain("第1轮核验说明");
  expect(host.textContent).toContain("教师复核后的新确认");
});
