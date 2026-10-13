import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccessError } from "@/server/http/errors";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  admin: vi.fn(),
  settings: vi.fn(),
  select: vi.fn(),
  origin: vi.fn(),
  usage: vi.fn(),
  grant: vi.fn(),
}));
vi.mock("@/server/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("@/server/auth/authorization", () => ({ requireAdmin: mocks.admin }));
vi.mock("@/server/ai/user-settings", () => ({
  userAiSettings: mocks.settings,
  selectUserModel: mocks.select,
}));
vi.mock("@/server/ai/usage", () => ({ usageDashboard: mocks.usage }));
vi.mock("@/server/ai/credit-grants", () => ({ grantCredits: mocks.grant }));
vi.mock("@/server/http/mutations", async (original) => ({
  ...(await original<typeof import("@/server/http/mutations")>()),
  requireSameOrigin: mocks.origin,
}));
vi.mock("@/server/logger", () => ({
  logError: () => ({ message: "error", code: "ACCESS", errorId: "test" }),
}));
import { GET, PUT } from "@/app/api/ai/settings/route";
import { GET as GET_USAGE } from "@/app/api/admin/usage/route";
import { POST as ADD_CREDITS } from "@/app/api/admin/users/[id]/credits/route";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ user: { id: "current-user" } });
  mocks.admin.mockResolvedValue({ user: { id: "admin" } });
  mocks.settings.mockResolvedValue({
    credits: "100.00000000",
    models: [],
    selections: {},
    defaults: {},
  });
  mocks.usage.mockResolvedValue({ totals: {}, users: [], models: [] });
  mocks.grant.mockResolvedValue({ credits: "150" });
  mocks.origin.mockImplementation(() => {});
});
describe("user settings and administrator usage access", () => {
  it("limits credit additions to administrators, validates positive amounts and rejects foreign origins", async () => {
    const input = { requestId: "10000000-0000-4000-8000-000000000001", amount: 50 };
    const request = (body = input) =>
      new Request("http://localhost/api/admin/users/target/credits", {
        method: "POST",
        body: JSON.stringify(body),
      });
    const context = { params: Promise.resolve({ id: "target" }) };
    expect((await ADD_CREDITS(request(), context)).status).toBe(200);
    expect(mocks.grant).toHaveBeenCalledWith("admin", "target", input);
    mocks.grant.mockClear();
    expect((await ADD_CREDITS(request({ ...input, amount: -50 }), context)).status).toBe(400);
    mocks.admin.mockRejectedValueOnce(new AccessError(403, "需要管理员权限"));
    expect((await ADD_CREDITS(request(), context)).status).toBe(403);
    mocks.origin.mockImplementationOnce(() => {
      throw new AccessError(403, "来源无效");
    });
    expect((await ADD_CREDITS(request(), context)).status).toBe(403);
    expect(mocks.grant).not.toHaveBeenCalled();
  });
  it("returns only the authenticated account's settings without caching", async () => {
    const response = await GET(new Request("http://localhost/api/ai/settings?userId=someone-else"));
    expect(mocks.settings).toHaveBeenCalledWith("current-user");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("saves a purpose for the signed-in user and rejects spoofed fields or foreign origins", async () => {
    const body = { purpose: "answer", modelId: "10000000-0000-4000-8000-000000000001" };
    const request = (value: unknown) =>
      new Request("http://localhost/api/ai/settings", {
        method: "PUT",
        body: JSON.stringify(value),
      });
    expect((await PUT(request(body))).status).toBe(200);
    expect(mocks.select).toHaveBeenCalledWith("current-user", "answer", body.modelId);
    mocks.select.mockClear();
    expect((await PUT(request({ ...body, userId: "other", credits: 999 }))).status).toBe(400);
    expect(mocks.select).not.toHaveBeenCalled();
    mocks.origin.mockImplementation(() => {
      throw new AccessError(403, "Forbidden");
    });
    expect((await PUT(request(body))).status).toBe(403);
    expect(mocks.select).not.toHaveBeenCalled();
  });
  it("requires authentication and forbids non-administrators from reading rankings", async () => {
    mocks.session.mockRejectedValueOnce(new AccessError(401, "Login required"));
    expect((await GET(new Request("http://localhost/api/ai/settings"))).status).toBe(401);
    mocks.admin.mockRejectedValueOnce(new AccessError(403, "管理员权限"));
    expect((await GET_USAGE(new Request("http://localhost/api/admin/usage"))).status).toBe(403);
    expect(mocks.usage).not.toHaveBeenCalled();
    const response = await GET_USAGE(new Request("http://localhost/api/admin/usage"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
