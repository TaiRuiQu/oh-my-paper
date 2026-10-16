// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Assessment, BankQuestion, Paper, PlatformState } from "@/contracts/platform";
import { PaperEditorPage } from "@/components/platform/paper-pages";
import { CardEditorPage } from "@/components/platform/card-workbench";
import { AssessmentEditor } from "@/components/platform/assessments";
import { HomeworkEditorPage } from "@/components/platform/homework-workbench";
import { RevisionPaperBuilder } from "@/components/platform/revision-paper-pages";
import { QuestionEditor } from "@/components/platform/questions";
import { PlatformAI } from "@/components/platform/ai";
import { generateCardTemplate } from "@/lib/cards";
import { DOCUMENT_DEFAULTS } from "@/lib/document-layout";
import { MockEventSource } from "./fixtures/event-source";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  mutate: vi.fn(),
  request: vi.fn(),
  refresh: vi.fn(),
  notify: vi.fn(),
  state: {} as PlatformState,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined, isPending: false, isError: false }),
}));
vi.mock("@/components/platform/domain-provider", () => ({
  useDomain: () => ({
    state: mocks.state,
    pending: false,
    mutate: mocks.mutate,
    refresh: mocks.refresh,
    notify: mocks.notify,
  }),
}));
vi.mock("@/lib/http-client", () => ({
  apiRequest: mocks.request,
  jsonBody: (body: unknown) => ({ body: JSON.stringify(body) }),
}));
vi.mock("@/components/platform/questions", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  QuestionBody: () => null,
}));

const question: BankQuestion = {
  id: "question",
  ownerId: "teacher",
  subject: "数学",
  grade: "高中一年级",
  type: "SUBJECTIVE",
  difficulty: 0.5,
  knowledgeTags: [],
  createdAt: "",
  updatedAt: "",
  content: {
    stem: "解答题干",
    options: [],
    answers: ["答案"],
    explanation: "",
    rubric: "",
    images: [],
    parts: [],
  },
};
function paperFixture(overrides: Partial<Paper> = {}): Paper {
  return {
    id: "paper",
    ownerId: "teacher",
    name: "数学试卷",
    kind: "EXAM",
    subject: "数学",
    grade: "高中一年级",
    instructions: "",
    layout: { ...DOCUMENT_DEFAULTS },
    items: [
      {
        id: "item",
        questionId: question.id,
        position: 0,
        score: 10,
        section: "解答题",
        snapshot: structuredClone(question),
      },
    ],
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}
function baseState(papers: Paper[]): PlatformState {
  return {
    actor: { id: "teacher", role: "TEACHER", name: "教师" },
    papers,
    classrooms: [
      {
        id: "class",
        ownerId: "teacher",
        name: "一班",
        stage: "高中",
        cohort: "2027届",
        students: [],
      },
    ],
    assessments: [],
    submissions: [],
    reviews: [],
    templates: [],
    users: [],
    analytics: { results: [], students: [], knowledge: [], classrooms: [] },
  } as unknown as PlatformState;
}
const assessment: Assessment = {
  canManage: true,
  rosterRevision: 1,
  rosterStatus: "CONFIRMED",
  participants: [],
  id: "exam",
  ownerId: "teacher",
  name: "期中考试",
  kind: "EXAM",
  reviewScope: "CLASSROOM",
  classroomIds: ["class"],
  papers: [
    {
      paperId: "paper",
      subject: "数学",
      gradingMode: "DOUBLE",
      arbitrationThreshold: 2,
      conversion: { enabled: false, bands: [] },
    },
  ],
  published: false,
  createdAt: "",
};

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { ready: Promise.resolve(), addEventListener: vi.fn(), removeEventListener: vi.fn() },
  });
  MockEventSource.install();
  mocks.mutate.mockReset().mockResolvedValue({ id: "saved" });
  mocks.request
    .mockReset()
    .mockResolvedValue({ id: "job", models: [{ id: "model", name: "模型" }], jobs: [] });
  mocks.refresh.mockReset().mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
function field(label: string, scope: ParentNode = container) {
  const wrapper = [...scope.querySelectorAll("label")].find(
    (node) => node.querySelector("span")?.textContent === label,
  )!;
  return wrapper.querySelector<HTMLInputElement>("input")!;
}
function expectAnyStep(input: HTMLInputElement, legal = "7.25") {
  expect(input.getAttribute("step")).toBe("any");
  input.value = legal;
  expect(input.validity.stepMismatch).toBe(false);
  expect(input.checkValidity()).toBe(true);
}

