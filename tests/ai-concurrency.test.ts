import { describe, expect, it } from "vitest";
import { ProviderConcurrencyLimiter } from "@/server/ai/concurrency";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function settle() {
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

describe("provider request scheduling", () => {
  it("shares slots across tasks and releases them after failure", async () => {
    const limiter = new ProviderConcurrencyLimiter();
    const first = deferred(),
      second = deferred();
    const started: number[] = [];
    const a = limiter.run(2, async () => {
      started.push(1);
      await first.promise;
      throw new Error("failed call");
    });
    const outcome = a.catch((error) => error.message);
    const b = limiter.run(2, async () => {
      started.push(2);
      await second.promise;
      return 2;
    });
    const c = limiter.run(2, async () => {
      started.push(3);
      return 3;
    });
    await settle();
    expect(started).toEqual([1, 2]);
    first.resolve();
    expect(await outcome).toBe("failed call");
    expect(await c).toBe(3);
    expect(started).toEqual([1, 2, 3]);
    second.resolve();
    expect(await b).toBe(2);
  });
  it("removes canceled waiting requests without blocking the next task", async () => {
    const limiter = new ProviderConcurrencyLimiter(),
      held = deferred();
    const active = limiter.run(1, () => held.promise);
    const controller = new AbortController();
    let canceledStarted = false;
    const canceled = limiter.run(
      1,
      async () => {
        canceledStarted = true;
      },
      controller.signal,
    );
    const rejected = expect(canceled).rejects.toThrow("cancel waiting");
    const next = limiter.run(1, async () => "next");
    controller.abort(new Error("cancel waiting"));
    await rejected;
    expect(canceledStarted).toBe(false);
    held.resolve();
    await active;
    expect(await next).toBe("next");
  });
  it("waits for older active requests to drain before honoring a lower snapshot limit", async () => {
    const limiter = new ProviderConcurrencyLimiter(),
      held = deferred(),
      lowHeld = deferred();
    const a = limiter.run(3, () => held.promise),
      b = limiter.run(3, () => held.promise);
    let lowStarted = false,
      highStarted = false;
    const low = limiter.run(1, async () => {
      lowStarted = true;
      await lowHeld.promise;
    });
    const high = limiter.run(3, async () => {
      highStarted = true;
    });
    await settle();
    expect(lowStarted).toBe(false);
    held.resolve();
    await Promise.all([a, b]);
    await settle();
    expect(lowStarted).toBe(true);
    expect(highStarted).toBe(false);
    lowHeld.resolve();
    await Promise.all([low, high]);
    expect(highStarted).toBe(true);
  });
});
