import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { aiTraceFixtures } from "./fixtures/ai-traces";
import { decodeAiProgress } from "@/lib/ai-progress-codec";
import { AccessError } from "@/server/http/errors";

const mock = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  session: vi.fn(),
  actor: vi.fn(),
  search: vi.fn(),
}));
vi.mock("@/server/platform/ai-jobs", () => ({ listAiJobs: mock.list, getAiJob: mock.get }));
vi.mock("@/server/platform/ai-progress-notifications", () => ({
  subscribeAiProgress: mock.subscribe,
}));
vi.mock("@/server/auth/session", () => ({ requireSession: mock.session }));
vi.mock("@/server/config/env", () => ({ getEnv: () => ({ AI_PROGRESS_FORMAT: "json" }) }));
vi.mock("@/server/platform/access", () => ({ getActor: mock.actor }));
vi.mock("@/server/platform/search/configuration", () => ({ loadSearchConfiguration: mock.search }));
import { GET as listGET } from "@/app/api/platform/ai/events/route";
import { GET as detailGET } from "@/app/api/platform/ai/[id]/events/route";
import { GET as searchGET } from "@/app/api/platform/admin/ai-progress/route";

const job = aiTraceFixtures[0];
const databaseJob = (overrides = {}) => ({
  ...job,
  createdAt: new Date(job.createdAt),
  startedAt: job.startedAt ? new Date(job.startedAt) : null,
  finishedAt: null,
  workerId: "private-worker",
  heartbeatAt: new Date(),
  ...overrides,
});
const request = (path = "/events", signal?: AbortSignal) =>
  new Request(`http://localhost/api/platform/ai${path}`, { signal });
const detail = (path = `/${job.id}/events`, signal?: AbortSignal) =>
  detailGET(request(path, signal), { params: Promise.resolve({ id: job.id }) });
const text = async (reader: ReadableStreamDefaultReader<Uint8Array>) =>
  new TextDecoder().decode((await reader.read()).value);
const change = (data = { kind: "job", userId: job.userId, id: job.id }) =>
  mock.subscribe.mock.calls[0][0](data);
let readers: ReadableStreamDefaultReader<Uint8Array>[];
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  readers = [];
  mock.session.mockResolvedValue({
    user: { id: job.userId },
    session: { expiresAt: new Date(Date.now() + 60_000) },
  });
  mock.list.mockResolvedValue({
    models: [{ id: "model", name: "教学模型" }],
    jobs: [databaseJob()],
  });
  mock.get.mockResolvedValue(databaseJob());
  mock.subscribe.mockResolvedValue(mock.unsubscribe);
  mock.actor.mockResolvedValue({ role: "ADMIN" });
  mock.search.mockResolvedValue({
    embedding: null,
    searchIndex: { total: 8, indexed: 0, pending: 8, failed: 0, enabled: true },
  });
});
afterEach(async () => {
  for (const reader of readers) await reader.cancel();
  vi.useRealTimers();
});
function reader(response: Response) {
  const value = response.body!.getReader();
  readers.push(value);
  return value;
}

it("authenticates before subscribing and returns an authorized snapshot without polling", async () => {
  const response = await listGET(request());
  const stream = reader(response);
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  expect(response.headers.get("cache-control")).toContain("no-transform");
  expect(response.headers.get("x-accel-buffering")).toBe("no");
  expect(await text(stream)).toBe("retry: 3000\n\n");
  const initial = await text(stream);
  expect(initial).toContain('"name":"教学模型"');
  expect(initial).not.toMatch(/private-worker|heartbeatAt/);
  expect(mock.subscribe.mock.invocationCallOrder[0]).toBeLessThan(
    mock.list.mock.invocationCallOrder[0],
  );
  await vi.advanceTimersByTimeAsync(15_000);
  expect(await text(stream)).toBe(": heartbeat\n\n");
  expect(mock.list).toHaveBeenCalledOnce();
  await stream.cancel();
  expect(mock.unsubscribe).toHaveBeenCalledOnce();
});

it.each([listGET, (r: Request) => detailGET(r, { params: Promise.resolve({ id: job.id }) })])(
  "rejects anonymous streams before opening a database listener",
  async (get) => {
    mock.session.mockRejectedValue(new AccessError(401, "请先登录。"));
    const response = await get(request());
    expect(response.status).toBe(401);
    expect(mock.subscribe).not.toHaveBeenCalled();
  },
);

