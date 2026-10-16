import { beforeEach, expect, it, vi } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import type { BankQuestion, Paper, PlatformState, QuestionContent } from "@/contracts/platform";
const mocks = vi.hoisted(() => ({
  loadState: vi.fn(),
  findAsset: vi.fn(),
  readFile: vi.fn(),
  findReadingPaper: vi.fn(),
}));
vi.mock("@/server/db/client", () => ({
  getDb: () => ({
    platformAsset: { findUnique: mocks.findAsset },
    aiJob: { findMany: vi.fn(async () => []) },
    teachingPlanVersion: { findMany: vi.fn(async () => []) },
    homeworkAssignment: { findMany: vi.fn(async () => []) },
    homeworkAsset: { findUnique: vi.fn(async () => null) },
    practiceSet: { findMany: vi.fn(async () => []) },
    practiceSession: { findMany: vi.fn(async () => []) },
    paper: { findFirst: mocks.findReadingPaper },
  }),
}));
vi.mock("@/server/platform/service", () => ({ loadState: mocks.loadState }));
vi.mock("@/server/config/env", () => ({ getStoragePaths: () => ({ storage: "/storage" }) }));
vi.mock("node:fs/promises", () => ({ readFile: mocks.readFile }));
import { accessibleAsset } from "@/server/platform/assets";
import { executeQuestionsCommand } from "@/server/platform/commands/questions";
import { executePapersCommand } from "@/server/platform/commands/papers";
import { questionAssetUrls } from "@/lib/question-assets";
const id = "00000000-0000-4000-8000-000000000001",
  url = `/api/platform/assets/${id}`;
