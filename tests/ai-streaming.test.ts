import { afterEach, describe, expect, it, vi } from "vitest";
import { tool } from "ai";
import { z } from "zod";
import { createProviderExamModel } from "@/server/ai/providers";
import { modelStreamResponse, eventStream } from "./model-stream-response";

const config = {
  providerId: "30000000-0000-4000-8000-000000000001",
  name: "stream test",
  apiType: "openai_chat" as const,
  baseURL: "https://gateway.example/v1",
  encryptedApiKey: "unused",
  structuredOutputs: false,
  maxOutputTokens: 1024,
  timeoutSeconds: 60,
  maxConcurrency: 3,
  model: "test",
  reasoningEffort: "default" as const,
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function heldResponse(toolCall = false) {
  const fixture = modelStreamResponse({
    id: "completion_1",
    model: "test",
    created: 1,
    choices: [
      {
        index: 0,
        message: toolCall
          ? { tool_calls: [{ id: "call_1", function: { name: "save", arguments: "{}" } }] }
          : { content: '{"score":2}' },
        finish_reason: toolCall ? "tool_calls" : "stop",
      },
    ],
    usage: { prompt_tokens: 25, completion_tokens: 5 },
  });
  const frames = (await fixture.text()).split("\n\n").filter(Boolean);
  const finish = frames.findIndex((frame) => frame.includes('"finish_reason":"'));
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder();
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(streamController) {
        controller = streamController;
        controller.enqueue(encoder.encode(frames.slice(0, finish).join("\n\n") + "\n\n"));
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
  return {
    response,
    finish: () => {
      controller.enqueue(encoder.encode(frames.slice(finish).join("\n\n") + "\n\n"));
      controller.close();
    },
    text: (content: string) =>
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            id: "completion_1",
            model: "test",
            created: 1,
            object: "chat.completion.chunk",
            choices: [{ index: 0, delta: { content }, finish_reason: null }],
          })}\n\n`,
        ),
      ),
    fail: (error: Error) => controller.error(error),
  };
}

describe("streamed model requests", () => {
  it("waits for final usage and completion before settling and publishing JSON", async () => {
    const held = await heldResponse();
    let sent!: () => void;
    const requestSent = new Promise<void>((resolve) => {
      sent = resolve;
    });
    const record = vi.fn();
    const transport: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.stream).toBe(true);
      expect(body.stream_options).toEqual({ include_usage: true });
      sent();
      return held.response;
    };
    let settled = false;
    const result = createProviderExamModel(config, "test-key", transport, {
      beforeCall: async () => {},
      record,
    }).generateJson({
      system: "Grade",
      content: "answer",
      schema: z.object({ score: z.number() }),
    });
    void result.then(() => {
      settled = true;
    });
    await requestSent;
    expect(settled).toBe(false);
    expect(record).not.toHaveBeenCalled();
    held.finish();
    await expect(result).resolves.toEqual({ score: 2 });
    expect(record).toHaveBeenCalledOnce();
    expect(record.mock.calls[0][1]).toMatchObject({ inputTokens: 25, outputTokens: 5 });
  });
  it.each(["connection error", "abort"])(
    "propagates a mid-stream %s without executing pending tools",
    async (kind) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const held = await heldResponse(true);
      let output!: () => void;
      const firstOutput = new Promise<void>((resolve) => {
        output = resolve;
      });
      const execute = vi.fn();
      const record = vi.fn();
      const abort = new AbortController();
      const result = createProviderExamModel(config, "test-key", async () => held.response, {
        beforeCall: async () => {},
        record,
      }).run({
        system: "Save the result",
        content: "work",
        signal: abort.signal,
        isComplete: () => false,
        tools: { save: tool({ inputSchema: z.object({}), execute }) },
        onEvent: async (event) => {
          if (event.type === "message" && event.text === "模型开始流式输出。") output();
        },
      });
      const failure =
        kind === "abort"
          ? new DOMException("Test timeout", "TimeoutError")
          : new Error("connection reset while streaming");
      const rejected =
        kind === "abort"
          ? expect(result).rejects.toBe(failure)
          : expect(result).rejects.toMatchObject({ cause: failure });
      await firstOutput;
      if (kind === "abort") abort.abort(failure);
      else held.fail(failure);
      await rejected;
      expect(execute).not.toHaveBeenCalled();
      expect(record).not.toHaveBeenCalled();
    },
  );
  it("uses the Google streaming endpoint and consumes its final token usage", async () => {
    const transport: typeof fetch = async (input) => {
      expect(String(input)).toContain(":streamGenerateContent");
      expect(String(input)).toContain("alt=sse");
      return eventStream([
        { candidates: [{ content: { role: "model", parts: [{ text: '{"score":' }] }, index: 0 }] },
        {
          candidates: [
            { content: { role: "model", parts: [{ text: "2}" }] }, finishReason: "STOP", index: 0 },
          ],
          usageMetadata: { promptTokenCount: 25, candidatesTokenCount: 5, totalTokenCount: 30 },
        },
      ]);
    };
    const record = vi.fn();
    const model = createProviderExamModel({ ...config, apiType: "google" }, "test-key", transport, {
      beforeCall: async () => {},
      record,
    });
    await expect(
      model.generateJson({
        system: "Grade",
        content: "answer",
        schema: z.object({ score: z.number() }),
      }),
    ).resolves.toEqual({ score: 2 });
    expect(record.mock.calls[0][1]).toMatchObject({ inputTokens: 25, outputTokens: 5 });
  });
  it.each(["length", null])(
    "rejects valid partial JSON when the stream ends with %s instead of a complete response",
    async (finishReason) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const record = vi.fn();
      const model = createProviderExamModel(
        config,
        "test-key",
        async () =>
          eventStream(
            [
              {
                choices: [{ index: 0, delta: { content: '{"score":2}' }, finish_reason: null }],
              },
              ...(finishReason
                ? [{ choices: [{ index: 0, delta: {}, finish_reason: finishReason }] }]
                : []),
              { choices: [], usage: { prompt_tokens: 25, completion_tokens: 5 } },
            ],
            true,
          ),
        { beforeCall: async () => {}, record },
      );
      await expect(
        model.generateJson({
          system: "Grade",
          content: "answer",
          schema: z.object({ score: z.number() }),
        }),
      ).rejects.toMatchObject(
        finishReason ? { code: "AI_OUTPUT_INCOMPLETE" } : { name: "AI_InvalidResponseDataError" },
      );
      expect(record).toHaveBeenCalledTimes(finishReason ? 1 : 0);
    },
  );
  it("stops tool execution when streamed usage settlement fails", async () => {
    const failure = new Error("settlement failed");
    const execute = vi.fn();
    const held = await heldResponse(true);
    held.finish();
    const model = createProviderExamModel(config, "test-key", async () => held.response, {
      beforeCall: async () => {},
      record: async () => {
        throw failure;
      },
    });
    await expect(
      model.run({
        system: "Save",
        content: "work",
        isComplete: () => false,
        tools: { save: tool({ inputSchema: z.object({}), execute }) },
      }),
    ).rejects.toBe(failure);
    expect(execute).not.toHaveBeenCalled();
  });
  it("allows a continuously producing stream to exceed the provider's timeout duration", async () => {
    vi.useFakeTimers();
    const held = await heldResponse();
    let sent!: () => void;
    const requestSent = new Promise<void>((resolve) => {
      sent = resolve;
    });
    const model = createProviderExamModel(
      { ...config, timeoutSeconds: 1 },
      "test-key",
      async () => {
        sent();
        return held.response;
      },
    );
    const result = model.generateJson({
      system: "Grade",
      content: "answer",
      schema: z.object({ score: z.number() }),
    });
    const outcome = result.then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    await requestSent;
    for (let index = 0; index < 3; index++) {
      await vi.advanceTimersByTimeAsync(600);
      held.text(" ");
    }
    held.finish();
    expect(await outcome).toEqual({ value: { score: 2 } });
  });
  it("aborts a stream that stops producing output", async () => {
    vi.useFakeTimers();
    const held = await heldResponse();
    let sent!: () => void;
    const requestSent = new Promise<void>((resolve) => {
      sent = resolve;
    });
    const model = createProviderExamModel(
      { ...config, timeoutSeconds: 1 },
      "test-key",
      async () => {
        sent();
        return held.response;
      },
    );
    const result = model.generateJson({
      system: "Grade",
      content: "answer",
      schema: z.object({ score: z.number() }),
    });
    const rejected = expect(result).rejects.toMatchObject({
      name: "TimeoutError",
      message: expect.stringContaining("Chunk timeout"),
    });
    await requestSent;
    await vi.advanceTimersByTimeAsync(1100);
    await rejected;
  });
  it("bounds waiting for response headers separately from stream output", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    let sent!: () => void;
    const requestSent = new Promise<void>((resolve) => {
      sent = resolve;
    });
    const transport: typeof fetch = async (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
        sent();
      });
    const model = createProviderExamModel({ ...config, timeoutSeconds: 1 }, "test-key", transport);
    const result = model.generateJson({
      system: "Grade",
      content: "answer",
      schema: z.object({ score: z.number() }),
    });
    const rejected = expect(result).rejects.toMatchObject({
      name: "TimeoutError",
      message: "等待 AI 接口响应头超时。",
    });
    await requestSent;
    await vi.advanceTimersByTimeAsync(1100);
    await rejected;
  });
  it("times out waiting for first output even if the server sends SSE heartbeats", async () => {
    vi.useFakeTimers();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(value) {
          controller = value;
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );
    let sent!: () => void;
    const requestSent = new Promise<void>((resolve) => {
      sent = resolve;
    });
    const model = createProviderExamModel(
      { ...config, timeoutSeconds: 1 },
      "test-key",
      async () => {
        sent();
        return response;
      },
    );
    const rejected = expect(
      model.generateJson({
        system: "Grade",
        content: "answer",
        schema: z.object({ score: z.number() }),
      }),
    ).rejects.toMatchObject({
      name: "TimeoutError",
      message: expect.stringContaining("First chunk timeout"),
    });
    await requestSent;
    await vi.advanceTimersByTimeAsync(600);
    controller.enqueue(new TextEncoder().encode(": heartbeat\n\n"));
    await vi.advanceTimersByTimeAsync(500);
    await rejected;
  });
});
