import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccessError } from "@/server/http/errors";
const mocks = vi.hoisted(() => ({
  admin: vi.fn(),
  origin: vi.fn(),
  users: vi.fn(),
  exams: vi.fn(),
  review: vi.fn(),
  reset: vi.fn(),
  update: vi.fn(),
  deleteProvider: vi.fn(),
}));
vi.mock("@/server/auth/authorization", () => ({ requireAdmin: mocks.admin }));
vi.mock("@/server/admin/users", () => ({
  listUsers: mocks.users,
  resetUserPassword: mocks.reset,
  updateUser: mocks.update,
}));
vi.mock("@/server/admin/exams", () => ({ listAllExams: mocks.exams, reviewExam: mocks.review }));
vi.mock("@/server/ai/settings", () => ({
  deleteProvider: mocks.deleteProvider,
  saveProvider: vi.fn(),
}));
vi.mock("@/server/http/mutations", async (original) => ({
  ...(await original<typeof import("@/server/http/mutations")>()),
  requireSameOrigin: mocks.origin,
}));
vi.mock("@/server/logger", () => ({
  logError: () => ({ message: "error", code: "test", errorId: "test" }),
}));
import { GET as users } from "@/app/api/admin/users/route";
import { GET as exams } from "@/app/api/admin/exams/route";
import { GET as review } from "@/app/api/admin/exams/[id]/route";
import { POST as reset } from "@/app/api/admin/users/[id]/password/route";
import { PATCH as update } from "@/app/api/admin/users/[id]/route";
import { DELETE as deleteProvider } from "@/app/api/admin/ai/providers/[id]/route";
const context = { params: Promise.resolve({ id: "other-user" }) };
const request = (body?: unknown) =>
  new Request("http://localhost/api/admin/test?search=paper&page=2", {
    method: body ? "POST" : "GET",
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.admin.mockResolvedValue({ user: { id: "administrator" } });
  mocks.users.mockResolvedValue({ items: [], total: 0, page: 2, pageSize: 20 });
  mocks.exams.mockResolvedValue({ items: [], total: 0, page: 2, pageSize: 20 });
  mocks.review.mockResolvedValue({ task: {} });
  mocks.reset.mockResolvedValue({ success: true });
  mocks.update.mockResolvedValue({ success: true });
});
describe("administrator user management and paper review", () => {
  it.each([401, 403] as const)(
    "denies every endpoint with status %s before accessing records",
    async (status) => {
      mocks.admin.mockRejectedValue(new AccessError(status, "Forbidden"));
      for (const response of [
        await users(request()),
        await exams(request()),
        await review(request(), context),
        await reset(request({ password: "new-password-123" }), context),
        await update(request({ name: "Name", role: "ADMIN" }), context),
        await deleteProvider(request(), context),
      ])
        expect(response.status).toBe(status);
      for (const mock of [
        mocks.users,
        mocks.exams,
        mocks.review,
        mocks.reset,
        mocks.update,
        mocks.deleteProvider,
      ])
        expect(mock).not.toHaveBeenCalled();
    },
  );
  it("deletes a provider only after checking administrator access and request origin", async () => {
    expect((await deleteProvider(request(), context)).status).toBe(200);
    expect(mocks.deleteProvider).toHaveBeenCalledWith("other-user");
    mocks.deleteProvider.mockClear();
    mocks.origin.mockImplementation(() => {
      throw new AccessError(403, "Invalid origin");
    });
    expect((await deleteProvider(request(), context)).status).toBe(403);
    expect(mocks.deleteProvider).not.toHaveBeenCalled();
  });
  it("searches and paginates global records without returning cacheable data", async () => {
    expect((await users(request())).headers.get("cache-control")).toBe("private, no-store");
    expect((await exams(request())).status).toBe(200);
    expect(mocks.users).toHaveBeenCalledWith("paper", 2);
    expect(mocks.exams).toHaveBeenCalledWith("paper", 2);
    expect((await users(new Request("http://localhost/api/admin/users?page=0"))).status).toBe(400);
    expect((await review(request(), context)).status).toBe(200);
    expect(mocks.review).toHaveBeenCalledWith("other-user");
  });
  it("accepts a new password only after admin and origin verification and validates its length", async () => {
    expect((await reset(request({ password: "new-password-123" }), context)).status).toBe(200);
    expect(mocks.reset).toHaveBeenCalledWith("administrator", "other-user", "new-password-123");
    mocks.reset.mockClear();
    for (const password of ["short", "x".repeat(129)])
      expect((await reset(request({ password }), context)).status).toBe(400);
    expect(
      (await reset(request({ password: "new-password-123", role: "ADMIN" }), context)).status,
    ).toBe(400);
    mocks.origin.mockImplementation(() => {
      throw new AccessError(403, "Invalid origin");
    });
    expect((await reset(request({ password: "new-password-123" }), context)).status).toBe(403);
    expect(mocks.reset).not.toHaveBeenCalled();
  });
  it("validates editable fields and never accepts account secrets from a user update", async () => {
    expect((await update(request({ name: "Teacher", role: "USER" }), context)).status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith("administrator", "other-user", {
      name: "Teacher",
      role: "USER",
    });
    mocks.update.mockClear();
    expect(
      (await update(request({ name: "Teacher", role: "USER", password: "secret" }), context))
        .status,
    ).toBe(400);
    expect((await update(request({ name: "Teacher", role: "SUPERADMIN" }), context)).status).toBe(
      400,
    );
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
