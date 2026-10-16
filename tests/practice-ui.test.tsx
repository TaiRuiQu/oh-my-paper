// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  PracticeAnswerEditor,
  type PracticeLocalAnswer,
} from "@/components/practice/answer-editor";
import type {
  PracticeAttemptDetail,
  PracticeCommand,
  PracticeCommandResult,
  PracticeSessionDetail,
  PracticeSources,
  PracticeSetPreview,
  PracticeSetDetail,
  PracticeEvidence,
  PracticeReviews,
  PracticeSessions,
  PracticeSessionSummary,
} from "@/contracts/practice";
import {
  PracticeWorkspace,
  PracticeTeachingWorkspace,
  PracticeReviewWorkspace,
  PracticeEvidenceWorkspace,
} from "@/components/practice/workspace";
import { PracticeProvider, usePractice } from "@/components/practice/provider";
import type { HomeworkStudentPaper } from "@/contracts/homework";
import type { AiJobDTO } from "@/contracts/platform-ai";
import { apiRequest, ApiRequestError } from "@/lib/http-client";
vi.mock("@/lib/http-client", async (original) => ({
  ...(await original<typeof import("@/lib/http-client")>()),
  apiRequest: vi.fn(),
}));
const { push, progress } = vi.hoisted(() => ({
  push: vi.fn(),
  progress: {
    models: [] as { id: string; name: string }[],
    jobs: [] as AiJobDTO[],
    completed: async () => {},
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/components/platform/use-ai-progress", () => ({
  useAiProgress: ({ onCompleted }: { onCompleted: () => Promise<void> }) => {
    progress.completed = onCompleted;
    return {
      models: progress.models,
      jobs: progress.jobs,
      loading: false,
      failure: "",
      reconnect: vi.fn(),
    };
  },
}));
const api = vi.mocked(apiRequest);
let host: HTMLDivElement, root: Root;
const image = (n: number) =>
  `/api/platform/assets/00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const paper: HomeworkStudentPaper = {
  id: "paper",
  name: "函数练习",
  subject: "数学",
  instructions: "请独立完成",
  textBlocks: [{ id: "reading", text: "共用图像材料", beforeQuestionId: "item" }],
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
beforeEach(() => {
  vi.resetAllMocks();
  progress.models = [];
  progress.jobs = [];
  setupFixtures();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
async function render(node: ReactNode) {
  await act(async () => root.render(node));
}
function button(text: string) {
  const result = [...host.querySelectorAll("button")].find((entry) => entry.textContent === text);
  if (!result) throw new Error(`Missing ${text}`);
  return result;
}
async function click(text: string) {
  await act(async () => button(text).click());
}
async function fill(label: string, value: string) {
  const field = [...host.querySelectorAll("label")]
    .find((entry) => entry.querySelector("span")?.textContent === label)
    ?.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      "input,textarea,select",
    );
  if (!field) throw new Error(`Missing ${label}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")!.set!.call(field, value);
    field.dispatchEvent(
      new Event(field.tagName === "SELECT" ? "change" : "input", { bubbles: true }),
    );
  });
}
it("keeps successful images in upload order, blocks unresolved set until explicit addition and retries failed pages", async () => {
  const upload = vi
      .fn()
      .mockResolvedValueOnce(image(1))
      .mockRejectedValueOnce(new Error("第二张上传失败"))
      .mockResolvedValueOnce(image(2)),
    onChange = vi.fn(),
    onUnresolved = vi.fn();
  await render(
    <PracticeAnswerEditor
      papers={[paper]}
      answers={[]}
      onChange={onChange}
      disabled={false}
      upload={upload}
      onUploading={vi.fn()}
      onUnresolved={onUnresolved}
    />,
  );
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  await act(async () => {
    Object.defineProperty(input, "files", {
      value: [
        new File(["1"], "first.png", { type: "image/png" }),
        new File(["2"], "second.png", { type: "image/png" }),
      ],
      configurable: true,
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(onChange).not.toHaveBeenCalled();
  expect(onUnresolved).toHaveBeenLastCalledWith(true);
  expect(button("按上传顺序加入本题作答").disabled).toBe(true);
  await click("重试第 2 张上传");
  expect(onUnresolved).toHaveBeenLastCalledWith(true);
  await click("按上传顺序加入本题作答");
  expect(onChange).toHaveBeenLastCalledWith([
    { itemId: "item", text: "", images: [image(1), image(2)] },
  ] satisfies PracticeLocalAnswer[]);
  expect(onUnresolved).toHaveBeenLastCalledWith(false);
});
it("uses a safe prompt and disables all answer controls during an operation", async () => {
  await render(
    <PracticeAnswerEditor
      papers={[paper]}
      answers={[]}
      onChange={vi.fn()}
      disabled
      upload={vi.fn()}
      onUploading={vi.fn()}
      onUnresolved={vi.fn()}
    />,
  );
  expect(host.textContent).toContain("说明函数变化");
  expect(host.textContent).not.toContain("参考答案");
  expect(
    [...host.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input,textarea")].every(
      (entry) => entry.disabled,
    ),
  ).toBe(true);
  const text = host.textContent!;
  expect(text.indexOf("共用图像材料")).toBeLessThan(text.indexOf("说明函数变化"));
});
let session: PracticeSessionDetail,
  sources: PracticeSources,
  preview: PracticeSetPreview,
  review: PracticeAttemptDetail,
  evidence: PracticeEvidence,
  setDetail: PracticeSetDetail;
const actor = { id: "student-user", name: "李同学", role: "STUDENT" as const };
const teacher = { id: "teacher", name: "张老师", role: "TEACHER" as const };
function setupFixtures() {
  const student = {
    studentId: "student",
    userId: "student-user",
    name: "李同学",
    studentNumber: "1001",
    classroomId: "class",
    classroomName: "一班",
    stage: "高中",
    cohort: "2028届",
  };
  const eligibility = [
    {
      itemId: "item",
      originalQuestionId: "question",
      promptFingerprint: "a".repeat(64),
      eligibility: "UNEXPOSED_IN_SYSTEM" as const,
      reasons: ["系统未提供参考"],
    },
  ];
  const summary = {
    id: "session",
    version: 1,
    sourceKind: "SET" as const,
    setId: "set",
    name: "函数巩固",
    subject: "数学",
    student,
    status: "DRAFT" as const,
    createdAt: "2026-10-15T01:00:00Z",
    submittedAt: null,
    attemptCount: 0,
    currentAttemptId: null,
    reviewRequestedAt: null,
    feedbackState: "NONE" as const,
  };
  session = {
    actor,
    timezone: "Asia/Shanghai",
    session: summary,
    papers: [structuredClone(paper)],
    draft: { version: 0, answers: [], updatedAt: null },
    currentAttempt: null,
    evaluations: [],
    reference: null,
    revealedItemIds: [],
    eligibility,
    capabilities: {
      canSaveDraft: true,
      canUpload: true,
      canSubmit: true,
      canRetry: false,
      canRevealReference: true,
      canViewHistory: true,
      blockReasons: [],
    },
  };
  const set = {
    id: "set",
    version: 1,
    name: "函数巩固",
    subject: "数学",
    classroomId: "class",
    classroomName: "一班",
    status: "OPEN" as const,
    publishedAt: "2026-10-15T00:00:00Z",
    ownerName: "张老师",
    itemCount: 1,
    canStart: true,
    canClose: true,
    blockReasons: [],
  };
  sources = {
    actor,
    sets: [set],
    replayPapers: [],
    publishPapers: [],
    ownStudents: [student],
    canPublish: false,
    nextBeforeId: null,
    nextPaperBeforeId: null,
  };
  const fullPaper = {
    id: "paper",
    ownerId: "teacher",
    name: "函数练习",
    kind: "HOMEWORK" as const,
    subject: "数学",
    grade: "高中一年级",
    instructions: `请参照 ![纸级材料](${image(1)})`,
    layout: {
      paperSize: "A4" as const,
      columns: 1,
      textBlocks: [{ id: "block", text: "共用图像材料", beforeQuestionId: "question" }],
    },
    createdAt: "2026-10-15T00:00:00Z",
    updatedAt: "2026-10-15T00:00:00Z",
    items: [
      {
        id: "item",
        questionId: "question",
        position: 0,
        score: 10,
        section: "",
        snapshot: {
          id: "question",
          ownerId: "teacher",
          type: "SUBJECTIVE" as const,
          subject: "数学",
          grade: "高中一年级",
          difficulty: 0.5,
          knowledgeTags: ["函数"],
          createdAt: "2026-10-15T00:00:00Z",
          updatedAt: "2026-10-15T00:00:00Z",
          content: {
            stem: `说明函数变化 ![解析图](${image(2)})`,
            options: [],
            answers: ["教师标准答案"],
            explanation: "教师解析",
            rubric: "评分依据",
            parts: [],
            images: [image(2)],
          },
        },
      },
    ],
  };
  preview = {
    actor: teacher,
    paper: fullPaper,
    studentPaper: structuredClone(paper),
    allowedStudentImageUrls: [image(1)],
    suggestedStudentImageUrls: [image(1)],
    items: [{ itemId: "item", allowedStudentImageUrls: [image(2)], suggestedStudentImageUrls: [] }],
    classrooms: [{ id: "class", name: "一班", stage: "高中", cohort: "2028届" }],
    canPublish: true,
    blockReasons: [],
  };
  const attempt = {
    id: "attempt",
    sessionId: "session",
    sequence: 1,
    submittedAt: "2026-10-15T02:00:00Z",
    attemptFingerprint: "a".repeat(64),
    contentFingerprint: "b".repeat(64),
    evaluationVersion: 0,
    eligibility,
    canSelfAssess: true,
    canRequestReview: true,
    canRequestAi: true,
    canConfirmReview: true,
    blockReasons: [],
  };
  review = {
    actor: teacher,
    timezone: "Asia/Shanghai",
    session: {
      ...summary,
      status: "SUBMITTED",
      currentAttemptId: "attempt",
      attemptCount: 1,
      feedbackState: "WAITING",
    },
    attempt,
    papers: [structuredClone(paper)],
    answers: [{ itemId: "item", text: "原轮次提交", images: [] }],
    reference: {
      items: [
        {
          itemId: "item",
          answers: ["教师标准答案"],
          explanation: "完整解析",
          rubric: "评分依据",
          images: [],
          parts: [],
        },
      ],
    },
    evaluations: [],
  };
  evidence = {
    actor,
    timezone: "Asia/Shanghai",
    studentId: "student",
    items: [],
    summary: {
      submittedAttempts: 0,
      distinctQuestions: 0,
      unexposedQuestions: 0,
      repeatedOrAssistedQuestions: 0,
      selfAssessed: 0,
      aiCandidates: 0,
      teacherConfirmed: 0,
      lastEvidenceAt: null,
    },
    nextBeforeId: null,
  };
  setDetail = { actor: teacher, set, fullPaper, studentPaper: paper };
  api.mockImplementation(async (url, init) => {
    if (url === "/api/platform/practice/commands") {
      const c = JSON.parse(String(init?.body)) as PracticeCommand;
      if (c.type === "practice.draft.save") {
        session.session.version++;
        session.draft = {
          version: (session.draft?.version ?? 0) + 1,
          answers: c.answers,
          updatedAt: "2026-10-15T02:00:00Z",
        };
      }
      if (c.type === "practice.submit") {
        session.session.version++;
        session.session.status = "SUBMITTED";
        session.session.feedbackState = "WAITING";
        session.currentAttempt = structuredClone(attempt);
        session.capabilities.canSaveDraft = false;
        session.capabilities.canSubmit = false;
        session.capabilities.canRetry = true;
        session.session.currentAttemptId = "attempt";
        session.session.attemptCount = 1;
      }
      if (c.type === "practice.reference.reveal") {
        session.session.version++;
        session.reference = review.reference;
        session.revealedItemIds = c.itemIds;
      }
      if (c.type === "practice.self-assess") {
        session.currentAttempt!.evaluationVersion++;
        session.evaluations.push({
          id: "self",
          attemptId: "attempt",
          version: session.currentAttempt!.evaluationVersion,
          source: "SELF",
          actorId: actor.id,
          actorName: actor.name,
          createdAt: "2026-10-15T03:00:00Z",
          candidateId: null,
          aiJobId: null,
          evaluation: c.evaluation,
        });
        session.session.feedbackState = "SELF";
      }
      if (c.type === "practice.retry") {
        session.session.version++;
        session.session.status = "DRAFT";
        session.draft = { version: 0, answers: [], updatedAt: null };
        session.capabilities.canSaveDraft = true;
        session.capabilities.canSubmit = true;
        session.capabilities.canRetry = false;
        session.eligibility = session.eligibility.map((entry) => ({
          ...entry,
          eligibility: "REPEAT",
        }));
      }
      return {
        id: c.type === "practice.set.publish" ? "set" : "session",
        version: session.session.version,
        sessionId: "session",
        setId: "set",
        attemptId: "attempt",
        sequence: 1,
      } satisfies PracticeCommandResult as never;
    }
    if (url === "/api/platform/practice/sources") return structuredClone(sources) as never;
    if (url === "/api/platform/practice/sessions/session") return structuredClone(session) as never;
    if (url === "/api/platform/practice/sessions")
      return { actor, sessions: [], nextBeforeId: null } satisfies PracticeSessions as never;
    if (url.includes("/history?"))
      return {
        sessionId: "session",
        events: [],
        attempts: [{ ...review, actor }],
        nextBeforeId: null,
      } as never;
    if (url === "/api/platform/practice/sets/paper/preview")
      return structuredClone(preview) as never;
    if (url === "/api/platform/practice/sets/set") return structuredClone(setDetail) as never;
    if (url === "/api/platform/practice/reviews/attempt") return structuredClone(review) as never;
    if (url === "/api/platform/practice/reviews")
      return {
        actor: teacher,
        timezone: "Asia/Shanghai",
        attempts: [{ session: review.session, attempt: review.attempt }],
        nextBeforeId: null,
      } satisfies PracticeReviews as never;
    if (url === "/api/platform/practice/evidence") return structuredClone(evidence) as never;
    throw new Error(`Unexpected ${url}`);
  });
}
function commands() {
  return api.mock.calls
    .filter(([url]) => url === "/api/platform/practice/commands")
    .map(([, init]) => JSON.parse(String(init?.body)) as PracticeCommand);
}
async function checked(text: string) {
  const input = [...host.querySelectorAll("label")]
    .find((entry) => entry.textContent?.includes(text))
    ?.querySelector<HTMLInputElement>('input[type="checkbox"]');
  expect(input).toBeTruthy();
  await act(async () => input!.click());
}
function value(label: string) {
  return [...host.querySelectorAll("label")]
    .find((entry) => entry.querySelector("span")?.textContent === label)
    ?.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      "input,textarea,select",
    )?.value;
}
async function showSubmitted() {
  session.session.status = "SUBMITTED";
  session.session.version = 2;
  session.currentAttempt = structuredClone(review.attempt);
  session.capabilities.canSaveDraft = false;
  session.capabilities.canSubmit = false;
  session.capabilities.canRetry = true;
  await render(<PracticeWorkspace sessionId="session" />);
}
it("starts without a published formal report, reads only independent practice DTOs and starts one session", async () => {
  await render(<PracticeWorkspace />);
  expect(host.textContent).toContain("暂无练习记录");
  expect(host.textContent).not.toContain("教师标准答案");
  await click("领取并开始函数巩固");
  expect(commands()[0]).toMatchObject({
    type: "practice.start",
    source: { kind: "SET", setId: "set", studentId: "student", expectedVersion: 1 },
  });
  expect(host.querySelector('a[href="/learning/practice/session"]')).not.toBeNull();
  expect(api.mock.calls.every(([url]) => url.startsWith("/api/platform/practice/"))).toBe(true);
  expect(button("领取并开始函数巩固").disabled).toBe(true);
});
it("locks only the started claim target and keeps other sets and replay papers claimable", async () => {
  sources.sets = [sources.sets[0], { ...setDetail.set, id: "set-b", name: "几何提升" }];
  sources.replayPapers = [
    {
      id: "replay-paper",
      name: "期中复习卷",
      subject: "数学",
      updatedAt: preview.paper.updatedAt,
      itemCount: 1,
    },
  ];
  const original = api.getMockImplementation()!;
  api.mockImplementation(async (url, init) => {
    if (url.endsWith("/commands")) {
      const command = JSON.parse(String(init?.body)) as PracticeCommand;
      const replay = command.type === "practice.start" && command.source.kind === "REPLAY";
      return {
        id: replay ? "replay-session" : "session",
        version: 1,
        sessionId: replay ? "replay-session" : "session",
      } satisfies PracticeCommandResult as never;
    }
    return original(url, init);
  });
  await render(<PracticeWorkspace />);
  await click("领取并开始函数巩固");
  expect(button("领取并开始函数巩固").disabled).toBe(true);
  expect(button("领取并开始几何提升").disabled).toBe(false);
  expect(button("开始复现期中复习卷").disabled).toBe(false);
  expect(host.querySelector('a[href="/learning/practice/session"]')).not.toBeNull();
  expect(host.textContent).toContain("可直接继续领取其他练习或复习卷");
  await click("开始复现期中复习卷");
  expect(commands()[1]).toMatchObject({
    type: "practice.start",
    source: { kind: "REPLAY", paperId: "replay-paper", studentId: "student" },
  });
  expect(button("开始复现期中复习卷").disabled).toBe(true);
  expect(button("领取并开始几何提升").disabled).toBe(false);
  expect(host.querySelector('a[href="/learning/practice/replay-session"]')).not.toBeNull();
});
it("saves exact draft with CAS, then explicitly confirms immutable submission and receipt", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(false);
  await render(<PracticeWorkspace sessionId="session" />);
  await fill("函数练习第 1 题我的作答", "我的函数解释");
  expect(button("确认提交本轮练习").disabled).toBe(true);
  await click("保存练习草稿");
  expect(commands()[0]).toMatchObject({
    type: "practice.draft.save",
    expectedVersion: 1,
    expectedDraftVersion: 0,
    answers: [{ itemId: "item", text: "我的函数解释", images: [] }],
  });
  await click("确认提交本轮练习");
  expect(commands()).toHaveLength(1);
  vi.mocked(window.confirm).mockReturnValue(true);
  await click("确认提交本轮练习");
  expect(commands()[1]).toMatchObject({
    type: "practice.submit",
    expectedVersion: 2,
    expectedDraftVersion: 1,
  });
  expect(host.textContent).toContain("服务端回执：第 1 次提交");
  expect(host.querySelector("textarea")).toBeNull();
});
it("keeps draft after conflict, refuses abandonment and preserves it when explicit reread fails", async () => {
  const original = api.getMockImplementation()!;
  let fail = false;
  api.mockImplementation(async (url, init) => {
    if (url.endsWith("/commands")) throw new ApiRequestError("练习版本冲突", 409);
    if (fail && url.endsWith("/session")) throw new Error("重读失败");
    return original(url, init);
  });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  await render(<PracticeWorkspace sessionId="session" />);
  await fill("函数练习第 1 题我的作答", "保留我的草稿");
  await click("保存练习草稿");
  await click("放弃作答并重新读取");
  expect(value("函数练习第 1 题我的作答")).toBe("保留我的草稿");
  expect(confirm).toHaveBeenCalled();
  confirm.mockReturnValue(true);
  fail = true;
  await click("放弃作答并重新读取");
  expect(value("函数练习第 1 题我的作答")).toBe("保留我的草稿");
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(button("保存练习草稿").disabled).toBe(true);
});
it("records explicit reference reveal, keeps it apart from draft and warns before exposing answers", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  await render(<PracticeWorkspace sessionId="session" />);
  expect(host.textContent).not.toContain("教师标准答案");
  await click("明确查看参考答案与解析");
  expect(commands()).toHaveLength(0);
  confirm.mockReturnValue(true);
  await click("明确查看参考答案与解析");
  expect(commands()[0]).toMatchObject({
    type: "practice.reference.reveal",
    expectedVersion: 1,
    itemIds: ["item"],
  });
  expect(host.textContent).toContain("教师标准答案");
  expect(host.textContent).toContain("完整解析");
});
it("records SELF distinctly, allows a repeat and preserves exposed/repeated eligibility", async () => {
  await showSubmitted();
  await click("记录本人自评");
  await fill("第 1 题核对结果", "CORRECT");
  await fill("第 1 题核对说明", "对照参考完成自评");
  await click("保存本人自评");
  expect(commands()[0]).toMatchObject({
    type: "practice.self-assess",
    expectedEvaluationVersion: 0,
    evaluation: {
      items: [{ itemId: "item", judgment: "CORRECT", feedback: "对照参考完成自评", parts: [] }],
    },
  });
  expect(host.textContent).toContain("本人自评（不计教师确认）");
  await click("开始下一轮再练");
  await click("确认创建下一轮草稿");
  expect(commands().at(-1)).toMatchObject({ type: "practice.retry", copyPreviousAnswers: false });
  expect(host.textContent).toContain("原题复现或再次练习");
  expect(host.querySelector("textarea")).not.toBeNull();
});
it("requires reason for skipped/unclear self judgments instead of fabricating zero", async () => {
  await showSubmitted();
  await click("记录本人自评");
  await fill("第 1 题核对结果", "SKIPPED");
  expect(host.querySelector("form")!.checkValidity()).toBe(false);
  await click("保存本人自评");
  expect(commands()).toHaveLength(0);
  await fill("第 1 题核对说明", "图像看不清，需要补充");
  await click("保存本人自评");
  expect(commands()[0]).toMatchObject({
    evaluation: { items: [{ judgment: "SKIPPED", feedback: "图像看不清，需要补充" }] },
  });
  expect(host.textContent).not.toMatch(/(?:^|[^\d])0 分/);
});
it("publishes only explicitly selected media after full safe preview confirmation", async () => {
  sources.actor = teacher;
  sources.canPublish = true;
  sources.publishPapers = [
    {
      id: "paper",
      name: "函数练习",
      subject: "数学",
      updatedAt: preview.paper.updatedAt,
      itemCount: 1,
    },
  ];
  await render(<PracticeTeachingWorkspace />);
  await fill("选择自有题本发布", "paper");
  expect(
    [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].every(
      (input) => !input.checked,
    ),
  ).toBe(true);
  expect(button("确认发布独立练习").disabled).toBe(true);
  expect(host.textContent).not.toContain("教师标准答案");
  expect(host.textContent).toContain("解析图（未向学生开放）");
  await checked("向学生开放纸级共享材料图 1");
  await checked("我已预览完整题面");
  await click("确认发布独立练习");
  expect(commands()[0]).toMatchObject({
    type: "practice.set.publish",
    paperId: "paper",
    classroomId: "class",
    studentImageUrls: [image(1)],
    items: [{ itemId: "item", studentImageUrls: [] }],
  });
  expect(host.querySelector('a[href="/homework/practice/set"]')).not.toBeNull();
});
it("withholds teacher editing when current subject authority is absent", async () => {
  review.attempt.canConfirmReview = false;
  review.attempt.blockReasons = ["当前无班级学科核验权限"];
  await render(<PracticeReviewWorkspace attemptId="attempt" />);
  expect(host.textContent).toContain("当前无班级学科核验权限");
  expect(host.textContent).toContain("原轮次提交");
  expect(host.textContent).not.toContain("保存教师核验记录");
  expect(host.querySelector("textarea")).toBeNull();
});
it.each<{
  state: PracticeSessionSummary["feedbackState"];
  requested: boolean;
  writable: boolean;
  label: string;
  action: string;
}>([
  { state: "NONE", requested: false, writable: true, label: "尚无反馈", action: "核验本轮提交" },
  {
    state: "WAITING",
    requested: false,
    writable: true,
    label: "已提交 · 待反馈",
    action: "核验本轮提交",
  },
  {
    state: "AI_CANDIDATE",
    requested: false,
    writable: true,
    label: "AI候选 · 待教师核验",
    action: "核验本轮提交",
  },
  {
    state: "SELF",
    requested: false,
    writable: true,
    label: "学生自评 · 未经教师确认",
    action: "核验本轮提交",
  },
  {
    state: "TEACHER_CONFIRMED",
    requested: false,
    writable: true,
    label: "教师核验已完成",
    action: "查看或更正核验",
  },
  {
    state: "WAITING",
    requested: true,
    writable: true,
    label: "已提交 · 待反馈",
    action: "处理核验请求",
  },
  {
    state: "TEACHER_CONFIRMED",
    requested: true,
    writable: true,
    label: "教师核验已完成",
    action: "处理核验请求",
  },
  {
    state: "TEACHER_CONFIRMED",
    requested: false,
    writable: false,
    label: "教师核验已完成",
    action: "查看本轮记录",
  },
  {
    state: "WAITING",
    requested: true,
    writable: false,
    label: "已提交 · 待反馈",
    action: "查看本轮记录",
  },
])(
  "labels submitted records $state requested=$requested writable=$writable without presenting completed reviews as new work",
  async ({ state, requested, writable, label, action }) => {
    review.session.feedbackState = state;
    review.session.reviewRequestedAt = requested ? "2026-10-15T03:00:00Z" : null;
    review.attempt.canConfirmReview = writable;
    await render(<PracticeTeachingWorkspace />);
    const link = host.querySelector<HTMLAnchorElement>(
      'a[href="/homework/practice/reviews/attempt"]',
    )!;
    const row = link.closest("article")!;
    expect(host.textContent).toContain("已提交练习与核验记录");
    expect(row.textContent).toContain(`反馈状态：${label}`);
    expect(link.textContent).toBe(action);
    expect(row.textContent?.includes("学生已请求核验")).toBe(requested);
    expect(row.querySelector("time")?.getAttribute("dateTime") ?? null).toBe(
      review.session.reviewRequestedAt,
    );
    if (state === "TEACHER_CONFIRMED" || !writable || requested)
      expect(row.textContent).not.toContain("核验本轮提交");
  },
);
it("confirms an editable AI candidate with exact version and mandatory human reason", async () => {
  review.attempt.evaluationVersion = 1;
  review.evaluations = [
    {
      id: "candidate",
      attemptId: "attempt",
      version: 1,
      source: "AI_CANDIDATE",
      actorId: "ai",
      actorName: "AI",
      createdAt: "2026-10-15T02:10:00Z",
      candidateId: null,
      aiJobId: "job",
      evaluation: {
        summary: "建议",
        items: [{ itemId: "item", judgment: "CORRECT", feedback: "候选解释", parts: [] }],
      },
    },
  ];
  await render(<PracticeReviewWorkspace attemptId="attempt" />);
  await click("载入AI候选到可编辑表单");
  await fill("第 1 题核对说明", "教师核实后的解释");
  await fill("核验或更正原因", "已检查本轮原作答与参考");
  await click("保存教师核验记录");
  expect(commands()[0]).toMatchObject({
    type: "practice.review.confirm",
    attemptId: "attempt",
    expectedEvaluationVersion: 1,
    candidateId: "candidate",
    reason: "已检查本轮原作答与参考",
    evaluation: { items: [{ feedback: "教师核实后的解释" }] },
  });
});
it("evidence shows source/eligibility provenance without invented mastery percent or official score", async () => {
  evidence.summary.selfAssessed = 1;
  evidence.summary.aiCandidates = 1;
  evidence.summary.teacherConfirmed = 0;
  evidence.items = [
    {
      attemptId: "attempt",
      sessionId: "session",
      itemId: "item",
      partId: null,
      subject: "数学",
      knowledgeTags: ["函数"],
      judgment: "CORRECT",
      source: "SELF",
      eligibility: "ANSWER_AVAILABLE",
      evaluationId: "self",
      evaluationVersion: 1,
      recordedAt: "2026-10-15T03:00:00Z",
    },
  ];
  await render(<PracticeEvidenceWorkspace />);
  expect(host.textContent).toContain("本人自评 1 · AI候选 1 · 教师核验 0");
  expect(host.textContent).toContain("系统已提供参考");
  expect(host.textContent).not.toMatch(/\d+%/);
  expect(host.querySelector('[aria-label="本人练习证据明细"]')?.getAttribute("tabindex")).toBe("0");
  expect(
    host.querySelector('a[href="/learning/practice/session?attemptId=attempt&evaluationId=self"]'),
  ).not.toBeNull();
});
function DoubleWriteProbe() {
  const { write } = usePractice<{ ok: boolean }>();
  return (
    <button
      onClick={async () => {
        const command = {
          type: "practice.draft.save",
          sessionId: "session",
          expectedVersion: 1,
          expectedDraftVersion: 0,
          answers: [],
        } as const;
        await write({ ...command, answers: [] });
        await write({ ...command, answers: [] });
      }}
    >
      同一闭包连续写
    </button>
  );
}
it("synchronously blocks a second write after POST success/read failure before React commits stale state", async () => {
  let reads = 0;
  api.mockImplementation(async (url) => {
    if (url === "/probe") {
      if (++reads > 1) throw new Error("读取失败");
      return { ok: true } as never;
    }
    return { id: "session", version: 2 } as never;
  });
  await render(
    <PracticeProvider path="/probe">
      <DoubleWriteProbe />
    </PracticeProvider>,
  );
  await click("同一闭包连续写");
  expect(commands()).toHaveLength(1);
  expect(host.textContent).toContain("操作已保存");
});
function PathProbe() {
  const { data, write } = usePractice<{ name: string }>();
  return (
    <>
      <p>{data.name}</p>
      <button
        onClick={() =>
          void write({
            type: "practice.draft.save",
            sessionId: "session",
            expectedVersion: 1,
            expectedDraftVersion: 0,
            answers: [],
          })
        }
      >
        写入路径测试
      </button>
    </>
  );
}
it("clears old resource on path change and retains the in-flight write lock across paths", async () => {
  let release!: (value: PracticeCommandResult) => void;
  const wait = new Promise<PracticeCommandResult>((resolve) => {
    release = resolve;
  });
  api.mockImplementation(async (url) =>
    url === "/first"
      ? ({ name: "旧会话" } as never)
      : url === "/second"
        ? ({ name: "新会话" } as never)
        : ((await wait) as never),
  );
  await render(
    <PracticeProvider path="/first">
      <PathProbe />
    </PracticeProvider>,
  );
  await click("写入路径测试");
  await render(
    <PracticeProvider path="/second">
      <PathProbe />
    </PracticeProvider>,
  );
  expect(host.textContent).not.toContain("旧会话");
  expect(host.textContent).toContain("新会话");
  await click("写入路径测试");
  expect(commands()).toHaveLength(1);
  await act(async () => release({ id: "session", version: 2 }));
  expect(host.textContent).not.toContain("操作已保存");
  expect(host.textContent).toContain("新会话");
});
it("preserves accepted save and synchronously locks all further writes after reread fails", async () => {
  const original = api.getMockImplementation()!;
  let saved = false;
  api.mockImplementation(async (url, init) => {
    if (saved && url === "/api/platform/practice/sessions/session") throw new Error("刷新失败");
    const result = await original(url, init);
    if (url.endsWith("/commands")) saved = true;
    return result;
  });
  await render(<PracticeWorkspace sessionId="session" />);
  await fill("函数练习第 1 题我的作答", "已成功保存");
  await click("保存练习草稿");
  expect(host.textContent).toContain("操作已保存");
  expect(value("函数练习第 1 题我的作答")).toBe("已成功保存");
  expect(button("保存练习草稿").disabled).toBe(true);
  expect(button("确认提交本轮练习").disabled).toBe(true);
  expect(commands()).toHaveLength(1);
});
it("reuses the same submit UUID on uncertain transport retry and never retries itself", async () => {
  const original = api.getMockImplementation()!;
  let calls = 0;
  api.mockImplementation(async (url, init) => {
    if (url.endsWith("/commands") && ++calls === 1) throw new Error("响应中断");
    return original(url, init);
  });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  await render(<PracticeWorkspace sessionId="session" />);
  await click("确认提交本轮练习");
  expect(commands()).toHaveLength(1);
  await click("确认提交本轮练习");
  expect(commands()).toHaveLength(2);
  expect(commands()[0]).toMatchObject({
    requestId: (commands()[1] as Extract<PracticeCommand, { type: "practice.submit" }>).requestId,
  });
});
it("keeps upload image controls ordered while native fields are disabled during a queued save", async () => {
  const original = api.getMockImplementation()!;
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  api.mockImplementation(async (url, init) => {
    if (url.endsWith("/commands")) await wait;
    return original(url, init);
  });
  await render(<PracticeWorkspace sessionId="session" />);
  await fill("函数练习第 1 题我的作答", "提交中的输入");
  await click("保存练习草稿");
  expect(
    [
      ...host.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("textarea,input[type=file]"),
    ].every((entry) => entry.disabled),
  ).toBe(true);
  expect(host.querySelector('[aria-label="练习第 1 份第 1 题题面"]')).not.toBeNull();
  expect(button("保存练习草稿").disabled).toBe(true);
  await act(async () => release());
  expect(value("函数练习第 1 题我的作答")).toBe("提交中的输入");
});
it("retains all mixed-question judgments and rationales in manual teacher confirmation", async () => {
  const mixed = review.papers[0].items[0];
  mixed.type = "MIXED";
  mixed.parts = [
    { id: "part1", type: "BLANK", stem: "第一问", options: [], score: 4 },
    { id: "part2", type: "SUBJECTIVE", stem: "第二问", options: [], score: 6 },
  ];
  await render(<PracticeReviewWorkspace attemptId="attempt" />);
  await fill("第 1 题核对结果", "PARTIAL");
  await fill("第 1 题核对说明", "第一问成立，第二问待补充");
  await fill("第 1 题第 1 小问结果", "CORRECT");
  await fill("第 1 题第 1 小问说明", "计算成立");
  await fill("第 1 题第 2 小问结果", "UNSURE");
  await fill("第 1 题第 2 小问说明", "手写图像无法辨认，请补充");
  await fill("核验或更正原因", "逐小问核实");
  await click("保存教师核验记录");
  expect(commands()[0]).toMatchObject({
    evaluation: {
      items: [
        {
          itemId: "item",
          judgment: "PARTIAL",
          parts: [
            { partId: "part1", judgment: "CORRECT", feedback: "计算成立" },
            { partId: "part2", judgment: "UNSURE", feedback: "手写图像无法辨认，请补充" },
          ],
        },
      ],
    },
  });
});
it("loads later published sets into working start actions, including empty first-page sources", async () => {
  sources.sets = [];
  sources.nextBeforeId = "cursor";
  const original = api.getMockImplementation()!;
  api.mockImplementation(async (url, init) =>
    url === "/api/platform/practice/sets?beforeId=cursor"
      ? ({
          actor,
          sets: [{ ...setDetail.set, id: "later-set", name: "后页练习" }],
          nextBeforeId: null,
        } as never)
      : original(url, init),
  );
  await render(<PracticeWorkspace />);
  await click("读取更多已发布练习");
  await click("领取并开始后页练习");
  expect(commands()[0]).toMatchObject({ source: { kind: "SET", setId: "later-set" } });
});
it("paginates teacher papers separately without replacing sets or an open publication draft", async () => {
  sources.nextBeforeId = "sets-cursor";
  sources.nextPaperBeforeId = "papers-cursor";
  const original = api.getMockImplementation()!;
  api.mockImplementation(async (url, init) => {
    if (url === "/api/platform/practice/sources?paperBeforeId=papers-cursor")
      return {
        ...structuredClone(sources),
        sets: [],
        publishPapers: [
          {
            id: "later-paper",
            name: "后页题本",
            subject: "数学",
            updatedAt: preview.paper.updatedAt,
            itemCount: 1,
          },
        ],
        nextBeforeId: null,
        nextPaperBeforeId: null,
      } as never;
    if (url === "/api/platform/practice/sets?beforeId=sets-cursor")
      return {
        actor: teacher,
        sets: [{ ...setDetail.set, id: "later-set", name: "后页已发布练习" }],
        nextBeforeId: null,
      } as never;
    return original(url, init);
  });
  await preparePublication();
  await fill("练习名称", "未保存的发布草稿");
  const input = [...host.querySelectorAll<HTMLInputElement>("input")].find(
    (entry) => entry.value === "未保存的发布草稿",
  )!;
  await click("读取更多自有题本");
  expect(input.isConnected).toBe(true);
  expect(input.value).toBe("未保存的发布草稿");
  expect(host.querySelector('option[value="paper"]')).not.toBeNull();
  expect(host.querySelector('option[value="later-paper"]')).not.toBeNull();
  expect(host.textContent).toContain("函数巩固");
  await click("读取更多已发布练习");
  expect(host.textContent).toContain("后页已发布练习");
  expect(host.querySelector('option[value="later-paper"]')).not.toBeNull();
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  await fill("选择自有题本发布", "later-paper");
  expect(confirm).toHaveBeenCalled();
  expect(input.isConnected).toBe(true);
  expect(input.value).toBe("未保存的发布草稿");
});
it("retries an independent replay-paper page from an empty first page and starts its later paper", async () => {
  sources.nextPaperBeforeId = "replay-cursor";
  const original = api.getMockImplementation()!;
  let fail = true;
  api.mockImplementation(async (url, init) => {
    if (url === "/api/platform/practice/sources?paperBeforeId=replay-cursor") {
      if (fail) throw new Error("题本目录读取失败");
      return {
        ...structuredClone(sources),
        sets: [],
        replayPapers: [
          {
            id: "later-replay",
            name: "后页复习卷",
            subject: "数学",
            updatedAt: preview.paper.updatedAt,
            itemCount: 1,
          },
        ],
        nextPaperBeforeId: null,
      } as never;
    }
    return original(url, init);
  });
  await render(<PracticeWorkspace />);
  await click("读取更多本人复习卷");
  expect(host.textContent).toContain("题本目录读取失败");
  expect(host.textContent).toContain("函数巩固");
  fail = false;
  await click("读取更多本人复习卷");
  await click("开始复现后页复习卷");
  expect(commands()[0]).toMatchObject({ source: { kind: "REPLAY", paperId: "later-replay" } });
});
it("shows private submitted history with reference provenance and distinct region names", async () => {
  await showSubmitted();
  await click("读取练习历史");
  for (const details of host.querySelectorAll("details")) details.open = true;
  expect(host.textContent).toContain("原轮次提交");
  const names = [...host.querySelectorAll("section[aria-label]")].map((entry) =>
    entry.getAttribute("aria-label"),
  );
  expect(new Set(names).size).toBe(names.length);
  expect(api.mock.calls.some(([url]) => url.includes("/sessions/session/history?limit=20"))).toBe(
    true,
  );
});
it("protects dirty manual review against adopting a candidate, including judgment-only edits", async () => {
  review.evaluations = [
    {
      id: "candidate",
      attemptId: "attempt",
      version: 1,
      source: "AI_CANDIDATE",
      actorId: "ai",
      actorName: "AI",
      createdAt: "2026-10-15T02:00:00Z",
      candidateId: null,
      aiJobId: "job",
      evaluation: {
        summary: "候选",
        items: [{ itemId: "item", judgment: "CORRECT", feedback: "AI建议", parts: [] }],
      },
    },
  ];
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  await render(<PracticeReviewWorkspace attemptId="attempt" />);
  await fill("第 1 题核对结果", "INCORRECT");
  await click("载入AI候选到可编辑表单");
  expect(confirm).toHaveBeenCalled();
  expect(value("第 1 题核对结果")).toBe("INCORRECT");
});
it("preserves an open unsaved self-evaluation by disabling reference and sibling writes until save or cancel", async () => {
  await showSubmitted();
  await click("记录本人自评");
  await fill("第 1 题核对说明", "未保存的自评依据");
  expect(button("明确查看参考答案与解析").disabled).toBe(true);
  await click("明确查看参考答案与解析");
  expect(commands()).toHaveLength(0);
  expect(value("第 1 题核对说明")).toBe("未保存的自评依据");
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  await click("取消编辑");
  expect(confirm).toHaveBeenCalled();
  expect(value("第 1 题核对说明")).toBe("未保存的自评依据");
  confirm.mockReturnValue(true);
  await click("取消编辑");
  expect(button("明确查看参考答案与解析").disabled).toBe(false);
});
it("requests AI feedback with immutable attempt baselines and only public practice progress", async () => {
  progress.models = [{ id: "practice-model", name: "反馈模型" }];
  const original = api.getMockImplementation()!;
  api.mockImplementation(async (url, init) =>
    url === "/api/platform/ai" ? ({ id: "practice-job" } as never) : original(url, init),
  );
  await showSubmitted();
  await click("请求AI反馈候选");
  const request = api.mock.calls.find(([url]) => url === "/api/platform/ai")!;
  expect(JSON.parse(String(request[1]?.body))).toEqual({
    kind: "PRACTICE_GRADE",
    modelId: "practice-model",
    input: {
      attemptId: "attempt",
      sessionId: "session",
      expectedEvaluationVersion: 0,
      attemptFingerprint: "a".repeat(64),
      contentFingerprint: "b".repeat(64),
    },
  });
  expect(host.textContent).toContain("反馈任务已提交，完成后请明确重新读取");
  const before = api.mock.calls.length;
  await act(async () => progress.completed());
  expect(api.mock.calls).toHaveLength(before);
  expect(host.textContent).toContain("AI任务状态已更新");
  expect(host.textContent).not.toContain("教师核验已完成");
});
it("renders AI feedback request failures as error alerts while success stays a plain status notice", async () => {
  progress.models = [{ id: "practice-model", name: "反馈模型" }];
  const original = api.getMockImplementation()!;
  api.mockImplementation(async (url, init) =>
    url === "/api/platform/ai" ? ({ id: "practice-job" } as never) : original(url, init),
  );
  await showSubmitted();
  await click("请求AI反馈候选");
  const success = [...host.querySelectorAll('p[role="status"]')].find((entry) =>
    entry.textContent.includes("反馈任务已提交"),
  );
  expect(success).toBeTruthy();
  expect(success!.className).toBe("p-notice");
  api.mockImplementation(async (url, init) => {
    if (url === "/api/platform/ai") throw new Error("请求失败：会话已过期");
    return original(url, init);
  });
  await click("请求AI反馈候选");
  const alert = [...host.querySelectorAll('p[role="alert"]')].find((entry) =>
    entry.textContent.includes("请求失败：会话已过期"),
  );
  expect(alert).toBeTruthy();
  expect(alert!.className).toContain("p-notice error");
  expect(host.textContent).not.toContain("反馈任务已提交");
});
it("renders teacher set reread failures as error notices with the shared alert style", async () => {
  let setReads = 0;
  const original = api.getMockImplementation()!;
  api.mockImplementation(async (url, init) => {
    if (url === "/api/platform/practice/sets/set" && ++setReads > 1)
      throw new Error("发布状态读取失败");
    return original(url, init);
  });
  await render(<PracticeTeachingWorkspace setId="set" />);
  await click("重新读取发布状态");
  const alert = [...host.querySelectorAll('p[role="alert"]')].find((entry) =>
    entry.textContent.includes("发布状态读取失败"),
  );
  expect(alert).toBeTruthy();
  expect(alert!.className).toContain("p-notice error");
});
it("renders review permission reread failures as error notices with the shared alert style", async () => {
  review.attempt = { ...review.attempt, canConfirmReview: false };
  let reviewReads = 0;
  const original = api.getMockImplementation()!;
  api.mockImplementation(async (url, init) => {
    if (url === "/api/platform/practice/reviews/attempt" && ++reviewReads > 1)
      throw new Error("当前权限读取失败");
    return original(url, init);
  });
  await render(<PracticeReviewWorkspace attemptId="attempt" />);
  await click("重新读取当前权限");
  const alert = [...host.querySelectorAll('p[role="alert"]')].find((entry) =>
    entry.textContent.includes("当前权限读取失败"),
  );
  expect(alert).toBeTruthy();
  expect(alert!.className).toContain("p-notice error");
});
it("renders review queue reread failures as error notices with the shared alert style", async () => {
  let queueReads = 0;
  const original = api.getMockImplementation()!;
  api.mockImplementation(async (url, init) => {
    if (url === "/api/platform/practice/reviews" && ++queueReads > 1)
      throw new Error("核验记录读取失败");
    return original(url, init);
  });
  await render(<PracticeTeachingWorkspace />);
  await click("重新读取提交与核验记录");
  const alert = [...host.querySelectorAll('p[role="alert"]')].find((entry) =>
    entry.textContent.includes("核验记录读取失败"),
  );
  expect(alert).toBeTruthy();
  expect(alert!.className).toContain("p-notice error");
});
it("shows only this attempt's public AI completion and preserves open self-evaluation on unrelated completion", async () => {
  const job = {
    id: "job",
    userId: actor.id,
    kind: "PRACTICE_GRADE" as const,
    modelId: "model",
    status: "COMPLETED" as const,
    input: null,
    result: null,
    cost: null,
    events: [],
    practice: {
      sessionId: "session",
      attemptId: "attempt",
      counts: { items: 1 },
      feedbackHref: "/learning/practice/session",
    },
    error: null,
    attempts: 1,
    createdAt: "2026-10-15T00:00:00Z",
    startedAt: null,
    finishedAt: null,
  };
  progress.jobs = [
    { ...job, id: "other", practice: { ...job.practice, attemptId: "different-attempt" } },
    job,
  ];
  await showSubmitted();
  expect(host.textContent?.match(/候选已保存，请明确重新读取/g)).toHaveLength(1);
  await click("记录本人自评");
  await fill("第 1 题核对说明", "我正在写的反馈");
  const before = api.mock.calls.length;
  await act(async () => progress.completed());
  expect(value("第 1 题核对说明")).toBe("我正在写的反馈");
  expect(api.mock.calls).toHaveLength(before);
});
it("closes new practice intake with a mandatory reason while retaining published content and prior records", async () => {
  await render(<PracticeTeachingWorkspace setId="set" />);
  await click("关闭新领取");
  expect(host.querySelector("form")!.checkValidity()).toBe(false);
  await fill("关闭原因", "本轮练习不再新增领取");
  await click("确认关闭新领取");
  expect(commands()[0]).toEqual({
    type: "practice.set.close",
    setId: "set",
    expectedVersion: 1,
    reason: "本轮练习不再新增领取",
  });
  expect(host.textContent).toContain("说明函数变化");
});
async function preparePublication() {
  sources.actor = teacher;
  sources.canPublish = true;
  sources.publishPapers = [
    {
      id: "paper",
      name: "函数练习",
      subject: "数学",
      updatedAt: preview.paper.updatedAt,
      itemCount: 1,
    },
  ];
  await render(<PracticeTeachingWorkspace />);
  await fill("选择自有题本发布", "paper");
  await checked("我已预览完整题面");
}
it("reuses publication request UUID after uncertain network failure and changes it only for changed submitted parameters", async () => {
  const original = api.getMockImplementation()!;
  api.mockImplementation(async (url, init) => {
    if (url.endsWith("/commands")) throw new Error("响应中断，结果未知");
    return original(url, init);
  });
  await preparePublication();
  await click("确认发布独立练习");
  await click("确认发布独立练习");
  expect(commands()).toHaveLength(2);
  const first = commands()[0] as Extract<PracticeCommand, { type: "practice.set.publish" }>;
  expect(commands()[1]).toMatchObject({ requestId: first.requestId });
  await fill("练习名称", "修改后的函数练习");
  await click("确认发布独立练习");
  expect((commands()[2] as typeof first).requestId).not.toBe(first.requestId);
  expect(commands()[2]).toMatchObject({ name: "修改后的函数练习" });
});
it("synchronously serializes a double-click on publication before the first response", async () => {
  const original = api.getMockImplementation()!;
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  api.mockImplementation(async (url, init) => {
    if (url.endsWith("/commands")) await wait;
    return original(url, init);
  });
  await preparePublication();
  const form = [...host.querySelectorAll("form")].find((entry) =>
    entry.textContent?.includes("确认发布独立练习"),
  )!;
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(commands()).toHaveLength(1);
  expect(
    (host.querySelector('[aria-label="选择自有题本发布"]') as HTMLSelectElement | null)?.disabled ??
      [...host.querySelectorAll("select")].find((entry) =>
        entry.closest("label")?.textContent?.includes("选择自有题本发布"),
      )?.disabled,
  ).toBe(true);
  await act(async () => release());
  expect(host.textContent).toContain("练习已发布");
});
function RereadPathProbe() {
  const { data, generation, refresh } = usePractice<{ name: string }>();
  return (
    <>
      <label>
        新资源输入
        <input key={generation} defaultValue={data.name} />
      </label>
      <button type="button" onClick={() => void refresh()}>
        读取当前资源
      </button>
    </>
  );
}
it("does not remount the new resource draft when an earlier path's manual reread finishes late", async () => {
  let firstReads = 0,
    release!: (value: { name: string }) => void;
  const oldRead = new Promise<{ name: string }>((resolve) => {
    release = resolve;
  });
  api.mockImplementation(async (url) =>
    url === "/first"
      ? ((++firstReads === 1 ? { name: "旧资源" } : await oldRead) as never)
      : ({ name: "新资源" } as never),
  );
  await render(
    <PracticeProvider path="/first">
      <RereadPathProbe />
    </PracticeProvider>,
  );
  await click("读取当前资源");
  await render(
    <PracticeProvider path="/second">
      <RereadPathProbe />
    </PracticeProvider>,
  );
  const input = host.querySelector("input")!;
  input.value = "新资源中的未保存输入";
  await act(async () => release({ name: "过时旧资源" }));
  expect(host.querySelector("input")).toBe(input);
  expect(input.value).toBe("新资源中的未保存输入");
  expect(host.textContent).not.toContain("过时旧资源");
});
