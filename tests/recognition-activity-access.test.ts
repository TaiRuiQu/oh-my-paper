import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessError } from "@/server/http/errors";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  user: vi.fn(),
  task: vi.fn(),
  activity: vi.fn(),
  readFile: vi.fn(),
}));
vi.mock("@/server/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("@/server/db/client", () => ({ getDb: () => ({ user: { findUnique: mocks.user } }) }));
vi.mock("@/server/exams/tasks", () => ({
  ownedExamTask: mocks.task,
  taskDirectory: () => "/tmp/task",
}));
vi.mock("@/server/exams/activity", () => ({ readActivity: mocks.activity }));
vi.mock("node:fs/promises", () => ({ readFile: mocks.readFile }));
import { GET as activity } from "@/app/api/exams/[id]/activity/route";
import { GET as image } from "@/app/api/exams/[id]/activity/images/[...path]/route";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  // A cached ADMIN field must not override the current database role.
  mocks.session.mockResolvedValue({ user: { id: "owner", role: "ADMIN" } });
  mocks.user.mockResolvedValue({ role: "ADMIN" });
  mocks.task.mockResolvedValue({ id: "task", attempt: "attempt", status: "RUNNING" });
  mocks.activity.mockResolvedValue([{ sequence: 1, type: "step", step: 1 }]);
  mocks.readFile.mockResolvedValue(new Uint8Array([1, 2, 3]));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
const endpoints = [
  {
    name: "activity records",
    invoke: () =>
      activity(new Request("http://localhost/api/exams/task/activity"), {
        params: Promise.resolve({ id: "task" }),
      }),
  },
  {
    name: "tool image previews",
    invoke: () =>
      image(
        new Request(
          "http://localhost/api/exams/task/activity/images/pages/001.jpg?attempt=attempt",
        ),
        { params: Promise.resolve({ id: "task", path: ["pages", "001.jpg"] }) },
      ),
  },
];
describe.each(endpoints)("administrator access to $name", ({ invoke }) => {
  it("denies ordinary users before reading task data or files", async () => {
    mocks.user.mockResolvedValue({ role: "USER" });
    expect((await invoke()).status).toBe(403);
    expect(mocks.task).not.toHaveBeenCalled();
    expect(mocks.activity).not.toHaveBeenCalled();
    expect(mocks.readFile).not.toHaveBeenCalled();
  });
  it("denies unauthenticated requests", async () => {
    mocks.session.mockRejectedValue(new AccessError(401, "请先登录。"));
    expect((await invoke()).status).toBe(401);
    expect(mocks.task).not.toHaveBeenCalled();
  });
  it("allows administrators to read their own task", async () => {
    const response = await invoke();
    expect(response.status).toBe(200);
    expect(mocks.task).toHaveBeenCalledWith("owner", "task");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("continues to enforce task ownership for administrators", async () => {
    mocks.task.mockRejectedValue(new AccessError(404, "试卷不存在。"));
    expect((await invoke()).status).toBe(404);
    expect(mocks.activity).not.toHaveBeenCalled();
    expect(mocks.readFile).not.toHaveBeenCalled();
  });
});