function content(): QuestionContent {
  return {
    stem: `题干 ![图](${url})`,
    options: [],
    answers: [],
    explanation: "",
    rubric: "",
    parts: [],
    images: [],
  };
}
const question = (): BankQuestion => ({
  id: "question",
  ownerId: "owner",
  type: "SUBJECTIVE",
  subject: "数学",
  grade: "高中一年级",
  difficulty: 0.5,
  knowledgeTags: [],
  content: content(),
  createdAt: "",
  updatedAt: "",
});
function paper(snapshot: BankQuestion, ownerId = snapshot.ownerId): Paper {
  return {
    id: "paper",
    ownerId,
    name: "数学试卷",
    kind: "EXAM",
    subject: "数学",
    grade: "高中一年级",
    instructions: "",
    layout: { paperSize: "A4", columns: 1 },
    items: [{ id: "item", questionId: snapshot.id, position: 0, score: 10, section: "", snapshot }],
    createdAt: "2026-10-15T00:00:00.000Z",
    updatedAt: "2026-10-15T00:00:00.000Z",
  };
}
function questionInput() {
  const q = question();
  return {
    type: q.type,
    subject: q.subject,
    grade: q.grade,
    difficulty: q.difficulty,
    knowledgeTags: q.knowledgeTags,
    content: q.content,
  };
}
function state(role: "TEACHER" | "STUDENT" = "STUDENT"): PlatformState {
  return {
    actor: { id: "viewer", role, name: "当前用户" },
    submissions: [],
    papers: [],
    questions: [],
    classrooms: [],
    assessments: [],
    templates: [],
    reviews: [],
    users: [],
    analytics: { students: [], results: [], knowledge: [], classrooms: [] },
  };
}
beforeEach(() => {
  mocks.findAsset.mockReset().mockResolvedValue({
    id,
    ownerId: "owner",
    path: "/storage/platform-assets/image.png",
    contentType: "image/png",
  });
  mocks.loadState.mockReset().mockResolvedValue(state());
  mocks.findReadingPaper.mockReset().mockResolvedValue(null);
  mocks.readFile.mockReset().mockResolvedValue(Buffer.from("pixels"));
});
it("reads a validated shared-reading manifest only inside the viewer's authorized papers", async () => {
  const visible = state("STUDENT");
  visible.papers = [paper({ ...question(), content: { ...content(), stem: "正文", images: [] } })];
  visible.papers[0].instructions = `阅读 ![原图](${url})`;
  mocks.loadState.mockResolvedValue(visible);
  mocks.findReadingPaper.mockResolvedValue({ id: "paper" });
  await expect(accessibleAsset("viewer", id)).resolves.toBeTruthy();
  expect(mocks.findReadingPaper).toHaveBeenCalledWith({
    where: { id: { in: ["paper"] }, readingAssetUrls: { has: url } },
    select: { id: true },
  });
  mocks.findReadingPaper.mockClear();
  mocks.loadState.mockResolvedValue(state("STUDENT"));
  await expect(accessibleAsset("viewer", id)).rejects.toMatchObject({ status: 404 });
  expect(mocks.findReadingPaper).not.toHaveBeenCalled();
});
it("does not authorize a third-party legacy image merely from reading text", async () => {
  const visible = state("STUDENT");
  visible.papers = [
    paper(
      { ...question(), content: { ...content(), stem: "正文", images: [] } },
      "different-owner",
    ),
  ];
  visible.papers[0].layout.textBlocks = [{ id: "reading", text: `![私图](${url})` }];
  mocks.loadState.mockResolvedValue(visible);
  await expect(accessibleAsset("viewer", id)).rejects.toMatchObject({ status: 404 });
  expect(mocks.readFile).not.toHaveBeenCalled();
});
it("checks shared-reading image ownership before creating a paper and keeps the manifest internal", async () => {
  const create = vi.fn(async ({ data }) => ({ id: "new-reading", ...data }));
  const db = {
    platformAsset: { findUnique: mocks.findAsset },
    question: { findMany: vi.fn(async () => []) },
    paper: { create },
  } as unknown as Prisma.TransactionClient;
  const command = {
    type: "paper.save" as const,
    paper: {
      name: "试卷",
      kind: "EXAM" as const,
      subject: "数学",
      grade: "高中一年级",
      instructions: `阅读 ![图](${url})`,
      layout: { paperSize: "A4" as const, columns: 1 },
      items: [{ questionId: "question", question: questionInput(), score: 10, section: "" }],
    },
  };
  await expect(
    executePapersCommand(db, { id: "another", role: "TEACHER", name: "教师" }, command),
  ).rejects.toMatchObject({ status: 404 });
  expect(create).not.toHaveBeenCalled();
  await expect(
    executePapersCommand(db, { id: "admin", role: "ADMIN", name: "管理员" }, command),
  ).resolves.toMatchObject({ id: "new-reading" });
  expect(create.mock.calls[0][0].data.readingAssetUrls).toEqual([url]);
});
it("collects only controlled asset references from actual question text fields, including all child fields", () => {
  const q = content();
  q.images = [url];
  q.options = [{ label: "A", text: `![选项](${url})` }];
  q.answers = [url];
  q.explanation = url;
  q.rubric = url;
  q.parts = [
    {
      id: "part",
      type: "SUBJECTIVE",
      stem: url,
      options: [],
      answers: [url],
      explanation: url,
      rubric: url,
      knowledgeTags: [],
      score: 1,
    },
  ];
  expect(questionAssetUrls(q)).toEqual([url]);
  expect(
    questionAssetUrls({
      metadata: url,
      stem: `https://outside.invalid${url} ${url}?token=1 ${url}#fragment ${url}/../secret ${url}x /api/platform/assets/%2e%2e`,
    }),
  ).toEqual([]);
});
it.each(["stem", "explanation", "rubric", "answers", "options", "parts"] as const)(
  "serves a student's already-authorized published question %s reference",
  async (field) => {
    const q = question();
    q.content.stem = "题干";
    if (field === "answers") q.content.answers = [url];
    else if (field === "options") q.content.options = [{ label: "A", text: `![选项](${url})` }];
    else if (field === "parts")
      q.content.parts = [
        {
          id: "part",
          type: "SUBJECTIVE",
          stem: url,
          options: [],
          answers: [],
          explanation: "",
          rubric: "",
          knowledgeTags: [],
          score: 1,
        },
      ];
    else q.content[field] = url;
    const visible = state();
    visible.papers = [paper(q)];
    mocks.loadState.mockResolvedValue(visible);
    await expect(accessibleAsset("viewer", id)).resolves.toMatchObject({
      buffer: Buffer.from("pixels"),
    });
    expect(mocks.loadState).toHaveBeenCalledTimes(1);
  },
);
it("checks the independent teacher marking scope while never giving students that broader scope", async () => {
  const normal = state("TEACHER"),
    reviewing = state("TEACHER");
  reviewing.papers = [paper(question())];
  mocks.loadState.mockImplementation(async (_actor, _db, options) =>
    options?.reviewing ? reviewing : normal,
  );
  await expect(accessibleAsset("viewer", id)).resolves.toBeTruthy();
  expect(mocks.loadState).toHaveBeenCalledWith({ id: "viewer" }, undefined, { reviewing: true });
  mocks.loadState.mockReset().mockResolvedValue(state("STUDENT"));
  await expect(accessibleAsset("viewer", id)).rejects.toMatchObject({ status: 404 });
  expect(mocks.loadState).toHaveBeenCalledTimes(1);
});
it("does not grant images from hidden blind-review feedback, unrelated metadata or unavailable content", async () => {
  const visible = state("TEACHER");
  Object.assign(visible, {
    reviews: [{ feedback: `![私有](${url})` }],
    reviewHistory: [{ feedback: url }],
    metadata: { image: url },
  });
  mocks.loadState.mockResolvedValue(visible);
  await expect(accessibleAsset("viewer", id)).rejects.toMatchObject({ status: 404 });
  expect(mocks.readFile).not.toHaveBeenCalled();
});
it("does not turn an old text reference to a different owner's private image into a new grant", async () => {
  const visible = state();
  visible.papers = [paper({ ...question(), ownerId: "different-owner" })];
  mocks.loadState.mockResolvedValue(visible);
  await expect(accessibleAsset("viewer", id)).rejects.toMatchObject({ status: 404 });
});
it("continues to deny images after content authority is revoked", async () => {
  const visible = state("TEACHER");
  visible.questions = [question()];
  mocks.loadState.mockResolvedValue(visible);
  await expect(accessibleAsset("viewer", id)).resolves.toBeTruthy();
  mocks.loadState.mockResolvedValue(state("TEACHER"));
  await expect(accessibleAsset("viewer", id)).rejects.toMatchObject({ status: 404 });
});
it("checks inline ownership on question saves before any write", async () => {
  const create = vi.fn();
  const db = {
    platformAsset: { findUnique: mocks.findAsset },
    question: { create, findUnique: vi.fn(async () => ({ ownerId: "another" })) },
  } as unknown as Prisma.TransactionClient;
  await expect(
    executeQuestionsCommand(
      db,
      { id: "another", role: "TEACHER", name: "教师" },
      { type: "question.save", question: question() },
    ),
  ).rejects.toMatchObject({ status: 404 });
  expect(create).not.toHaveBeenCalled();
});
it("checks inline ownership for nested paper snapshots rather than bypassing the question command", async () => {
  const create = vi.fn();
  const db = {
    platformAsset: { findUnique: mocks.findAsset },
    question: { findMany: vi.fn(async () => []) },
    paper: { create },
  } as unknown as Prisma.TransactionClient;
  await expect(
    executePapersCommand(
      db,
      { id: "another", role: "TEACHER", name: "教师" },
      {
        type: "paper.save",
        paper: {
          name: "试卷",
          kind: "EXAM",
          subject: "数学",
          grade: "高中一年级",
          instructions: "",
          layout: { paperSize: "A4", columns: 1 },
          items: [{ questionId: "question", question: question(), score: 10, section: "" }],
        },
      },
    ),
  ).rejects.toMatchObject({ status: 404 });
  expect(create).not.toHaveBeenCalled();
});

