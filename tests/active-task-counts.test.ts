import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { AccessError } from "@/server/http/errors";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  exams: vi.fn(),
  agents: vi.fn(),
  workflows: vi.fn(),
  templates: vi.fn(),
  batches: vi.fn(),
}));
vi.mock("@/server/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("@/server/db/client", () => ({
  getDb: () => ({
    examTask: { findMany: mocks.exams },
    examAgentTask: { findMany: mocks.agents },
    gradingWorkflow: { findMany: mocks.workflows },
    answerCardTemplate: { count: mocks.templates },
    answerCardBatch: { count: mocks.batches },
    $transaction: (queries: Promise<unknown>[]) => Promise.all(queries),
  }),
}));
import { GET } from "@/app/api/tasks/active/route";

beforeEach(() => {
  mocks.session.mockResolvedValue({ user: { id: "owner" } });
  mocks.exams.mockResolvedValue([]);
  mocks.agents.mockResolvedValue([]);
  mocks.workflows.mockResolvedValue([]);
  mocks.templates.mockResolvedValue(0);
  mocks.batches.mockResolvedValue(0);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
});
const request = () => new Request("http://localhost/api/tasks/active?userId=someone-else");

describe("active workspace task counts", () => {
  it("requires a session before reading any tasks", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.session.mockRejectedValue(new AccessError(401, "请先登录。"));
    expect((await GET(request())).status).toBe(401);
    expect(mocks.exams).not.toHaveBeenCalled();
  });

  it("scopes active queries to the session owner and disables response caching", async () => {
    const response = await GET(request());
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      exams: 0,
      grading: 0,
      quickGrading: 0,
      answerCards: 0,
    });
    const scope = { userId: "owner", status: { in: ["QUEUED", "RUNNING"] } };
    for (const query of [mocks.exams, mocks.workflows, mocks.templates, mocks.batches])
      expect(query).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining(scope) }),
      );
    expect(mocks.agents).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: scope.status, exam: { userId: "owner", task: { deletedAt: null } } },
      }),
    );
  });

  it("counts standalone work and whole operations without duplicating linked steps", async () => {
    mocks.exams.mockResolvedValue([{ id: "parse" }, { id: "upload-source" }]);
    mocks.agents.mockResolvedValue([
      { id: "standalone-answer", kind: "ANSWER" },
      { id: "standalone-grade", kind: "GRADING" },
      { id: "upload-answer", kind: "ANSWER" },
      { id: "quick-answer", kind: "ANSWER" },
      { id: "grading-answer", kind: "ANSWER" },
      { id: "grading-child", kind: "GRADING" },
    ]);
    mocks.workflows.mockResolvedValue([
      {
        kind: "ANSWER_UPLOAD",
        sourceId: "upload-source",
        answerTaskId: "upload-answer",
        gradingTaskId: null,
      },
      {
        kind: "QUICK",
        sourceId: "quick-source",
        answerTaskId: "quick-answer",
        gradingTaskId: null,
      },
      {
        kind: "GRADING",
        sourceId: "source",
        answerTaskId: "grading-answer",
        gradingTaskId: "grading-child",
      },
      { kind: "GRADING", sourceId: "source", answerTaskId: "grading-answer", gradingTaskId: null },
    ]);
    mocks.templates.mockResolvedValue(1);
    mocks.batches.mockResolvedValue(2);
    expect(await (await GET(request())).json()).toEqual({
      exams: 3,
      grading: 3,
      quickGrading: 1,
      answerCards: 3,
    });
  });
});
