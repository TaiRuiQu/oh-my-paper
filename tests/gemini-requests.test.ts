import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { eventStream } from "./model-stream-response";
import { agentTool } from "@/server/ai/agent-tool";
import { createProviderExamModel, reasoningOptions } from "@/server/ai/providers";
import { usageCharge } from "@/server/ai/credits";
import { providerInputSchema, type ProviderSnapshot } from "@/contracts/ai-providers";

const config: ProviderSnapshot = {
  providerId: "10000000-0000-4000-8000-000000000001",
  name: "Gemini",
  apiType: "google",
  baseURL: "https://gemini.example/v1beta",
  encryptedApiKey: "encrypted",
  model: "gemini-3.8-flash",
  reasoningEffort: "high",
  structuredOutputs: false,
  maxOutputTokens: 16000,
  timeoutSeconds: 60,
  maxConcurrency: 3,
};
const image =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKxkAAAAASUVORK5CYII=";

function interactionResponse(round: number, name: string, args: object) {
  const serialized = JSON.stringify(args),
    middle = Math.floor(serialized.length / 2);
  return eventStream([
    {
      event_type: "interaction.created",
      interaction: { id: `interaction-${round}`, status: "in_progress" },
    },
    {
      event_type: "step.start",
      index: 0,
      step: { type: "function_call", id: `call-${round}`, name, signature: `signature-${round}` },
    },
    {
      event_type: "step.delta",
      index: 0,
      delta: { type: "arguments_delta", arguments: serialized.slice(0, middle) },
    },
    {
      event_type: "step.delta",
      index: 0,
      delta: { type: "arguments_delta", arguments: serialized.slice(middle) },
    },
    { event_type: "step.stop", index: 0 },
    {
      event_type: "interaction.completed",
      interaction: {
        id: `interaction-${round}`,
        status: "requires_action",
        usage: {
          total_input_tokens: 5000,
          total_output_tokens: 20,
          total_thought_tokens: 5,
          total_cached_tokens: round ? 2048 : 0,
        },
      },
    },
  ]);
}

describe("Gemini protocol integration", () => {
  it("accepts the Interactions provider and only offers its supported reasoning levels", () => {
    const input = {
      name: "Gemini",
      apiType: "google_interactions",
      baseURL: config.baseURL,
      models: [
        { name: config.model, reasoningEfforts: ["default", "minimal", "low", "medium", "high"] },
      ],
    };
    expect(providerInputSchema.parse(input).apiType).toBe("google_interactions");
    for (const effort of ["none", "xhigh", "max"])
      expect(
        providerInputSchema.safeParse({
          ...input,
          models: [{ name: config.model, reasoningEfforts: [effort] }],
        }).success,
      ).toBe(false);
    expect(reasoningOptions({ ...config, apiType: "google_interactions" })).toEqual({
      google: { store: true, thinkingLevel: "high" },
    });
    expect(
      reasoningOptions({ ...config, apiType: "google_interactions", reasoningEffort: "default" }),
    ).toEqual({ google: { store: true } });
  });

  it.each(["google", "google_interactions"] as const)(
    "%s preserves three rounds of instructions and image/tool history and records usage",
    async (apiType) => {
      const requests: { raw: string; body: Record<string, unknown> }[] = [];
      const record = vi.fn();
      let complete = false;
      const transport: typeof fetch = async (url, init) => {
        expect(new Headers(init?.headers).get("x-goog-api-key")).toBe("test-key");
        expect(String(url)).toBe(
          apiType === "google"
            ? `${config.baseURL}/models/${config.model}:streamGenerateContent?alt=sse`
            : `${config.baseURL}/interactions`,
        );
        const raw = String(init?.body),
          body = JSON.parse(raw),
          round = requests.length;
        requests.push({ raw, body });
        expect(body[apiType === "google" ? "generationConfig" : "generation_config"]).toMatchObject(
          apiType === "google"
            ? { maxOutputTokens: 16000, thinkingConfig: { thinkingLevel: "high" } }
            : { max_output_tokens: 16000, thinking_level: "high" },
        );
        const name = round < 2 ? "read" : "finish",
          args = round < 2 ? { number: round + 1 } : {};
        if (apiType === "google_interactions") {
          expect(body.model).toBe(config.model);
          expect(body.store).toBe(true);
          return interactionResponse(round, name, args);
        }
        return eventStream([
          {
            candidates: [
              {
                index: 0,
                content: {
                  role: "model",
                  parts: [
                    {
                      functionCall: { id: `call-${round}`, name, args },
                      thoughtSignature: `signature-${round}`,
                    },
                  ],
                },
                finishReason: "STOP",
              },
            ],
            usageMetadata: {
              promptTokenCount: 5000,
              candidatesTokenCount: 20,
              thoughtsTokenCount: 5,
              cachedContentTokenCount: round ? 2048 : 0,
            },
          },
        ]);
      };
      await createProviderExamModel({ ...config, apiType }, "test-key", transport, {
        beforeCall: async () => {},
        record,
      }).run({
        system: "Inspect the supplied paper.",
        content: [
          { type: "text", text: "Common paper context. ".repeat(500) },
          { type: "file", mediaType: "image/png", data: Buffer.from(image, "base64") },
        ],
        isComplete: () => complete,
        tools: {
          read: agentTool({
            description: "Read another question.",
            inputSchema: z.strictObject({ number: z.number().int().positive() }),
            execute: async ({ number }) => ({ number, text: `Question ${number}` }),
            toModelOutput: ({ output }) => ({
              type: "content",
              value: [
                { type: "text", text: JSON.stringify(output) },
                { type: "file", mediaType: "image/png", data: { type: "data", data: image } },
              ],
            }),
          }),
          finish: agentTool({
            description: "Finish.",
            inputSchema: z.strictObject({}),
            execute: async () => {
              complete = true;
              return { complete };
            },
          }),
        },
      });
      expect(requests).toHaveLength(3);
      const historyKey = apiType === "google" ? "contents" : "input";
      const systemKey = apiType === "google" ? "systemInstruction" : "system_instruction";
      for (let index = 1; index < requests.length; index++) {
        const previous = requests[index - 1],
          current = requests[index];
        const history = previous.body[historyKey] as unknown[];
        expect((current.body[historyKey] as unknown[]).slice(0, history.length)).toEqual(history);
        expect(current.body[systemKey]).toEqual(previous.body[systemKey]);
        expect(current.body.tools).toEqual(previous.body.tools);
        expect(current.raw).toContain(image);
        expect(current.raw).toContain(`signature-${index - 1}`);
      }
      expect(record).toHaveBeenCalledTimes(3);
      expect(record.mock.calls[1][1].inputTokenDetails.cacheReadTokens).toBe(2048);
      expect(usageCharge(record.mock.calls[1][1], 1)).toMatchObject({
        inputTokens: 5000,
        cachedTokens: 2048,
        outputTokens: 25,
      });
    },
  );
});
