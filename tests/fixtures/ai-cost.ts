import type { AiTaskCost } from "@/contracts/ai-cost";

export const aiCostFixture: AiTaskCost = {
  status: "estimated",
  reason: null,
  usd: 0.002,
  cny: 0.014,
  steps: 4,
  inputTokens: 1000,
  outputTokens: 100,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  reasoningTokens: 0,
  pricing: {
    provider: "openai",
    model: "fixture-model",
    match: "provider",
    prices: { input: 1, output: 10 },
    fetchedAt: "2026-10-15T00:00:00.000Z",
  },
  exchangeRate: {
    usdToCny: 7,
    updatedAt: "2026-10-15T00:00:00.000Z",
    fetchedAt: "2026-10-15T00:00:00.000Z",
    source: "live",
  },
};
