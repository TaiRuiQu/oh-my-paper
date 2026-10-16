// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openAiProgress } from "@/lib/ai-progress-client";
import { encodeAiProgress } from "@/lib/ai-progress-codec";
import { MockEventSource } from "./fixtures/event-source";
import { aiTraceFixtures } from "./fixtures/ai-traces";

let stop: () => void;
beforeEach(() => {
  vi.useFakeTimers();
  MockEventSource.install();
});
afterEach(() => {
  stop?.();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("decodes protobuf and preserves ordering with a following JSON event", async () => {
  const snapshot = vi.fn();
  const error = vi.fn();
  stop = openAiProgress({ snapshot, error });
  const first = { models: [], jobs: [aiTraceFixtures[0]] };
  const second = { models: [], jobs: [{ ...aiTraceFixtures[0], attempts: 2 }] };
  MockEventSource.current.dispatchEvent(
    new MessageEvent("snapshot-protobuf", {
      data: encodeAiProgress(first),
    }),
  );
  MockEventSource.current.snapshot(second);
  await vi.waitFor(() => expect(snapshot).toHaveBeenCalledTimes(2));
  expect(snapshot.mock.calls.map(([data]) => data)).toEqual([first, second]);
  expect(error).not.toHaveBeenCalled();
});

it("lets native EventSource reconnect and resumes with a full latest snapshot", async () => {
  const snapshot = vi.fn();
  const error = vi.fn();
  stop = openAiProgress({ snapshot, error });
  const source = MockEventSource.current;
  source.readyState = MockEventSource.CONNECTING;
  source.onerror?.();
  await vi.advanceTimersByTimeAsync(9000);
  expect(MockEventSource.instances).toHaveLength(1);
  expect(error).toHaveBeenCalledOnce();
  source.snapshot({ models: [], jobs: [aiTraceFixtures[0]] });
  await vi.advanceTimersByTimeAsync(0);
  expect(snapshot).toHaveBeenCalledOnce();
});

it("retries a permanently closed connection and stops reconnecting after disposal", async () => {
  const error = vi.fn();
  stop = openAiProgress({ snapshot: vi.fn(), error });
  MockEventSource.current.readyState = MockEventSource.CLOSED;
  MockEventSource.current.onerror?.();
  await vi.advanceTimersByTimeAsync(3000);
  expect(MockEventSource.instances).toHaveLength(2);
  const source = MockEventSource.current;
  source.readyState = MockEventSource.CLOSED;
  source.onerror?.();
  stop();
  await vi.advanceTimersByTimeAsync(9000);
  expect(MockEventSource.instances).toHaveLength(2);
});

it("ignores stale events after manual reconnect/disposal", async () => {
  const snapshot = vi.fn();
  stop = openAiProgress({ snapshot, error: vi.fn() });
  const source = MockEventSource.current;
  source.snapshot({ models: [], jobs: [aiTraceFixtures[0]] });
  stop();
  await vi.advanceTimersByTimeAsync(0);
  expect(snapshot).not.toHaveBeenCalled();
  expect(source.close).toHaveBeenCalledOnce();
});

it("recovers from a malformed payload while preserving the last successfully received snapshot", async () => {
  const snapshot = vi.fn();
  const error = vi.fn();
  stop = openAiProgress({ snapshot, error });
  const data = { models: [], jobs: [aiTraceFixtures[0]] };
  MockEventSource.current.snapshot(data);
  await vi.advanceTimersByTimeAsync(0);
  MockEventSource.current.dispatchEvent(new MessageEvent("snapshot", { data: "malformed" }));
  await vi.advanceTimersByTimeAsync(0);
  expect(error).toHaveBeenCalledOnce();
  expect(snapshot).toHaveBeenCalledExactlyOnceWith(data);
  await vi.advanceTimersByTimeAsync(3000);
  expect(MockEventSource.instances).toHaveLength(2);
  MockEventSource.current.snapshot(data);
  await vi.advanceTimersByTimeAsync(0);
  expect(snapshot).toHaveBeenCalledTimes(2);
});
