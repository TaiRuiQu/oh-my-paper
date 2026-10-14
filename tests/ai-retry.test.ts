import { afterEach, describe, expect, it, vi } from "vitest";
import { tool } from "ai";
import { z } from "zod";
import { AppError } from "@/server/errors";
import { isTransientAiError, retryAiRequest } from "@/server/ai/retry";
import { createProviderExamModel } from "@/server/ai/providers";
import { modelStreamResponse } from "./model-stream-response";
const config = {
  providerId: "40000000-0000-4000-8000-000000000001",
  name: "retry test",
  apiType: "openai_chat" as const,
  baseURL: "https://gateway.example/v1",
  encryptedApiKey: "unused",
  structuredOutputs: false,
  maxOutputTokens: 1024,
  timeoutSeconds: 1,
  maxConcurrency: 3,
  model: "test",
  reasoningEffort: "default" as const,
};
const request = { system: "Grade", content: "answer", schema: z.object({ score: z.number() }) };
function success(toolName?: string) {
  return modelStreamResponse({
    id: "completion",
    model: "test",
    created: 1,
    choices: [
      {
        index: 0,
        message: toolName
          ? {
              tool_calls: [
                { id: `call-${toolName}`, function: { name: toolName, arguments: "{}" } },
              ],
            }
          : { content: '{"score":2}' },
        finish_reason: toolName ? "tool_calls" : "stop",
      },
    ],
    usage: { prompt_tokens: 20, completion_tokens: 5 },
  });
}
function brokenStream() {
  let sent = false;
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (!sent) {
          sent = true;
          controller.enqueue(
            new TextEncoder().encode(
              'data: {"id":"broken","model":"test","created":1,"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"unsafe-attempt","type":"function","function":{"name":"finish","arguments":"{}"}}]},"finish_reason":null}]}\n\n',
            ),
          );
        } else controller.error(new Error("connection reset while streaming"));
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe("bounded AI request recovery", () => {
  it("retries transient HTTP errors with backoff and provider Retry-After", async () => {
    vi.useFakeTimers();
    const times: number[] = [];
    const meter = { beforeCall: vi.fn(), record: vi.fn() };
    const model = createProviderExamModel(
      config,
      "test",
      async () => {
        times.push(Date.now());
        return times.length < 3
          ? Response.json(
              { error: { message: "busy" } },
              {
                status: times.length === 1 ? 503 : 429,
                headers: times.length === 2 ? { "retry-after": "3" } : {},
              },
            )
          : success();
      },
      meter,
    );
    const outcome = model.generateJson(request);
    await vi.runAllTimersAsync();
    await expect(outcome).resolves.toEqual({ score: 2 });
    expect(times[1] - times[0]).toBe(1000);
    expect(times[2] - times[1]).toBe(3000);
    expect(meter.record).toHaveBeenCalledOnce();
  });
  it.each([400, 401, 403, 422])("fails HTTP %s immediately", async (status) => {
    const transport = vi.fn(async () =>
      Response.json({ error: { message: "invalid" } }, { status }),
    );
    await expect(
      createProviderExamModel(config, "test", transport).generateJson(request),
    ).rejects.toThrow();
    expect(transport).toHaveBeenCalledOnce();
  });
  it("keeps successful Agent steps and executes pending tools only after a recovered stream", async () => {
    vi.useFakeTimers();
    const first = vi.fn(async () => "saved"),
      finish = vi.fn(async () => {
        complete = true;
        return "done";
      });
    let complete = false;
    const messages: unknown[] = [];
    const events: string[] = [];
    const model = createProviderExamModel(config, "test", async (_url, init) => {
      messages.push(JSON.parse(String(init?.body)).messages);
      return messages.length === 1
        ? success("first")
        : messages.length === 2
          ? brokenStream()
          : success("finish");
    });
    const result = model.run({
      system: "Save",
      content: "work",
      isComplete: () => complete,
      tools: {
        first: tool({ inputSchema: z.object({}), execute: first }),
        finish: tool({ inputSchema: z.object({}), execute: finish }),
      },
      onEvent: async (event) => {
        if (event.text) events.push(event.text);
      },
    });
    const resolved = expect(result).resolves.toBeUndefined();
    await vi.runAllTimersAsync();
    await resolved;
    expect(messages).toHaveLength(3);
    expect(messages[1]).toEqual(messages[2]);
    expect(JSON.stringify(messages[2])).toContain("saved");
    expect(first).toHaveBeenCalledOnce();
    expect(finish).toHaveBeenCalledOnce();
    expect(events.some((e) => e.includes("自动重试"))).toBe(true);
  });
  it("recovers an idle stream with a new request and settles usage once", async () => {
    vi.useFakeTimers();
    const meter = { beforeCall: vi.fn(), record: vi.fn() };
    let calls = 0;
    const model = createProviderExamModel(
      config,
      "test",
      async () => {
        calls++;
        return calls === 1
          ? new Response(new ReadableStream(), { headers: { "content-type": "text/event-stream" } })
          : success();
      },
      meter,
    );
    const result = model.generateJson(request);
    await vi.runAllTimersAsync();
    await expect(result).resolves.toEqual({ score: 2 });
    expect(calls).toBe(2);
    expect(meter.record).toHaveBeenCalledOnce();
  });
  it("stops retrying when cancelled during backoff and retains the cancellation reason", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const failure = new DOMException("cancelled", "AbortError");
    const operation = vi.fn(async () => {
      throw new Error("connection reset");
    });
    const rejected = expect(retryAiRequest(operation, controller.signal)).rejects.toBe(failure);
    await vi.advanceTimersByTimeAsync(10);
    controller.abort(failure);
    await rejected;
    await vi.runAllTimersAsync();
    expect(operation).toHaveBeenCalledOnce();
    expect(isTransientAiError(new AppError("settlement failed", "CREDIT_SETTLEMENT_FAILED"))).toBe(
      false,
    );
  });
});
