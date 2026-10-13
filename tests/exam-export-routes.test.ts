import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccessError } from "@/server/http/errors";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  admin: vi.fn(),
  role: vi.fn(),
  owned: vi.fn(),
  review: vi.fn(),
  result: vi.fn(),
  export: vi.fn(),
}));
vi.mock("@/server/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("@/server/auth/authorization", () => ({
  requireAdmin: mocks.admin,
  isAdminUser: mocks.role,
}));
vi.mock("@/server/exams/tasks", () => ({
  ownedExamTask: mocks.owned,
  taskResult: mocks.result,
  taskDirectory: () => "/tmp/task",
}));
vi.mock("@/server/admin/exams", () => ({ reviewExamTask: mocks.review }));
vi.mock("@/server/exams/export", async (original) => ({
  ...(await original<typeof import("@/server/exams/export")>()),
  exportExam: mocks.export,
}));
vi.mock("@/server/logger", () => ({
  logError: () => ({ message: "error", code: "test", errorId: "test" }),
}));
import { GET } from "@/app/api/exams/[id]/export/route";
import { GET as REVIEW } from "@/app/api/admin/exams/[id]/export/route";
const context = { params: Promise.resolve({ id: "task" }) };
const request = (format = "pdf") =>
  new Request(`http://localhost/api/exams/task/export?format=${format}`);
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: "owner" } });
  mocks.admin.mockResolvedValue({ user: { id: "admin" } });
  mocks.role.mockResolvedValue(false);
  mocks.owned.mockResolvedValue({ id: "task" });
  mocks.review.mockResolvedValue({ id: "task", userId: "other" });
  mocks.result.mockResolvedValue({ id: "exam" });
  mocks.export.mockResolvedValue({
    data: Buffer.from("%PDF-test"),
    filename: "中文试卷.pdf",
    mime: "application/pdf",
  });
});
describe("authenticated exam downloads", () => {
  it("returns a downloadable PDF with private caching and a Unicode filename", async () => {
    const req = request(),
      response = await GET(req, context);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toContain(
      "filename*=UTF-8''%E4%B8%AD%E6%96%87",
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe("%PDF-test");
    expect(mocks.owned).toHaveBeenCalledWith("owner", "task");
    expect(mocks.export).toHaveBeenCalledWith({ id: "task" }, { id: "exam" }, "pdf", req.signal);
    expect((await GET(request("docx"), context)).status).toBe(200);
    expect(mocks.export.mock.lastCall?.[2]).toBe("docx");
  });
  it("blocks unauthenticated access, other users' records, unfinished tasks and unsupported formats", async () => {
    mocks.session.mockRejectedValueOnce(new AccessError(401, "请登录"));
    expect((await GET(request(), context)).status).toBe(401);
    mocks.owned.mockRejectedValueOnce(new AccessError(404, "不存在"));
    expect((await GET(request(), context)).status).toBe(404);
    mocks.result.mockResolvedValueOnce(null);
    expect((await GET(request(), context)).status).toBe(409);
    expect((await GET(request("html"), context)).status).toBe(400);
    expect(mocks.export).not.toHaveBeenCalled();
  });
  it("lets verified administrators export global records while denying ordinary users", async () => {
    mocks.admin.mockRejectedValueOnce(new AccessError(403, "需要管理员权限"));
    expect((await REVIEW(request(), context)).status).toBe(403);
    expect(mocks.review).not.toHaveBeenCalled();
    expect((await REVIEW(request(), context)).status).toBe(200);
    expect(mocks.review).toHaveBeenCalledWith("task");
    expect(mocks.owned).not.toHaveBeenCalled();
  });
});
