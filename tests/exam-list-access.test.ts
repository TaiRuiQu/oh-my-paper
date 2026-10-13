import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/server/errors";
const mocks = vi.hoisted(() => ({ session: vi.fn(), user: vi.fn(), list: vi.fn() }));
vi.mock("@/server/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("@/server/db/client", () => ({ getDb: () => ({ user: { findUnique: mocks.user } }) }));
vi.mock("@/server/exams/tasks", () => ({ listExamTasks: mocks.list, createExamTask: vi.fn() }));
import { GET } from "@/app/api/exams/route";
const request = new Request("http://localhost/api/exams");
const task = {
  id: "task",
  name: "paper",
  status: "FAILED",
  error: "internal SDK trace",
  createdAt: "2026-10-12T00:00:00Z",
};
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.session.mockResolvedValue({ user: { id: "owner", role: "ADMIN" } });
  mocks.user.mockResolvedValue({ role: "USER" });
  mocks.list.mockResolvedValue([task]);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
});
describe("role-scoped paper lists", () => {
  it("sanitizes an ordinary list using the current database role", async () => {
    const response = await GET(request);
    const data = await response.json();
    expect(data.tasks[0].error).not.toContain("SDK");
    expect(mocks.list).toHaveBeenCalledWith("owner");
  });
  it("retains administrator diagnostics", async () => {
    mocks.user.mockResolvedValue({ role: "ADMIN" });
    const data = await (await GET(request)).json();
    expect(data.tasks[0].error).toBe(task.error);
  });
  it("returns a public recovery message for an internal failure", async () => {
    mocks.list.mockRejectedValue(
      new AppError("Database schema migration internal", "DB_FAILED", 503),
    );
    const response = await GET(request);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "暂时无法完成操作，请稍后重试。" });
  });
  it("retains detailed HTTP diagnostics only after administrator verification", async () => {
    mocks.user.mockResolvedValue({ role: "ADMIN" });
    mocks.list.mockRejectedValue(new AppError("model configuration failed", "CONFIG_FAILED", 503));
    const data = await (await GET(request)).json();
    expect(data.code).toBe("CONFIG_FAILED");
    expect(data.errorId).toBeTypeOf("string");
    expect(data.error).toContain("configuration");
  });
});
