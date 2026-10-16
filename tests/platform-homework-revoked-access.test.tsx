// @vitest-environment jsdom
// Independent audit coverage for R4-03's revoked-access branch: the server must not
// hand a requested inactive submission back without current marking permission or
// duplicate the still-valid current one, and the UI must archive only local deltas
// on 401/403/404 while keeping the page authorized on ordinary read failures.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PlatformState, ScanSubmission } from "@/contracts/platform";
import type { Assessment, BankQuestion, Paper, Review } from "@/contracts/platform";
import { SubmissionReviewPage } from "@/components/platform/review-pages";
import { ApiRequestError } from "@/lib/http-client";
import { loadPageState } from "@/server/platform/page-state";
import { getDb } from "@/server/db/client";
import { getActor } from "@/server/platform/access";
import { confirmedRoster } from "./assessment-roster-fixture";

vi.mock("@/server/db/client", () => ({ getDb: vi.fn() }));
vi.mock("@/server/platform/access", async (original) => ({
  ...(await original<typeof import("@/server/platform/access")>()),
  getActor: vi.fn(),
}));
vi.mock("@/components/platform/questions", () => ({
  QuestionBody: ({ question }: { question: { content: { stem: string } } }) => (
    <p>{question.content.stem}</p>
  ),
}));
vi.mock("@/components/platform/ai", () => ({ PlatformAI: () => null }));
vi.mock("@/components/platform/scans", () => ({ Scans: () => null }));
vi.mock("@/components/platform/domain-provider", () => ({
  useDomain: () => ({ state, area: "homework", mutate, pending: false, refresh }),
}));

const secret = "FIRST_SECRET_KEPT_SERVER_SIDE";
const question = {
  id: "question",
  ownerId: "A",
  type: "MIXED",
  subject: "数学",
  grade: "高中一年级",
  difficulty: 0.5,
  knowledgeTags: [],
  createdAt: "",
  updatedAt: "",
  content: {
    stem: "计算",
    options: [],
    images: [],
    answers: [],
    explanation: "解析",
    rubric: "评分标准",
    parts: [
      {
        id: "part",
        type: "SUBJECTIVE",
        stem: "小问",
        score: 10,
        options: [],
        answers: ["4"],
        explanation: "",
        rubric: "",
        knowledgeTags: [],
      },
    ],
  },
} as BankQuestion;
const paper = {
  id: "paper",
  ownerId: "A",
  name: "数学作业",
  kind: "HOMEWORK",
  subject: "数学",
  grade: "高中一年级",
  instructions: "",
  layout: { paperSize: "A4", columns: 1 },
  createdAt: "",
  updatedAt: "",
  items: [{ id: "item", questionId: question.id, score: 10, section: "", snapshot: question }],
} as unknown as Paper;
const assessment = {
  rosterRevision: 1,
  rosterStatus: "CONFIRMED",
  participants: [],
  id: "hw",
  ownerId: "A",
  name: "周末作业",
  kind: "HOMEWORK",
  classroomIds: ["class"],
  published: false,
  reviewScope: "CLASSROOM",
  createdAt: "",
  papers: [
    {
      paperId: "paper",
      subject: "数学",
      gradingMode: "DOUBLE",
      arbitrationThreshold: 1,
      conversion: { enabled: false, bands: [] },
      questionRules: {},
    },
  ],
} as unknown as Assessment;
const classroom = {
  id: "class",
  ownerId: "A",
  name: "一班",
  stage: "高中",
  cohort: "2027届",
  students: [
    { id: "student", classroomId: "class", name: "学生", studentNumber: "000001", userId: "S" },
  ],
} as PlatformState["classrooms"][number];
const submission = {
  id: "submission",
  ownerId: "A",
  assessmentId: "hw",
  paperId: "paper",
  studentId: "student",
  templateId: null,
  kind: "WORKBOOK",
  status: "REVIEW",
  sourceFiles: [],
  answers: [{ itemId: "item", text: "作答", images: [] }],
  alignment: null,
  createdAt: "",
} as ScanSubmission;
const first = {
  id: "first",
  version: 1,
  submissionId: "submission",
  itemId: "item",
  reviewerId: "A",
  round: "FIRST",
  source: "HUMAN",
  score: 7.25,
  feedback: secret,
  partScores: [],
  createdAt: "",
} as Review;
const date = new Date("2026-10-15T00:00:00.000Z");