it("normalizes an ADMIN's legitimately shared inline asset before publishing it to a student", async () => {
  const create = vi.fn(async ({ data }) => ({ id: "new", ...data }));
  const db = {
    platformAsset: { findUnique: mocks.findAsset },
    question: { create, findUnique: vi.fn(async () => ({ ownerId: "admin" })) },
  } as unknown as Prisma.TransactionClient;
  await executeQuestionsCommand(
    db,
    { id: "admin", role: "ADMIN", name: "管理员" },
    { type: "question.save", question: questionInput() },
  );
  const stored = create.mock.calls[0][0].data;
  expect(stored.content.images).toEqual([url]);
  const visible = state();
  visible.papers = [paper({ ...question(), ownerId: "admin", content: stored.content })];
  mocks.loadState.mockResolvedValue(visible);
  await expect(accessibleAsset("viewer", id)).resolves.toBeTruthy();
});
it("normalizes ADMIN inline references in nested paper snapshots too", async () => {
  const create = vi.fn(async ({ data }) => ({ id: "paper", ...data }));
  const db = {
    platformAsset: { findUnique: mocks.findAsset },
    question: { findMany: vi.fn(async () => []) },
    paper: { create },
  } as unknown as Prisma.TransactionClient;
  await executePapersCommand(
    db,
    { id: "admin", role: "ADMIN", name: "管理员" },
    {
      type: "paper.save",
      paper: {
        name: "试卷",
        kind: "EXAM",
        subject: "数学",
        grade: "高中一年级",
        instructions: "",
        layout: { paperSize: "A4", columns: 1 },
        items: [{ questionId: "question", question: questionInput(), score: 10, section: "" }],
      },
    },
  );
  expect(create.mock.calls[0][0].data.items[0].snapshot.content.images).toEqual([url]);
});
it("enforces the existing image limit after collecting inline references", async () => {
  const q = question();
  q.content.stem = Array.from(
    { length: 21 },
    (_, index) => `/api/platform/assets/00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  ).join(" ");
  const create = vi.fn();
  const db = {
    platformAsset: { findUnique: mocks.findAsset },
    question: { create, findUnique: vi.fn(async () => ({ ownerId: "admin" })) },
  } as unknown as Prisma.TransactionClient;
  await expect(
    executeQuestionsCommand(
      db,
      { id: "admin", role: "ADMIN", name: "管理员" },
      { type: "question.save", question: q },
    ),
  ).rejects.toMatchObject({ status: 400 });
  expect(create).not.toHaveBeenCalled();
});
