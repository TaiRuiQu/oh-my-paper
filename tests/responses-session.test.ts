import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { version as uuidVersion } from "uuid";
import type { ProviderSnapshot } from "@/contracts/ai-providers";
import { parsedExamSchema } from "@/contracts/exams";
import { agentTool } from "@/server/ai/agent-tool";
import { createProviderExamModel } from "@/server/ai/providers";
import { modelStreamResponse } from "./model-stream-response";

const config: ProviderSnapshot = {
  providerId: "10000000-0000-4000-8000-000000000001",
  name: "Responses gateway",
  apiType: "openai_responses",
  baseURL: "https://gateway.example/v1",
  encryptedApiKey: "unused",
  structuredOutputs: false,
  maxOutputTokens: 16000,
  timeoutSeconds: 60,
  maxConcurrency: 3,
  model: "gateway-model",
  reasoningEffort: "default",
};
const paper = {
  name: "试卷",
  totalScore: null,
  sections: [
    {
      number: "一",
      title: "计算题",
      description: "",
      score: null,
      questions: [
        { number: 1, description: "1+1=?", materials: [], score: null, subquestions: [] },
      ],
    },
  ],
};
const taskId = "0199df02-1000-7000-8000-000000000001";
const otherTaskId = "0199df02-1000-7000-8000-000000000002";
const legacyTaskId = "20000000-0000-4000-8000-000000000001";

describe("Responses task session", () => {
  it.each(["generate", "generateJson"] as const)(
    "%s preserves the task identity after reconstructing the model and separates other tasks",
    async (method) => {
      const identities: string[] = [];
      const transport: typeof fetch = async (url, init) => {
        expect(String(url)).toBe(`${config.baseURL}/responses`);
        const headers = new Headers(init?.headers);
        expect(headers.get("authorization")).toBe("Bearer test-key");
        const body = JSON.parse(String(init?.body));
        expect(body.prompt_cache_key).toBe(headers.get("session-id"));
        identities.push(body.prompt_cache_key);
        return modelStreamResponse({
          id: `resp_${identities.length}`,
          model: config.model,
          output: [
            {
              type: "message",
              id: `msg_${identities.length}`,
              role: "assistant",
              content: [{ type: "output_text", text: JSON.stringify(paper) }],
            },
          ],
          usage: {
            input_tokens: 2000,
            output_tokens: 20,
            input_tokens_details: { cached_tokens: 0 },
          },
        });
      };
      for (const id of [taskId, taskId, otherTaskId, legacyTaskId, legacyTaskId]) {
        const model = createProviderExamModel(config, "test-key", transport, undefined, id);
        const request = {
          system: "Extract the paper.",
          content: [{ type: "text" as const, text: "paper" }],
        };
        await expect(
          method === "generate"
            ? model.generate(request)
            : model.generateJson({ ...request, schema: parsedExamSchema }),
        ).resolves.toEqual(paper);
      }
      expect(identities).toEqual([taskId, taskId, otherTaskId, legacyTaskId, legacyTaskId]);
    },
  );

  it("keeps one generated UUIDv7 across tool rounds and HTTP retries, and preserves zero cached usage", async () => {
    const identities: string[] = [];
    const record = vi.fn();
    let complete = false;
    const transport: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      const identity = new Headers(init?.headers).get("session-id");
      expect(body.prompt_cache_key).toBe(identity);
      expect(z.uuid().safeParse(identity).success).toBe(true);
      expect(uuidVersion(identity!)).toBe(7);
      expect(identity).toBe(identity!.toLowerCase());
      identities.push(identity!);
      if (identities.length === 1) return new Response("Unavailable", { status: 503 });
      const name = identities.length === 2 ? "inspect" : "finish";
      return modelStreamResponse({
        id: `resp_${identities.length}`,
        model: config.model,
        output: [
          {
            type: "function_call",
            id: `fc_${identities.length}`,
            call_id: `call_${identities.length}`,
            name,
            arguments: "{}",
          },
        ],
        usage: {
          input_tokens: 2000,
          output_tokens: 20,
          input_tokens_details: { cached_tokens: 0 },
        },
      });
    };
    await createProviderExamModel(config, "test-key", transport, {
      beforeCall: async () => {},
      record,
    }).run({
      system: "Inspect the paper and finish.",
      content: [{ type: "text", text: "paper" }],
      isComplete: () => complete,
      tools: {
        inspect: agentTool({
          description: "Inspect the paper.",
          inputSchema: z.strictObject({}),
          execute: async () => ({ inspected: true }),
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
    expect(identities).toHaveLength(3);
    expect(new Set(identities).size).toBe(1);
    expect(record).toHaveBeenCalledTimes(2);
    expect(record.mock.calls[1][1].inputTokenDetails.cacheReadTokens).toBe(0);
  }, 15000);
});
