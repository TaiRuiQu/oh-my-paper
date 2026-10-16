import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("pg", () => ({
  Client: class {
    constructor() {
      return mock.create();
    }
  },
}));
vi.mock("@/server/config/env", () => ({
  getEnv: () => ({ DATABASE_URL: "postgresql://unused/test?schema=isolated" }),
}));
import { subscribeAiProgress } from "@/server/platform/ai-progress-notifications";

let client: EventEmitter & {
  connect: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
};
let stops: (() => void)[];
beforeEach(() => {
  stops = [];
  client = Object.assign(new EventEmitter(), {
    connect: vi.fn(async () => {}),
    query: vi.fn(async () => {}),
    end: vi.fn(async () => {}),
  });
  mock.create.mockReset().mockReturnValue(client);
});
afterEach(() => stops.forEach((stop) => stop()));

it("shares one listener, filters database schemas and closes after the last subscriber", async () => {
  const first = vi.fn(),
    second = vi.fn();
  stops.push(
    ...(await Promise.all([
      subscribeAiProgress(first, vi.fn()),
      subscribeAiProgress(second, vi.fn()),
    ])),
  );
  expect(mock.create).toHaveBeenCalledOnce();
  expect(client.query).toHaveBeenCalledExactlyOnceWith("LISTEN omp_ai_progress");
  const notify = (data: unknown) =>
    client.emit("notification", { channel: "omp_ai_progress", payload: JSON.stringify(data) });
  notify({ schema: "foreign", kind: "job", userId: "user", id: "job" });
  notify({ schema: "isolated", kind: "job" });
  client.emit("notification", { channel: "omp_ai_progress", payload: "invalid" });
  expect(first).not.toHaveBeenCalled();
  notify({ schema: "isolated", kind: "job", userId: "user", id: "job" });
  expect(first).toHaveBeenCalledOnce();
  expect(second).toHaveBeenCalledOnce();
  stops[0]();
  expect(client.end).not.toHaveBeenCalled();
  stops[1]();
  expect(client.end).toHaveBeenCalledOnce();
});

it.each(["error", "end"])(
  "disconnects all streams and permits a fresh listener after %s",
  async (event) => {
    const first = vi.fn(),
      second = vi.fn();
    stops.push(await subscribeAiProgress(vi.fn(), first));
    stops.push(await subscribeAiProgress(vi.fn(), second));
    client.emit(event, new Error("connection lost"));
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(client.end).toHaveBeenCalledOnce();
    stops.push(await subscribeAiProgress(vi.fn(), vi.fn()));
    expect(mock.create).toHaveBeenCalledTimes(2);
  },
);

it("releases a failed connection and lets the next request establish LISTEN", async () => {
  client.connect.mockRejectedValueOnce(new Error("unavailable"));
  await expect(subscribeAiProgress(vi.fn(), vi.fn())).rejects.toThrow("unavailable");
  expect(client.end).toHaveBeenCalledOnce();
  stops.push(await subscribeAiProgress(vi.fn(), vi.fn()));
  expect(mock.create).toHaveBeenCalledTimes(2);
});
