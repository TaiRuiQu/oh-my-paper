import { modelStreamResponse } from "./model-stream-response";
import { describe, expect, it, vi } from "vitest";
import type { LanguageModelUsage } from "ai";
import { usageCharge } from "@/server/ai/credits";
import { creditAmount, creditUnits, sumCredits } from "@/lib/credits";
import { createProviderExamModel } from "@/server/ai/providers";
import type { ProviderSnapshot } from "@/contracts/ai-providers";
import { tool } from "ai";
import { z } from "zod";
const usage = (input = 1000, output = 1000, cached = 0): LanguageModelUsage => ({
  inputTokens: input,
  outputTokens: output,
  totalTokens: input + output,
  inputTokenDetails: {
    noCacheTokens: input - cached,
    cacheReadTokens: cached,
    cacheWriteTokens: 0,
  },
  outputTokenDetails: { textTokens: output - 100, reasoningTokens: 100 },
});
describe("credit accounting", () => {
  it("prices cached input once, all output including reasoning, and model multipliers", () => {
    expect(usageCharge(usage(), 1).credits).toBe("0.60000000");
    expect(usageCharge(usage(1000, 0, 1000), 1).credits).toBe("0.02000000");
    expect(usageCharge(usage(1000, 1000, 500), 2.5).credits).toBe("1.40000000");
    expect(usageCharge(usage(1, 0, 0), 0.0001).credits).toBe("0.00000001");
    const writes = usage(1000, 0, 100);
    writes.inputTokenDetails.cacheWriteTokens = 300;
    expect(usageCharge(writes, 1).credits).toBe("0.09200000");
  });
  it("uses detail totals only when complete and stops on missing or invalid usage", () => {
    expect(
      usageCharge({ ...usage(), inputTokens: undefined, outputTokens: undefined }, 1).credits,
    ).toBe("0.60000000");
    for (const invalid of [
      { ...usage(), inputTokens: -1 },
      { ...usage(), outputTokens: NaN },
      { ...usage(), inputTokenDetails: { ...usage().inputTokenDetails, cacheReadTokens: 1001 } },
      {
        ...usage(),
        outputTokens: undefined,
        outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
      },
    ])
      expect(() => usageCharge(invalid, 1)).toThrow();
    for (const multiplier of [0, -1, Infinity, 1001, 1.00001])
      expect(() => usageCharge(usage(), multiplier)).toThrow();
  });
  it("retains exact fractional balances and sums across retries", () => {
    expect(creditAmount(creditUnits("100") - creditUnits("0.00000001"))).toBe("99.99999999");
    expect(sumCredits(["0.1", "0.2", undefined])).toBe("0.30000000");
    expect(creditAmount(creditUnits("-0.05000001"))).toBe("-0.05000001");
  });
  it("settles each SDK response before concurrent tools and keeps the current agent running in debt", async () => {
    const config: ProviderSnapshot = {
      providerId: "10000000-0000-4000-8000-000000000001",
      name: "test",
      apiType: "openai_chat",
      baseURL: "https://example.invalid/v1",
      encryptedApiKey: "encrypted",
      structuredOutputs: true,
      maxOutputTokens: 16000,
      timeoutSeconds: 60,
      maxConcurrency: 3,
      model: "test-model",
      reasoningEffort: "default",
    };
    let round = 0,
      balance = 0.01,
      complete = false;
    const sequence: string[] = [];
    const meter = {
      beforeCall: vi.fn(async () => {
        sequence.push("call");
      }),
      record: vi.fn(async (_id: string, used: LanguageModelUsage) => {
        balance -= Number(usageCharge(used, 1).credits);
        sequence.push("charge");
      }),
    };
    const fetch: typeof globalThis.fetch = async () => {
      round++;
      return modelStreamResponse({
        id: `completion-${round}`,
        object: "chat.completion",
        created: 1,
        model: config.model,
        usage: {
          prompt_tokens: 1000,
          completion_tokens: 1000,
          prompt_tokens_details: { cached_tokens: 500 },
        },
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: `tool-${round}`,
                  type: "function",
                  function: { name: round === 1 ? "save" : "finish", arguments: "{}" },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      });
    };
    await createProviderExamModel(config, "key", fetch, meter).run({
      system: "Save then finish",
      content: [{ type: "text", text: "work" }],
      isComplete: () => complete,
      tools: {
        save: tool({
          inputSchema: z.object({}),
          execute: async () => {
            sequence.push("save");
            expect(balance).toBeLessThan(0);
            return {};
          },
        }),
        finish: tool({
          inputSchema: z.object({}),
          execute: async () => {
            sequence.push("finish");
            complete = true;
            return {};
          },
        }),
      },
    });
    expect(sequence).toEqual(["call", "charge", "save", "call", "charge", "finish"]);
    expect(meter.record).toHaveBeenCalledTimes(2);
    expect(new Set(meter.record.mock.calls.map(([id]) => id)).size).toBe(2);
    expect(balance).toBeCloseTo(-1.11);
  });
});
