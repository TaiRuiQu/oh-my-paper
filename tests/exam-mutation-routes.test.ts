import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { AccessError, RequestError } from "@/server/http/errors";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  role: vi.fn(),
  remove: vi.fn(),
  edit: vi.fn(),
}));
vi.mock("@/server/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("@/server/auth/authorization", () => ({ isAdminUser: mocks.role }));
vi.mock("@/server/exams/edit", () => ({ deleteExamTask: mocks.remove, editExam: mocks.edit }));
vi.mock("@/server/config/env", () => ({ getEnv: () => ({ BETTER_AUTH_URL: "http://localhost" }) }));
import { DELETE, PATCH } from "@/app/api/exams/[id]/route";
const context = { params: Promise.resolve({ id: "task" }) };
const payload = {
  revision: 0,
  exam: {
    name: "试卷",
    totalScore: 5,
    sections: [
      {
        number: "一",
        title: "计算",
        description: "",
        score: 5,
        questions: [{ number: 1, description: "计算", score: 5, materials: [], subquestions: [] }],
      },
    ],
  },
};
function request(method: string, body: unknown = payload, origin = "http://localhost") {
  return new Request("http://localhost/api/exams/task", {
    method,
    headers: { origin, "Content-Type": "application/json" },
    ...(method === "PATCH" ? { body: JSON.stringify(body) } : {}),
  });
}
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.session.mockResolvedValue({ user: { id: "owner" } });
  mocks.role.mockResolvedValue(false);
  mocks.edit.mockResolvedValue(payload.exam);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
});
describe("owned paper mutations", () => {
  it.each([DELETE, PATCH])("requires a session", async (handler) => {
    mocks.session.mockRejectedValue(new AccessError(401, "请登录"));
    expect((await handler(request("PATCH"), context)).status).toBe(401);
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.edit).not.toHaveBeenCalled();
  });
  it.each([DELETE, PATCH])("rejects cross-origin requests before any mutation", async (handler) => {
    expect(
      (await handler(request("PATCH", payload, "https://elsewhere.invalid"), context)).status,
    ).toBe(403);
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.edit).not.toHaveBeenCalled();
  });
  it("deletes only under the authenticated owner", async () => {
    expect((await DELETE(request("DELETE"), context)).status).toBe(200);
    expect(mocks.remove).toHaveBeenCalledWith("owner", "task");
  });
  it("validates edited content and sends its revision to the owner-scoped service", async () => {
    expect((await PATCH(request("PATCH"), context)).status).toBe(200);
    expect(mocks.edit).toHaveBeenCalledWith("owner", "task", payload);
    mocks.edit.mockClear();
    expect((await PATCH(request("PATCH", { ...payload, revision: -1 }), context)).status).toBe(400);
    expect(mocks.edit).not.toHaveBeenCalled();
  });
  it("reports concurrent edits without hiding the recovery instruction", async () => {
    mocks.edit.mockRejectedValue(
      new RequestError(409, "试卷已被其他页面修改，请重新加载后再编辑。"),
    );
    const response = await PATCH(request("PATCH"), context);
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("重新加载");
  });
  it("rejects malformed JSON without calling the edit service", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/exams/task", {
        method: "PATCH",
        headers: { origin: "http://localhost" },
        body: "{",
      }),
      context,
    );
    expect(response.status).toBe(400);
    expect(mocks.edit).not.toHaveBeenCalled();
  });
});
