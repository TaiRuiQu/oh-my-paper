import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessError } from "@/server/http/errors";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  user: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  retry: vi.fn(),
  owned: vi.fn(),
  activity: vi.fn(),
  file: vi.fn(),
  origin: vi.fn(),
  json: vi.fn(),
  uploadState: vi.fn(),
  retryUpload: vi.fn(),
}));
vi.mock("@/server/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("@/server/db/client", () => ({ getDb: () => ({ user: { findUnique: mocks.user } }) }));
vi.mock("@/server/exams/agent-tasks", () => ({
  listAgentTasks: mocks.list,
  createAgentTask: mocks.create,
  retryAgentTask: mocks.retry,
  ownedAgentTask: mocks.owned,
  agentTaskDirectory: () => "/tmp/agent",
}));
vi.mock("@/server/exams/activity", () => ({ readActivity: mocks.activity }));
vi.mock("@/server/exams/workflows", () => ({
  answerUploadState: mocks.uploadState,
  retryAnswerUpload: mocks.retryUpload,
}));
vi.mock("@/server/http/mutations", () => ({
  requireSameOrigin: mocks.origin,
  readJSON: mocks.json,
}));
vi.mock("node:fs/promises", () => ({ readFile: mocks.file }));
import { GET as list } from "@/app/api/exams/[id]/agents/route";
import { POST as answer } from "@/app/api/exams/[id]/solutions/route";
import { POST as uploadAnswer } from "@/app/api/exams/[id]/answers/upload/route";
import { POST as retryUpload } from "@/app/api/exams/[id]/answers/upload/retry/route";
import { POST as grade } from "@/app/api/exams/[id]/grading/route";
import { POST as retry } from "@/app/api/exams/[id]/agents/[agentId]/retry/route";
import { GET as activity } from "@/app/api/exams/[id]/agents/[agentId]/activity/route";
import { GET as image } from "@/app/api/exams/[id]/agents/[agentId]/activity/images/[...path]/route";
const context = {
  params: Promise.resolve({ id: "source", agentId: "agent", path: ["pages", "001.jpg"] }),
};
const request = () =>
  new Request("http://localhost/api/exams/source/agents/agent/activity?attempt=attempt");
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.session.mockResolvedValue({ user: { id: "owner" } });
  mocks.user.mockResolvedValue({ role: "ADMIN" });
  mocks.list.mockResolvedValue([]);
  mocks.uploadState.mockResolvedValue(null);
  mocks.retryUpload.mockResolvedValue({ id: "upload-flow" });
  mocks.json.mockResolvedValue({});
  mocks.create.mockResolvedValue({ id: "created" });
  mocks.retry.mockResolvedValue({ id: "agent" });
  mocks.owned.mockResolvedValue({ id: "agent", attempt: "attempt", status: "RUNNING" });
  mocks.activity.mockResolvedValue([]);
  mocks.file.mockResolvedValue(Buffer.from([1]));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
});
describe("exam agent routes", () => {
  it("requires authentication before accessing tasks", async () => {
    mocks.session.mockRejectedValue(new AccessError(401, "请登录"));
    expect((await list(request(), context)).status).toBe(401);
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("lists only tasks scoped to the owner and original exam", async () => {
    const response = await list(request(), context);
    expect(response.status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith("owner", "source");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it.each([answer, uploadAnswer, retryUpload, grade, retry])(
    "rejects cross-origin task mutations before creating or retrying",
    async (handler) => {
      mocks.origin.mockImplementation(() => {
        throw new AccessError(403, "来源无效");
      });
      expect((await handler(request(), context)).status).toBe(403);
      expect(mocks.create).not.toHaveBeenCalled();
      expect(mocks.retry).not.toHaveBeenCalled();
    },
  );
  it("enqueues the correct task kind and resumes with the scoped task ID", async () => {
    expect((await retryUpload(request(), context)).status).toBe(202);
    expect(mocks.retryUpload).toHaveBeenLastCalledWith("owner", "source");
    expect((await uploadAnswer(request(), context)).status).toBe(202);
    expect(mocks.create).toHaveBeenLastCalledWith(
      expect.any(Request),
      "owner",
      "source",
      "ANSWER",
      undefined,
      true,
    );
    expect((await answer(request(), context)).status).toBe(202);
    expect(mocks.create).toHaveBeenLastCalledWith(
      expect.any(Request),
      "owner",
      "source",
      "ANSWER",
      undefined,
      false,
      undefined,
      undefined,
    );
    expect((await grade(request(), context)).status).toBe(202);
    expect(mocks.create).toHaveBeenLastCalledWith(
      expect.any(Request),
      "owner",
      "source",
      "GRADING",
    );
    expect((await retry(request(), context)).status).toBe(202);
    expect(mocks.retry).toHaveBeenCalledWith("owner", "source", "agent", undefined, undefined);
  });
  it.each([activity, image])(
    "restricts diagnostics to administrators before reading tasks",
    async (handler) => {
      mocks.user.mockResolvedValue({ role: "USER" });
      expect((await handler(request(), context)).status).toBe(403);
      expect(mocks.owned).not.toHaveBeenCalled();
    },
  );
  it.each([activity, image])("enforces exam ownership for administrators", async (handler) => {
    mocks.owned.mockRejectedValue(new AccessError(404, "任务不存在"));
    expect((await handler(request(), context)).status).toBe(404);
    expect(mocks.activity).not.toHaveBeenCalled();
    expect(mocks.file).not.toHaveBeenCalled();
  });
  it("checks cursor and resets it after a changed attempt", async () => {
    expect(
      (await activity(new Request("http://localhost/activity?after=-1"), context)).status,
    ).toBe(400);
    await activity(new Request("http://localhost/activity?after=99&attempt=old"), context);
    expect(mocks.activity).toHaveBeenCalledWith("/tmp/agent/attempt", 0);
  });
  it("rejects preview path traversal and stale attempts", async () => {
    expect((await image(new Request("http://localhost/image?attempt=old"), context)).status).toBe(
      404,
    );
    expect(
      (
        await image(request(), {
          params: Promise.resolve({ id: "source", agentId: "agent", path: ["..", "secret"] }),
        })
      ).status,
    ).toBe(404);
    expect(mocks.file).not.toHaveBeenCalled();
    const response = await image(request(), context);
    expect(response.status).toBe(200);
    expect(mocks.file).toHaveBeenCalledWith("/tmp/agent/attempt/pages/001.jpg");
  });
});
