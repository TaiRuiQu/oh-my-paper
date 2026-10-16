export type AiTokenPrices = {
  input: number;
  output: number;
  cache_read?: number;
  cache_write?: number;
  reasoning?: number;
};

export type AiModelPrices = AiTokenPrices & {
  tiers?: (Partial<AiTokenPrices> & { tier: { type: "context"; size: number } })[];
};

export type AiTaskCost = {
  status: "estimated" | "unavailable";
  reason: "price_unavailable" | "usage_unavailable" | null;
  usd: number | null;
  cny: number | null;
  steps: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  pricing: {
    provider: string;
    model: string;
    match: "provider" | "reference";
    prices: AiModelPrices;
    fetchedAt: string;
  } | null;
  exchangeRate: {
    usdToCny: number;
    updatedAt: string;
    fetchedAt: string;
    source: "live" | "fallback";
  };
};