function actor(id: string) {
  return {
    id,
    name: id,
    role: id === "S" ? "STUDENT" : "TEACHER",
    teachingAssignments:
      id === "B" ? [{ role: "SUBJECT_TEACHER", classroomId: "class", subject: "数学" }] : [],
  };
}
function fakeDb() {
  const old = { ...submission, active: false, createdAt: date };
  const current = { ...old, id: "new-submission", active: true };
  return {
    classroom: {
      findMany: vi.fn(async () => [classroom]),
      findUnique: vi.fn(async () => classroom),
    },
    assessment: {
      findMany: vi.fn(async () => [
        { ...assessment, ...confirmedRoster(assessment, [classroom]), createdAt: date },
      ]),
    },
    paper: {
      findMany: vi.fn(async (query?: { where?: { id?: { in?: string[] } } }) => {
        const ids = query?.where?.id?.in;
        return [paper]
          .filter((entry) => !ids || ids.includes(entry.id))
          .map((entry) => ({ ...entry, createdAt: date, updatedAt: date }));
      }),
    },
    question: {
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
    },
    scanSubmission: {
      findMany: vi.fn(async (query?: { where?: { OR?: { id?: string }[] } }) =>
        [old, current].filter((row) => {
          const requested = query?.where?.OR?.some((entry) => entry.id === row.id);
          return row.active || requested;
        }),
      ),
    },
    review: { findMany: vi.fn(async () => [{ ...first, createdAt: date }]) },
    reviewEvent: {
      findMany: vi.fn(async () => [
        { ...first, createdAt: date },
        { ...first, id: "first-old", feedback: `${secret}_HISTORY`, createdAt: date },
      ]),
    },
    cardTemplate: { findMany: vi.fn(async () => []) },
    user: { findMany: vi.fn(async () => []) },
  };
}
function assertNoSecret(value: unknown) {
  const json = JSON.stringify(value);
  expect(json).not.toContain(secret);
  expect(json).not.toContain("7.25");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getDb).mockReturnValue(fakeDb() as unknown as ReturnType<typeof getDb>);
  vi.mocked(getActor).mockImplementation(async (id) => actor(id) as never);
});

it("serves an explicitly requested current submission through the active list only", async () => {
  const visible = await loadPageState({ id: "B" }, "homework", true, "new-submission");
  expect(visible.requestedReview).toBeUndefined();
  expect(visible.submissions.map((row) => row.id)).toEqual(["new-submission"]);
  assertNoSecret(visible);
});

it("drops a requested inactive submission when the area does not authorize its kind", async () => {
  const visible = await loadPageState({ id: "B" }, "exams", true, "submission");
  expect(visible.requestedReview).toBeUndefined();
  expect(visible.submissions).toEqual([]);
  expect(visible.papers).toEqual([]);
  assertNoSecret(visible);
});

const savedReview = (itemId: string): Review => ({
  id: `review-${itemId}`,
  version: 1,
  itemId,
  submissionId: "old",
  round: "FIRST",
  reviewerId: "teacher",
  source: "HUMAN",
  score: 8,
  feedback: `SERVER_OLD_FEEDBACK_${itemId}`,
  createdAt: "2026-10-15T00:00:00Z",
});
let state: PlatformState, host: HTMLDivElement, root: Root;
const mutate = vi.fn(),
  refresh = vi.fn();
