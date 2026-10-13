import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { AccessError } from "@/server/http/errors";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  origin: vi.fn(),
  list: vi.fn(),
  detail: vi.fn(),
  create: vi.fn(),
  retry: vi.fn(),
  exam: vi.fn(),
  flow: vi.fn(),
  user: vi.fn(),
}));
vi.mock("@/server/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("@/server/http/mutations", () => ({ requireSameOrigin: mocks.origin }));
vi.mock("@/server/exams/workflows", () => ({
  listWorkflows: mocks.list,
  workflowDetail: mocks.detail,
  createGradingWorkflow: mocks.create,
  retryWorkflow: mocks.retry,
}));
vi.mock("@/server/exams/tasks", () => ({ createExamTask: mocks.exam }));
vi.mock("@/server/db/client", () => ({
  getDb: () => ({
    user: { findUnique: mocks.user },
    gradingWorkflow: { findFirstOrThrow: mocks.flow },
  }),
}));
import { GET as list } from "@/app/api/workflows/route";
import { GET as detail } from "@/app/api/workflows/[id]/route";
import { POST as retry } from "@/app/api/workflows/[id]/retry/route";
import { POST as grade } from "@/app/api/exams/[id]/grade/route";
import { POST as quick } from "@/app/api/quick-grade/route";
const context = { params: Promise.resolve({ id: "id" }) },
  request = () => new Request("http://localhost/api/workflows/id", { method: "POST" });
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.session.mockResolvedValue({ user: { id: "owner" } });
  mocks.user.mockResolvedValue({ role: "ADMIN" });
  mocks.list.mockResolvedValue([]);
  mocks.detail.mockResolvedValue({ id: "id" });
  mocks.create.mockResolvedValue({ id: "id" });
  mocks.retry.mockResolvedValue({ id: "id" });
  mocks.exam.mockResolvedValue({ id: "source" });
  mocks.flow.mockResolvedValue({ id: "workflow" });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
});
describe("bundled workflow routes", () => {
  it.each([list, detail, retry, grade, quick])("requires authentication", async (handler) => {
    mocks.session.mockRejectedValue(new AccessError(401, "请登录"));
    expect((await handler(request(), context)).status).toBe(401);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.exam).not.toHaveBeenCalled();
  });
  it.each([retry, grade, quick])("rejects cross-origin mutations", async (handler) => {
    mocks.origin.mockImplementation(() => {
      throw new AccessError(403, "invalid");
    });
    expect((await handler(request(), context)).status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.exam).not.toHaveBeenCalled();
    expect(mocks.retry).not.toHaveBeenCalled();
  });
  it("scopes listing and detail to the current owner", async () => {
    expect((await list(request())).status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith("owner");
    expect((await detail(request(), context)).status).toBe(200);
    expect(mocks.detail).toHaveBeenCalledWith("owner", "id");
  });
  it("starts a server-side bundled grading workflow", async () => {
    expect((await grade(request(), context)).status).toBe(202);
    expect(mocks.create).toHaveBeenCalledWith(expect.any(Request), "owner", "id");
  });
  it("starts quick recognition and returns its associated workflow", async () => {
    const response = await quick(request());
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ workflow: { id: "workflow" } });
    expect(mocks.exam).toHaveBeenCalledWith(expect.any(Request), "owner", true);
    expect(mocks.flow).toHaveBeenCalledWith({
      where: { sourceId: "source", userId: "owner", kind: "QUICK" },
      select: { id: true },
    });
  });
  it("denies another owner's detail and retries", async () => {
    mocks.detail.mockRejectedValue(new AccessError(404, "missing"));
    mocks.retry.mockRejectedValue(new AccessError(404, "missing"));
    expect((await detail(request(), context)).status).toBe(404);
    expect((await retry(request(), context)).status).toBe(404);
    expect(mocks.retry).toHaveBeenCalledWith("owner", "id");
  });
});
