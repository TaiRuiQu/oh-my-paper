import { describe, expect, it } from "vitest";
import { tool } from "ai";
import { z } from "zod";
import { createProviderExamModel } from "@/server/ai/providers";
import { providerSchema } from "@/contracts/ai-providers";
import type { AgentEventInput } from "@/contracts/recognition";

function response(name: string, index: number) {
  const item = {
    type: "function_call",
    id: `fc_${index}`,
    call_id: `call_${index}`,
    name,
    arguments: "{}",
    status: "completed",
  };
  return Response.json({
    id: `resp_${index}`,
    object: "response",
    created_at: 1,
    model: "fixture",
    status: "completed",
    output: [item],
    usage: { input_tokens: 10, output_tokens: 5, input_tokens_details: { cached_tokens: 2 } },
  });
}
const config = providerSchema.parse({
  name: "Recognition SDK",
  apiType: "openai_responses",
  baseURL: "https://fixture.test/v1",
  model: "fixture",
});
describe("recognition SDK transport", () => {
  it("runs a real SDK loop, records actual tool results, and feeds them to the next model call", async () => {
    const bodies: Record<string, unknown>[] = [],
      events: AgentEventInput[] = [];
    let complete = false;
    const fetch: typeof globalThis.fetch = async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return response(bodies.length === 1 ? "inspect" : "finish", bodies.length);
    };
    const model = createProviderExamModel(config, "fixture-key", fetch);
    const usage = await model.runRecognitionAgent!({
      instructions: "Recognize using tools.",
      content: "Paper",
      isComplete: () => complete,
      onEvent: async (e) => {
        events.push(e);
      },
      tools: {
        inspect: tool({
          inputSchema: z.object({}),
          execute: () => ({ markdown: "$x^2$", images: [] }),
        }),
        finish: tool({
          inputSchema: z.object({}),
          execute: () => {
            complete = true;
            return { accepted: true };
          },
        }),
      },
    });
    expect(usage).toMatchObject({
      calls: 2,
      inputTokens: 20,
      outputTokens: 10,
      cachedInputTokens: 4,
    });
    expect(bodies.every((b) => b.stream !== true && b.tool_choice === "required")).toBe(true);
    expect(JSON.stringify(bodies[1].input)).toContain("$x^2$");
    expect(events.filter((e) => e.type === "tool_result").map((e) => e.data)).toEqual([
      { markdown: "$x^2$", images: [] },
      { accepted: true },
    ]);
  });
  it("caps unfinished loops and retains usage instead of reporting success", async () => {
    let calls = 0;
    const model = createProviderExamModel(config, "fixture-key", async () =>
      response("inspect", ++calls),
    );
    await expect(
      model.runRecognitionAgent!({
        instructions: "Recognize.",
        content: "Paper",
        isComplete: () => false,
        maxSteps: 2,
        onEvent: async () => {},
        tools: {
          inspect: tool({ inputSchema: z.object({}), execute: () => ({ inspected: true }) }),
        },
      }),
    ).rejects.toMatchObject({ name: "ExamModelCallError", usage: { calls: 2 } });
    expect(calls).toBe(2);
  });
  it("expires old image payloads while preserving tool results and allowing rereads", async () => {
    const bodies: Record<string, unknown>[] = [];
    let complete = false;
    const model = createProviderExamModel(config, "fixture-key", async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return response(bodies.length <= 5 ? "inspect" : "finish", bodies.length);
    });
    await model.runRecognitionAgent!({
      instructions: "Recognize.",
      content: "Paper",
      isComplete: () => complete,
      onEvent: async () => {},
      tools: {
        inspect: tool({
          inputSchema: z.object({}),
          execute: () => ({ page: 1 }),
          toModelOutput: () => ({
            type: "content",
            value: [
              { type: "text", text: "PAGE_METADATA" },
              { type: "file", mediaType: "image/jpeg", data: { type: "data", data: "aW1hZ2U=" } },
            ],
          }),
        }),
        save: tool({ inputSchema: z.object({}), execute: () => ({ saved: true }) }),
        finish: tool({
          inputSchema: z.object({}),
          execute: () => {
            complete = true;
            return { accepted: true };
          },
        }),
      },
    });
    expect(JSON.stringify(bodies[1].input)).toContain("aW1hZ2U=");
    expect(JSON.stringify(bodies[5].input).match(/aW1hZ2U=/g)).toHaveLength(4);
    expect(JSON.stringify(bodies[5].input)).toContain("PAGE_METADATA");
    expect(JSON.stringify(bodies[5].input)).toContain("expired from active context");
  });
  it("resumes a retryable provider failure from completed tools without executing them twice", async () => {
    let calls = 0,
      inspected = 0,
      complete = false;
    const events: AgentEventInput[] = [],
      bodies: Record<string, unknown>[] = [];
    const model = createProviderExamModel(config, "fixture-key", async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      calls++;
      if (calls > 1 && calls < 5)
        return Response.json(
          { error: { message: "Service unavailable", type: "server_error" } },
          { status: 503 },
        );
      return response(calls === 1 ? "inspect" : "finish", calls);
    });
    const usage = await model.runRecognitionAgent!({
      instructions: "Recognize.",
      content: "Paper",
      isComplete: () => complete,
      onEvent: async (e) => {
        events.push(e);
      },
      tools: {
        inspect: tool({
          inputSchema: z.object({}),
          execute: () => {
            inspected++;
            return { savedEvidence: "preserved" };
          },
        }),
        finish: tool({
          inputSchema: z.object({}),
          execute: () => {
            complete = true;
            return { accepted: true };
          },
        }),
      },
    });
    expect(inspected).toBe(1);
    expect(calls).toBe(5);
    expect(usage.calls).toBe(3);
    expect(JSON.stringify(bodies[4].input)).toContain("preserved");
    expect(events.some((e) => e.type === "message" && e.text?.includes("继续"))).toBe(true);
  }, 15000);
});