it("returns a missing/foreign task as an HTTP 404 and releases its subscription", async () => {
  mock.get.mockRejectedValue(new AccessError(404, "AI 任务不存在。"));
  expect((await detail()).status).toBe(404);
  expect(mock.get).toHaveBeenCalledWith(job.userId, job.id);
  expect(mock.unsubscribe).toHaveBeenCalledOnce();
});

it("filters unrelated changes and pushes committed progress, then closes a finished detail", async () => {
  const stream = reader(await detail());
  await text(stream);
  await text(stream);
  change({ kind: "job", userId: "another-user", id: job.id });
  change({ kind: "job", userId: job.userId, id: "another-job" });
  mock.subscribe.mock.calls[0][0]({ kind: "models" });
  expect(mock.get).toHaveBeenCalledOnce();
  mock.get.mockResolvedValue(
    databaseJob({ status: "COMPLETED", result: { summary: "已完成" }, finishedAt: new Date() }),
  );
  change();
  expect(await text(stream)).toContain('"status":"COMPLETED"');
  expect((await stream.read()).done).toBe(true);
  expect(mock.unsubscribe).toHaveBeenCalledOnce();
});

it("provides real protobuf snapshots when requested", async () => {
  const stream = reader(await listGET(request("/events?format=protobuf")));
  await text(stream);
  const message = await text(stream);
  expect(message).toContain("event: snapshot-protobuf\n");
  const payload = message.split("data: ")[1].trim();
  expect(decodeAiProgress(payload)).toEqual({
    models: [{ id: "model", name: "教学模型" }],
    jobs: [job],
  });
});

it("rejects unknown formats without opening a listener", async () => {
  expect((await listGET(request("/events?format=binary"))).status).toBe(400);
  expect(mock.subscribe).not.toHaveBeenCalled();
});

it("releases resources on abort, database disconnect and session expiry", async () => {
  const abort = new AbortController();
  const stream = reader(await detail(undefined, abort.signal));
  await text(stream);
  await text(stream);
  abort.abort();
  expect((await stream.read()).done).toBe(true);
  expect(mock.unsubscribe).toHaveBeenCalledTimes(1);
  const second = reader(await detail());
  await text(second);
  await text(second);
  mock.subscribe.mock.calls[1][1]();
  expect((await second.read()).done).toBe(true);
  expect(mock.unsubscribe).toHaveBeenCalledTimes(2);
  const third = reader(await detail());
  await text(third);
  await text(third);
  await vi.advanceTimersByTimeAsync(60_000);
  // Drain the queued heartbeat comments before EOF.
  while (!(await third.read()).done) {
    /* drain */
  }
  expect(mock.unsubscribe).toHaveBeenCalledTimes(3);
});

it("does not lose an update committed while the initial snapshot is loading", async () => {
  let resolve!: (value: ReturnType<typeof databaseJob>) => void;
  mock.get.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const pending = detail();
  await vi.advanceTimersByTimeAsync(0);
  change();
  resolve(databaseJob());
  mock.get.mockResolvedValue(databaseJob({ events: [{ type: "complete", summary: "最新进度" }] }));
  const stream = reader(await pending);
  await text(stream);
  await text(stream);
  expect(await text(stream)).toContain("最新进度");
  expect(mock.get).toHaveBeenCalledTimes(2);
});

it("streams embedding progress only to administrators and checks permission on every update", async () => {
  mock.actor.mockResolvedValueOnce({ role: "TEACHER" });
  expect((await searchGET(request())).status).toBe(403);
  expect(mock.search).not.toHaveBeenCalled();
  const stream = reader(await searchGET(request("/events?format=protobuf")));
  await text(stream);
  const payload = (await text(stream)).split("data: ")[1].trim();
  expect(decodeAiProgress(payload).searchConfiguration?.searchIndex.pending).toBe(8);
  const signal = mock.subscribe.mock.calls[1][0];
  signal({ kind: "job", userId: job.userId, id: job.id });
  expect(mock.search).toHaveBeenCalledOnce();
  mock.search.mockResolvedValue({
    embedding: null,
    searchIndex: { total: 8, indexed: 8, pending: 0, failed: 0, enabled: true },
  });
  signal({ kind: "search" });
  expect(
    decodeAiProgress((await text(stream)).split("data: ")[1].trim()).searchConfiguration
      ?.searchIndex.indexed,
  ).toBe(8);
  mock.actor.mockResolvedValue({ role: "TEACHER" });
  signal({ kind: "search" });
  expect((await stream.read()).done).toBe(true);
});
