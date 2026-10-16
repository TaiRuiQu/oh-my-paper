import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LanguageModelUsage } from "ai";

const catalog = {
  openai: {
    id: "openai",
    name: "OpenAI",
    models: {
      "test-model": {
        id: "test-model",
        canonical_model_id: "openai/test-model",
        cost: {
          input: 2,
          output: 10,
          cache_read: 0.5,
          cache_write: 2.5,
          reasoning: 12,
          tiers: [{ input: 4, output: 20, tier: { type: "context", size: 200_000 } }],
        },
      },
      free: { id: "free", cost: { input: 0, output: 0 } },
    },
  },
  relay: {
    id: "relay",
    name: "Relay",
    api: "https://relay.example/v1",
    models: {
      "test-model": {
        id: "test-model",
        canonical_model_id: "openai/test-model",
        cost: { input: 1, output: 5 },
      },
    },
  },
};
const rate = {
  result: "success",
  base_code: "USD",
  time_last_update_unix: 1792022551,
  rates: { CNY: 7 },
};
const identity = {
  model: "test-model",
  providerName: "OpenAI",
  baseURL: "https://api.openai.com/v1",
};
function usage(
  input = 1000,
  output = 100,
  read = 200,
  write = 100,
  reasoning = 20,
): LanguageModelUsage {
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: input + output,
    inputTokenDetails: {
      noCacheTokens: input - read - write,
      cacheReadTokens: read,
      cacheWriteTokens: write,
    },
    outputTokenDetails: { textTokens: output - reasoning, reasoningTokens: reasoning },
  };
}
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-15T01:00:00Z"));
  fetcher = vi.fn(async (url: string) =>
    Response.json(url.includes("models.dev") ? catalog : rate),
  );
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const tracker = async (model = identity) =>
  (await import("@/server/platform/ai/cost")).createTaskCostTracker(model);

it("prices every agent step including cache reads, writes and reasoning without double counting", async () => {
  const task = await tracker();
  task.add(usage());
  task.add(usage());
  // Per step: 700*2 + 200*.5 + 100*2.5 + 80*10 + 20*12 = 2790 USD / million.
  expect(task.snapshot().usd).toBeCloseTo(0.00558);
  expect(task.snapshot().cny).toBeCloseTo(0.03906);
  expect(task.snapshot()).toMatchObject({
    status: "estimated",
    steps: 2,
    inputTokens: 2000,
    outputTokens: 200,
    cacheReadTokens: 400,
    cacheWriteTokens: 200,
    reasoningTokens: 40,
    exchangeRate: { source: "live", usdToCny: 7 },
    pricing: { provider: "openai", prices: { input: 2, output: 10 } },
  });
});

it("applies context tiers to individual requests rather than cumulative task input", async () => {
  const task = await tracker();
  task.add(usage(200_000, 100, 0, 0, 0));
  task.add(usage(200_001, 100, 0, 0, 0));
  expect(task.snapshot().usd).toBeCloseTo((200_000 * 2 + 100 * 10 + 200_001 * 4 + 100 * 20) / 1e6);
});

it("uses endpoint-specific supplier prices ahead of names and does not guess from the API protocol", async () => {
  const task = await tracker({ ...identity, baseURL: "https://relay.example/v1" });
  task.add(usage(1000, 100, 0, 0, 0));
  expect(task.snapshot().usd).toBeCloseTo(0.0015);
  expect(task.snapshot().pricing).toMatchObject({ provider: "relay", match: "provider" });
  const proxy = await tracker({
    ...identity,
    providerName: "自建网关",
    baseURL: "https://school.example/v1",
  });
  proxy.add(usage());
  expect(proxy.snapshot().pricing).toMatchObject({ provider: "openai", match: "reference" });
});

it("supports qualified model IDs and refuses to substitute another supplier for a known missing model", async () => {
  const qualified = await tracker({ ...identity, model: "openai/test-model" });
  qualified.add(usage());
  expect(qualified.snapshot().status).toBe("estimated");
  const missing = await tracker({
    ...identity,
    model: "free",
    baseURL: "https://relay.example/v1",
  });
  missing.add(usage());
  expect(missing.snapshot()).toMatchObject({ reason: "price_unavailable", cny: null });
});

it("shares in-flight fetches, refreshes catalog hourly and rates daily, and retains task snapshots", async () => {
  const [a, b] = await Promise.all([tracker(), tracker()]);
  a.add(usage());
  b.add(usage());
  const original = a.snapshot();
  expect(fetcher).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(60 * 60_000 + 1);
  fetcher.mockImplementation(async (url: string) =>
    Response.json(
      url.includes("models.dev")
        ? {
            ...catalog,
            openai: {
              ...catalog.openai,
              models: {
                ...catalog.openai.models,
                "test-model": { id: "test-model", cost: { input: 20, output: 100 } },
              },
            },
          }
        : rate,
    ),
  );
  const next = await tracker();
  next.add(usage());
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(next.snapshot().usd).toBeGreaterThan(original.usd!);
  expect(a.snapshot()).toEqual(original);
  vi.advanceTimersByTime(24 * 60 * 60_000);
  await tracker();
  expect(fetcher.mock.calls.filter(([url]) => url.includes("open.er-api.com"))).toHaveLength(2);
});

it.each(["network", "invalid", "http"])(
  "falls back to the verified fixed rate after an exchange %s failure, then retries",
  async (failure) => {
    fetcher.mockImplementation(async (url: string) => {
      if (url.includes("models.dev")) return Response.json(catalog);
      if (failure === "network") throw new Error("offline");
      return failure === "http"
        ? new Response(null, { status: 503 })
        : Response.json({ ...rate, rates: { CNY: -1 } });
    });
    const task = await tracker();
    task.add(usage());
    expect(task.snapshot()).toMatchObject({
      status: "estimated",
      exchangeRate: { source: "fallback", usdToCny: 6.706494 },
    });
    expect(task.snapshot().cny).toBeCloseTo(task.snapshot().usd! * 6.706494);
    fetcher.mockImplementation(async (url: string) =>
      Response.json(url.includes("models.dev") ? catalog : rate),
    );
    vi.advanceTimersByTime(60_001);
    const recovered = await tracker();
    recovered.add(usage());
    expect(recovered.snapshot().exchangeRate.source).toBe("live");
  },
);

it("keeps missing prices and incomplete usage distinct from actual zero-cost models", async () => {
  const unknown = await tracker({ ...identity, model: "unknown" });
  unknown.add(usage());
  expect(unknown.snapshot()).toMatchObject({
    status: "unavailable",
    reason: "price_unavailable",
    usd: null,
    cny: null,
  });
  const incomplete = await tracker();
  incomplete.add({ ...usage(), inputTokens: undefined });
  expect(incomplete.snapshot()).toMatchObject({ reason: "usage_unavailable", usd: null });
  const empty = await tracker();
  expect(empty.snapshot().cny).toBeNull();
  const free = await tracker({ ...identity, model: "free" });
  free.add(usage());
  expect(free.snapshot()).toMatchObject({ status: "estimated", usd: 0, cny: 0 });
});

it("does not block an AI task when price fetching fails", async () => {
  fetcher.mockRejectedValue(new Error("offline"));
  const task = await tracker();
  task.add(usage());
  expect(task.snapshot()).toMatchObject({
    status: "unavailable",
    reason: "price_unavailable",
    cny: null,
  });
});
