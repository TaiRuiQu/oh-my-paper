import "server-only";
import { z } from "zod";
import type { LanguageModelUsage } from "ai";
import type { AiModelPrices, AiTaskCost, AiTokenPrices } from "@/contracts/ai-cost";

const price = z.number().finite().nonnegative();
const tokenPrices = z.object({
  input: price,
  output: price,
  cache_read: price.optional(),
  cache_write: price.optional(),
  reasoning: price.optional(),
});
const modelPrices = tokenPrices.extend({
  tiers: z
    .array(
      tokenPrices.partial().extend({
        tier: z.object({ type: z.literal("context"), size: price }),
      }),
    )
    .optional(),
});
const catalogSchema = z.record(
  z.string(),
  z.object({
    id: z.string(),
    name: z.string(),
    api: z.string().optional(),
    models: z.record(
      z.string(),
      z.object({
        id: z.string(),
        canonical_model_id: z.string().optional(),
        cost: modelPrices.optional(),
      }),
    ),
  }),
);
type Catalog = z.infer<typeof catalogSchema>;
type ModelIdentity = { model: string; providerName: string; baseURL?: string };

/** Share requests across concurrent jobs; failures get a short retry window, never a zero price. */
function cached<T>(load: () => Promise<T>, ttl: number) {
  let value: Promise<{ data: T; fetchedAt: string } | null> | undefined;
  let expires = 0;
  return () => {
    if (!value || Date.now() >= expires) {
      expires = Infinity;
      value = load()
        .then((data) => {
          expires = Date.now() + ttl;
          return { data, fetchedAt: new Date().toISOString() };
        })
        .catch(() => {
          expires = Date.now() + 60_000;
          return null;
        });
    }
    return value;
  };
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
    headers: { "User-Agent": "OhMyPaper/2 (+https://models.dev)", Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Cost data HTTP ${response.status}`);
  return response.json();
}

const getCatalog = cached(
  async () => catalogSchema.parse(await fetchJson("https://models.dev/api.json")),
  60 * 60_000,
);
const getExchangeRate = cached(
  async () => {
    const data = z
      .object({
        result: z.literal("success"),
        base_code: z.literal("USD"),
        time_last_update_unix: z.number().int().positive(),
        rates: z.object({ CNY: z.number().finite().positive() }),
      })
      .parse(await fetchJson("https://open.er-api.com/v6/latest/USD"));
    return {
      usdToCny: data.rates.CNY,
      updatedAt: new Date(data.time_last_update_unix * 1000).toISOString(),
    };
  },
  24 * 60 * 60_000,
);

// Latest published CNY rate verified at implementation time. Used only when the live API fails.
// Source: https://open.er-api.com/v6/latest/USD (2026-10-15 00:02:31 UTC).
const FALLBACK_EXCHANGE_RATE = {
  usdToCny: 6.706494,
  updatedAt: "2026-10-15T00:02:31.000Z",
  fetchedAt: "2026-10-15T00:02:31.000Z",
  source: "fallback" as const,
};

function endpoint(value?: string) {
  try {
    return value ? new URL(value) : null;
  } catch {
    return null;
  }
}

function findPricing(catalog: Catalog, identity: ModelIdentity) {
  const base = endpoint(identity.baseURL);
  // These providers do not publish `api` in models.dev because they have native SDKs.
  const nativeHosts: Record<string, string> = {
    "api.openai.com": "openai",
    "api.anthropic.com": "anthropic",
    "generativelanguage.googleapis.com": "google",
  };
  const providers = Object.values(catalog);
  const byEndpoint =
    base &&
    providers
      .filter((provider) => {
        const api = endpoint(provider.api);
        return (
          nativeHosts[base.hostname] === provider.id ||
          (api &&
            api.origin === base.origin &&
            `${base.pathname.replace(/\/$/, "")}/`.startsWith(
              `${api.pathname.replace(/\/$/, "")}/`,
            ))
        );
      })
      .sort((a, b) => (b.api?.length ?? 0) - (a.api?.length ?? 0))[0];
  const name = identity.providerName.toLowerCase();
  const provider =
    byEndpoint ??
    providers.find((p) => p.id.toLowerCase() === name || p.name.toLowerCase() === name);
  const findModel = (p: Catalog[string]) =>
    p.models[identity.model] ??
    (identity.model.startsWith(`${p.id}/`)
      ? p.models[identity.model.slice(p.id.length + 1)]
      : undefined);
  if (provider) {
    const model = findModel(provider);
    // A known provider's missing price must not silently become another supplier's price.
    return model?.cost
      ? { provider: provider.id, model: model.id, prices: model.cost, match: "provider" as const }
      : null;
  }
  const candidates = providers.flatMap((p) =>
    Object.values(p.models).filter(
      (m) => m.id === identity.model || m.canonical_model_id === identity.model,
    ),
  );
  const canonicalIds = new Set(
    candidates.map((m) => m.canonical_model_id).filter((id) => id !== undefined),
  );
  const qualified = identity.model.includes("/")
    ? identity.model
    : canonicalIds.size === 1
      ? [...canonicalIds][0]
      : undefined;
  if (qualified) {
    const lab = catalog[qualified.split("/")[0]];
    const model = lab && (lab.models[qualified] ?? lab.models[qualified.slice(lab.id.length + 1)]);
    if (model?.cost)
      return { provider: lab.id, model: model.id, prices: model.cost, match: "reference" as const };
  }
  // For unqualified IDs without canonical metadata, accept only a unique catalog entry.
  if (candidates.length === 1 && candidates[0].cost) {
    const model = candidates[0];
    const owner = providers.find((p) => Object.values(p.models).includes(model))!;
    return {
      provider: owner.id,
      model: model.id,
      prices: model.cost!,
      match: "reference" as const,
    };
  }
  return null;
}

function pricesForStep(prices: AiModelPrices, inputTokens: number): AiTokenPrices {
  const tier = prices.tiers
    ?.filter((entry) => inputTokens > entry.tier.size)
    .sort((a, b) => b.tier.size - a.tier.size)[0];
  return { ...prices, ...tier };
}

/** Each step is priced separately: context tiers and cache hits can change within one task. */
export async function createTaskCostTracker(identity: ModelIdentity) {
  const [catalog, exchange] = await Promise.all([getCatalog(), getExchangeRate()]);
  const matched = catalog && findPricing(catalog.data, identity);
  const pricing = matched && catalog ? { ...matched, fetchedAt: catalog.fetchedAt } : null;
  const exchangeRate = exchange
    ? { ...exchange.data, fetchedAt: exchange.fetchedAt, source: "live" as const }
    : FALLBACK_EXCHANGE_RATE;
  let steps = 0,
    usd = 0,
    inputTokens = 0,
    outputTokens = 0,
    cacheReadTokens = 0,
    cacheWriteTokens = 0,
    reasoningTokens = 0,
    missingUsage = false;
  return {
    add(usage: LanguageModelUsage) {
      steps++;
      const input = usage.inputTokens,
        output = usage.outputTokens;
      const read = usage.inputTokenDetails.cacheReadTokens ?? 0;
      const write = usage.inputTokenDetails.cacheWriteTokens ?? 0;
      const reasoning = usage.outputTokenDetails.reasoningTokens ?? 0;
      const counts = [input, output, read, write, reasoning];
      if (
        counts.some((value) => value === undefined || !Number.isFinite(value) || value < 0) ||
        read + write > (input ?? 0) ||
        reasoning > (output ?? 0)
      ) {
        missingUsage = true;
        return;
      }
      inputTokens += input!;
      outputTokens += output!;
      cacheReadTokens += read;
      cacheWriteTokens += write;
      reasoningTokens += reasoning;
      if (!pricing) return;
      const rates = pricesForStep(pricing.prices, input!);
      usd +=
        ((input! - read - write) * rates.input +
          read * (rates.cache_read ?? rates.input) +
          write * (rates.cache_write ?? rates.input) +
          (output! - reasoning) * rates.output +
          reasoning * (rates.reasoning ?? rates.output)) /
        1_000_000;
    },
    snapshot(): AiTaskCost {
      const usageKnown = steps > 0 && !missingUsage;
      const total = pricing && usageKnown ? usd : null;
      const cny = total !== null ? total * exchangeRate.usdToCny : null;
      return {
        status: cny === null ? "unavailable" : "estimated",
        reason: !pricing ? "price_unavailable" : !usageKnown ? "usage_unavailable" : null,
        usd: total,
        cny,
        steps,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        reasoningTokens,
        pricing,
        exchangeRate,
      };
    },
  };
}