it("keeps paper scores steppable at any precision on the canvas and in the sidebar", async () => {
  mocks.state = baseState([paperFixture()]);
  await act(async () => root.render(<PaperEditorPage id="paper" />));
  expectAnyStep(container.querySelector<HTMLInputElement>('[aria-label="第 1 题分值"]')!);
  expectAnyStep(field("分值", container.querySelector(".p-mobile-document-tools")!));
});

it("keeps answer card scores steppable at any precision in the add sheet and region panel", async () => {
  const paper = paperFixture();
  const card = generateCardTemplate(paper);
  mocks.state = baseState([paper]);
  (mocks.state as { templates: unknown[] }).templates = [card];
  await act(async () => root.render(<CardEditorPage id={card.id} />));
  await act(async () =>
    [...container.querySelectorAll("button")].find((b) => b.textContent === "解答题")!.click(),
  );
  const sheet = document.querySelector<HTMLFormElement>(".p-add-question-sheet form")!;
  expectAnyStep(sheet.querySelector<HTMLInputElement>('input[name="score"]')!);
  await act(async () =>
    sheet.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  const rows = [...container.querySelectorAll<HTMLButtonElement>(".p-maker-question-select")];
  expect(rows).toHaveLength(2);
  await act(async () => rows[1].click());
  const regionScore = field("分值");
  expect(regionScore.value).toBe("7.25");
  expectAnyStep(regionScore);
});

it("keeps the double-review maximum difference steppable below half points", async () => {
  mocks.state = baseState([paperFixture()]);
  await act(async () =>
    root.render(
      <AssessmentEditor
        assessment={assessment}
        state={mocks.state}
        mutate={mocks.mutate}
        pending={false}
        close={vi.fn()}
      />,
    ),
  );
  const difference = container.querySelector<HTMLInputElement>('[aria-label="第 1 题最大分差"]')!;
  expect(difference.getAttribute("step")).toBe("any");
  difference.value = "0.25";
  expect(difference.validity.stepMismatch).toBe(false);
  expect(difference.checkValidity()).toBe(true);
  expectAnyStep(difference);
});

it("keeps homework exercise scores steppable at any precision on the canvas and in the sidebar", async () => {
  mocks.state = baseState([paperFixture({ id: "hw", kind: "HOMEWORK", name: "数学作业" })]);
  await act(async () => root.render(<HomeworkEditorPage id="hw" />));
  expectAnyStep(container.querySelector<HTMLInputElement>('[aria-label="练习 1 分值"]')!);
  expectAnyStep(field("分值", container.querySelector(".p-mobile-document-tools")!));
});

it("keeps the revision paper per-question score steppable at any precision", async () => {
  mocks.state = {
    actor: { id: "teacher", name: "教师", role: "TEACHER" },
    papers: [],
    classrooms: [
      {
        id: "class",
        students: [{ id: "one", name: "学生甲" }],
      },
    ],
    assessments: [{ id: "a1", kind: "HOMEWORK", name: "甲的作业" }],
    analytics: {
      students: [
        {
          studentId: "one",
          wrongQuestions: [
            {
              assessmentId: "a1",
              itemId: "i1",
              maximum: 5,
              score: 1,
              question: {
                id: "q1",
                subject: "数学",
                type: "BLANK",
                content: { stem: "原题", parts: [] },
              },
            },
          ],
        },
      ],
    },
  } as unknown as PlatformState;
  await act(async () =>
    root.render(<RevisionPaperBuilder initialStudentId="one" initialAssessmentId="a1" />),
  );
  await act(async () => {
    const mode = container.querySelector<HTMLSelectElement>('[aria-label="生成方式"]')!;
    mode.value = "CONSOLIDATE";
    mode.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expectAnyStep(container.querySelector<HTMLInputElement>('[aria-label="巩固卷每题分值"]')!);
});

it("keeps question part scores steppable at any precision", async () => {
  const mixed: BankQuestion = {
    ...question,
    type: "MIXED",
    content: {
      ...question.content,
      parts: [
        {
          id: "part-1",
          type: "SUBJECTIVE",
          stem: "小问",
          options: [],
          answers: ["理由"],
          explanation: "",
          rubric: "",
          knowledgeTags: [],
          score: 5,
        },
      ],
    },
  };
  await act(async () =>
    root.render(
      <QuestionEditor question={mixed} mutate={mocks.mutate} pending={false} close={vi.fn()} />,
    ),
  );
  expectAnyStep(field("小问分值"));
});

it("keeps the AI assembly per-question score steppable at any precision", async () => {
  mocks.state = baseState([]);
  await act(async () =>
    root.render(
      <PlatformAI state={mocks.state} tab="papers" refresh={mocks.refresh} notify={mocks.notify} />,
    ),
  );
  await act(async () =>
    MockEventSource.current.snapshot({ models: [{ id: "model", name: "模型" }], jobs: [] }),
  );
  expectAnyStep(field("每题分值"));
});