const uiSubmission = {
  id: "old",
  assessmentId: "homework",
  paperId: "paper",
  studentId: "student",
  kind: "WORKBOOK",
  status: "REVIEW",
  sourceFiles: [],
  answers: [{ itemId: "one", text: "OLD_STUDENT_ANSWER", images: [] }],
  alignment: null,
} as unknown as ScanSubmission;
function uiFixture(): PlatformState {
  return {
    reviewing: true,
    actor: { id: "teacher", role: "TEACHER" },
    questions: [],
    users: [],
    classrooms: [],
    templates: [],
    submissions: [uiSubmission],
    reviews: [savedReview("one"), savedReview("two")],
    analytics: { results: [] },
    assessments: [
      {
        id: "homework",
        name: "作业",
        kind: "HOMEWORK",
        published: false,
        rosterStatus: "CONFIRMED",
        papers: [{ paperId: "paper", subject: "数学", gradingMode: "SINGLE" }],
        participants: [
          {
            studentId: "student",
            name: "学生旧姓名",
            studentNumber: "000001",
            subjects: [{ paperId: "paper", status: "REQUIRED" }],
          },
        ],
      },
    ],
    papers: [
      {
        id: "paper",
        subject: "数学",
        items: ["one", "two"].map((id) => ({
          id,
          score: 10,
          snapshot: {
            type: "SUBJECTIVE",
            content: {
              stem: `PRIVATE_STEM_${id}`,
              options: [],
              images: [],
              answers: [],
              rubric: "",
              parts: [],
            },
          },
        })),
      },
    ],
  } as unknown as PlatformState;
}
beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.mocked(getDb).mockReturnValue(fakeDb() as unknown as ReturnType<typeof getDb>);
  vi.mocked(getActor).mockImplementation(async (id) => actor(id) as never);
  state = uiFixture();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  mutate.mockResolvedValue({ error: "服务端评分已变化", errorStatus: 409 });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
async function render() {
  await act(async () => root.render(<SubmissionReviewPage id="old" />));
}
const work = (index: number) => host.querySelectorAll<HTMLElement>(".p-review-work")[index];
const field = (index: number, selector: string) =>
  work(index).querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
async function input(node: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(node), "value")!.set!.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function click(text: string) {
  const button = [...host.querySelectorAll("button")].find((entry) => entry.textContent === text)!;
  expect(button).toBeTruthy();
  await act(async () => button.click());
}

it("archives only local deltas on 403 and restores the server baseline, not the archive, after re-authorization", async () => {
  await render();
  await input(field(0, 'textarea[name="feedback"]'), "LOCAL_REVOKED_DELTA");
  await input(field(1, 'input[name="score"]'), "6.25");
  refresh.mockRejectedValueOnce(new ApiRequestError("阅卷权限已被撤销", 403));
  await act(async () => work(0).querySelector("form")!.requestSubmit());
  await click("重新读取最新评分并比较");
  expect(host.textContent).toContain("答卷当前不可评阅");
  expect(host.textContent).toContain("LOCAL_REVOKED_DELTA");
  expect(host.textContent).toContain("本人修改的得分：6.25");
  expect(host.textContent).not.toContain("PRIVATE_STEM");
  expect(host.textContent).not.toContain("OLD_STUDENT_ANSWER");
  expect(host.textContent).not.toContain("SERVER_OLD_FEEDBACK");
  expect(host.textContent).not.toContain("学生旧姓名");
  expect(host.querySelector("form")).toBeNull();
  // Permission returns; the product path back is an explicit re-read, not a re-render.
  state = uiFixture();
  refresh.mockImplementationOnce(async () => {
    await render();
  });
  await click("重新读取当前答卷权限");
  expect(host.querySelector("form")).not.toBeNull();
  expect(field(0, 'textarea[name="feedback"]').value).toBe("SERVER_OLD_FEEDBACK_one");
  expect(field(1, 'input[name="score"]').value).toBe("8");
  const retained = host.querySelector('[aria-label="曾脱离授权答卷的本人本地输入"]')!;
  expect(retained.textContent).toContain("LOCAL_REVOKED_DELTA");
  expect(retained.textContent).toContain("6.25");
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
});

it("keeps the authorized page and in-form drafts on an ordinary read failure", async () => {
  await render();
  await input(field(0, 'textarea[name="feedback"]'), "LOCAL_NETWORK_DELTA");
  refresh.mockRejectedValueOnce(new Error("暂时不可读"));
  await act(async () => work(0).querySelector("form")!.requestSubmit());
  await click("重新读取最新评分并比较");
  expect(host.textContent).toContain("本地草稿仍保留");
  expect(host.textContent).not.toContain("答卷当前不可评阅");
  expect(host.querySelector('button[aria-label="曾脱离授权答卷的本人本地输入"]')).toBeNull();
  expect(host.querySelector('[aria-label="曾脱离授权答卷的本人本地输入"]')).toBeNull();
  expect(field(0, 'textarea[name="feedback"]').value).toBe("LOCAL_NETWORK_DELTA");
});
