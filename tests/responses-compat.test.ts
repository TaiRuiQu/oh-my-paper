import { eventStream, modelStreamResponse } from "./model-stream-response";
import { describe, expect, it, vi } from "vitest";
import { APICallError, tool, type ModelMessage } from "ai";
import { z } from "zod";
import {
  normalizeResponseAnnotations,
  compatibleResponsesResponse,
  prepareResponsesMessages,
} from "@/server/ai/responses-compat";
import { createProviderExamModel } from "@/server/ai/providers";
import { describeError } from "@/server/logger";

type ResponsesRequest = {
  store: boolean;
  stream: boolean;
  input: {
    type?: string;
    id?: string;
    role?: string;
    call_id?: string;
    name?: string;
    output?: string;
    encrypted_content?: string;
  }[];
  reasoning?: { effort: string };
  include?: string[];
  tools?: unknown[];
};

describe("Responses gateway compatibility", () => {
  it("normalizes split UTF-8 and multiline CRLF events before the upstream stream closes", async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const cancel = vi.fn();
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(value) {
          controller = value;
        },
        cancel,
      }),
      {
        headers: {
          "content-type": "text/plain",
          "content-length": "999",
          "content-encoding": "gzip",
        },
      },
    );
    const normalized = await compatibleResponsesResponse(response, true);
    expect(normalized.headers.has("content-length")).toBe(false);
    expect(normalized.headers.has("content-encoding")).toBe(false);
    const reader = normalized.body!.getReader();
    const text =
      ': heartbeat\r\n\r\nid: 11\r\nevent: response.output_item.added\r\ndata: {"type":"response.output_item.added",\r\ndata: "output_index":1,"item":{"type":"function_call","name":"题目","argumentsIgnored":"keep"}}\r\n\r\n';
    for (const byte of new TextEncoder().encode(text)) controller.enqueue(Uint8Array.of(byte));
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(": heartbeat\r\n\r\n");
    const frame = new TextDecoder().decode((await reader.read()).value);
    expect(frame).toContain("id: 11\nevent: response.output_item.added\n");
    const event = JSON.parse(
      frame
        .split("\n")
        .find((line) => line.startsWith("data:"))!
        .slice(5),
    );
    expect(event.item).toEqual({
      type: "function_call",
      name: "题目",
      argumentsIgnored: "keep",
      arguments: "",
    });
    await reader.cancel();
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
  });
  it("preserves completed arguments, invalid start arguments, unknown events and invalid JSON", async () => {
    const wire =
      [
        {
          type: "response.output_item.added",
          item: { type: "function_call", arguments: '{"q":1}' },
        },
        { type: "response.output_item.added", item: { type: "function_call", arguments: 42 } },
        { type: "response.output_item.done", item: { type: "function_call" } },
        { type: "future.event", item: { type: "function_call" } },
      ]
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join("") + "data: invalid\n\ndata: [DONE]\n\n";
    expect(await (await compatibleResponsesResponse(new Response(wire), true)).text()).toBe(wire);
  });
  it("propagates an upstream Responses stream error", async () => {
    const failure = new Error("connection reset");
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.error(failure);
        },
      }),
    );
    await expect((await compatibleResponsesResponse(response, true)).text()).rejects.toBe(failure);
  });
  it("accepts the gateway's omitted initial tool arguments through the real SDK", async () => {
    const execute = vi.fn(async (input: { label: string }) => ({
      complete: true,
      label: input.label,
    }));
    const record = vi.fn();
    const model = createProviderExamModel(
      {
        providerId: "20000000-0000-4000-8000-000000000001",
        name: "Responses gateway",
        apiType: "openai_responses",
        baseURL: "https://gateway.example/v1",
        encryptedApiKey: "unused",
        structuredOutputs: false,
        maxOutputTokens: 1024,
        timeoutSeconds: 60,
        maxConcurrency: 3,
        model: "test",
        reasoningEffort: "default",
      },
      "test-key",
      async () =>
        eventStream([
          {
            type: "response.output_item.added",
            output_index: 1,
            item: {
              call_id: "call_00_joiuti4vv9n4pzu9tvb3wbg5",
              name: "list_questions",
              type: "function_call",
              id: "ace5a4e8-14b6-34d7-b58f-e1754a9fbb79",
              status: "in_progress",
            },
            sequence_number: 11,
          },
          {
            type: "response.function_call_arguments.delta",
            output_index: 1,
            item_id: "ace5a4e8-14b6-34d7-b58f-e1754a9fbb79",
            delta: '{"label":"题目"}',
          },
          {
            type: "response.output_item.done",
            output_index: 1,
            item: {
              call_id: "call_00_joiuti4vv9n4pzu9tvb3wbg5",
              name: "list_questions",
              type: "function_call",
              id: "ace5a4e8-14b6-34d7-b58f-e1754a9fbb79",
              status: "completed",
              arguments: '{"label":"题目"}',
            },
          },
          {
            type: "response.completed",
            response: { usage: { input_tokens: 20, output_tokens: 30 } },
          },
        ]),
      { beforeCall: async () => {}, record },
    );
    await model.run({
      system: "List questions",
      content: "work",
      isComplete: () => execute.mock.calls.length > 0,
      tools: { list_questions: tool({ inputSchema: z.object({ label: z.string() }), execute }) },
    });
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0][0]).toEqual({ label: "题目" });
    expect(record).toHaveBeenCalledOnce();
    expect(record.mock.calls[0][1]).toMatchObject({ inputTokens: 20, outputTokens: 30 });
  });
  it("retains encrypted reasoning sequences and tool context without mutating message history", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "Solve the question" },
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "unsupported summary" },
          {
            type: "reasoning",
            text: "first summary",
            providerOptions: { openai: { itemId: "rs_1", reasoningEncryptedContent: null } },
          },
          {
            type: "reasoning",
            text: "last summary",
            providerOptions: { openai: { itemId: "rs_1", reasoningEncryptedContent: "opaque" } },
          },
          {
            type: "reasoning",
            text: "no item id",
            providerOptions: { openai: { reasoningEncryptedContent: "opaque_2" } },
          },
          { type: "text", text: "Read the question" },
          { type: "tool-call", toolName: "read_question", toolCallId: "call_1", input: {} },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolName: "read_question",
            toolCallId: "call_1",
            output: { type: "text", value: "1+1=?" },
          },
        ],
      },
      { role: "assistant", content: [{ type: "reasoning", text: "not recoverable" }] },
    ];
    const original = structuredClone(messages);
    const prepared = prepareResponsesMessages(messages);
    expect(prepared).toHaveLength(3);
    expect(prepared[1]).toEqual({
      ...messages[1],
      content: original[1].role === "assistant" && original[1].content.slice(1),
    });
    expect(prepared[2]).toBe(messages[2]);
    expect(messages).toEqual(original);
    expect(prepareResponsesMessages(prepared)).toEqual(prepared);
  });
  it("replays encrypted state with store=true without losing summary parts or mutating history", () => {
    const messages: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "reasoning",
            text: "first",
            providerOptions: { openai: { itemId: "rs_1", reasoningEncryptedContent: null } },
          },
          {
            type: "reasoning",
            text: "last",
            providerOptions: {
              openai: { itemId: "rs_1", reasoningEncryptedContent: "opaque-state" },
            },
          },
          {
            type: "reasoning",
            text: "without ID",
            providerOptions: { openai: { reasoningEncryptedContent: "another-opaque-state" } },
          },
          {
            type: "reasoning",
            text: "stored only",
            providerOptions: { openai: { itemId: "rs_2" } },
          },
          { type: "reasoning", text: "not recoverable" },
          { type: "text", text: "Continue" },
        ],
      },
    ];
    const original = structuredClone(messages);
    const prepared = prepareResponsesMessages(messages, { store: true });
    expect(prepared[0].content).toEqual([
      {
        type: "reasoning",
        text: "first\nlast",
        providerOptions: { openai: { reasoningEncryptedContent: "opaque-state" } },
      },
      original[0].content[2],
      original[0].content[3],
      original[0].content[5],
    ]);
    expect(messages).toEqual(original);
    expect(prepareResponsesMessages(prepared, { store: true })).toEqual(prepared);
  });
  it.each([
    { effort: "default" as const, encrypted: "opaque-state" },
    { effort: "default" as const, encrypted: null },
    { effort: "low" as const, encrypted: null },
    { effort: "low" as const, encrypted: "opaque-state" },
  ])(
    "preserves request prefixes and stored reasoning across three SDK rounds for $effort / $encrypted",
    async ({ effort, encrypted }) => {
      const requests: ResponsesRequest[] = [];
      const transport: typeof fetch = async (_url, init) => {
        requests.push(JSON.parse(String(init?.body)));
        const step = requests.length;
        // Some gateways return encrypted state even with storage enabled and
        // require that opaque state rather than a stored reasoning reference.
        if (step > 1 && encrypted) {
          expect(requests.at(-1)!.input).toContainEqual(
            expect.objectContaining({ type: "reasoning", encrypted_content: encrypted }),
          );
          expect(requests.at(-1)!.input).not.toContainEqual({
            type: "item_reference",
            id: "rs_1",
          });
        }
        return modelStreamResponse({
          id: `resp_${step}`,
          model: "deepseek/deepseek-v4.1-flash",
          created_at: 1,
          status: "completed",
          output: [
            {
              type: "reasoning",
              id: `rs_${step}`,
              summary: [
                { type: "summary_text", text: "Inspect the question" },
                { type: "summary_text", text: "Solve the question" },
              ],
              encrypted_content: encrypted,
            },
            {
              type: "message",
              id: `msg_${step}`,
              content: [{ type: "output_text", text: "Inspecting the next question." }],
            },
            {
              type: "function_call",
              id: `fc_${step}`,
              call_id: `call_${step}`,
              name: step < 3 ? "read_question" : "submit_answer",
              arguments: JSON.stringify(step < 3 ? { id: "q_1" } : { answer: "2" }),
            },
          ],
          usage: { input_tokens: 20, output_tokens: 30 },
        });
      };
      let complete = false;
      const warningLogger = vi.fn();
      const previousLogger = globalThis.AI_SDK_LOG_WARNINGS;
      globalThis.AI_SDK_LOG_WARNINGS = warningLogger;
      try {
        await createProviderExamModel(
          {
            providerId: "20000000-0000-4000-8000-000000000001",
            name: "Responses gateway",
            apiType: "openai_responses",
            baseURL: "https://gateway.example/v1",
            encryptedApiKey: "unused",
            structuredOutputs: false,
            maxOutputTokens: 1024,
            timeoutSeconds: 60,
            maxConcurrency: 3,
            model: "deepseek/deepseek-v4.1-flash",
            reasoningEffort: effort,
          },
          "test-key",
          transport,
        ).run({
          system: "Read the question and submit its answer",
          content: [{ type: "text", text: "Please solve q_1" }],
          isComplete: () => complete,
          tools: {
            read_question: tool({
              inputSchema: z.object({ id: z.string() }),
              execute: async () => ({ description: "1+1=?" }),
            }),
            submit_answer: tool({
              inputSchema: z.object({ answer: z.string() }),
              execute: async ({ answer }) => {
                expect(answer).toBe("2");
                complete = true;
                return { complete: true };
              },
            }),
          },
        });
        expect(complete).toBe(true);
        expect(requests).toHaveLength(3);
        expect(warningLogger).not.toHaveBeenCalled();
        for (const body of requests) {
          expect(body.store).toBe(true);
          expect(body.stream).toBe(true);
          expect(body.input[0].role).toBe("system");
          if (effort === "default") expect(body.reasoning).toBeUndefined();
          else {
            expect(body.reasoning).toEqual({ effort });
            expect(body.include ?? []).not.toContain("reasoning.encrypted_content");
          }
        }
        for (let index = 1; index < requests.length; index++) {
          const previous = requests[index - 1];
          expect(requests[index].input.slice(0, previous.input.length)).toEqual(previous.input);
          expect(requests[index].tools).toEqual(previous.tools);
        }
        const replay = requests[1].input;
        expect(replay.find((item) => item.type === "function_call")).toMatchObject({
          call_id: "call_1",
          name: "read_question",
        });
        expect(replay.find((item) => item.type === "function_call_output")).toMatchObject({
          call_id: "call_1",
          output: JSON.stringify({ description: "1+1=?" }),
        });
        if (encrypted) {
          expect(replay.find((item) => item.type === "reasoning")).toMatchObject({
            encrypted_content: encrypted,
          });
        } else {
          expect(replay).toContainEqual({ type: "item_reference", id: "rs_1" });
        }
        expect(replay).toContainEqual({ type: "item_reference", id: "msg_1" });
      } finally {
        globalThis.AI_SDK_LOG_WARNINGS = previousLogger;
      }
    },
  );
  it("fills missing or null annotations and preserves real citations, reasoning and tools", () => {
    const citation = {
      type: "url_citation",
      url: "https://example.com",
      title: "source",
      start_index: 0,
      end_index: 1,
    };
    const value = {
      output: [
        { type: "reasoning", summary: [] },
        {
          type: "message",
          content: [
            { type: "output_text", text: "one" },
            { type: "output_text", text: "two", annotations: null },
            { type: "output_text", text: "three", annotations: [citation] },
          ],
        },
        { type: "function_call", arguments: "{}" },
      ],
    };
    expect(normalizeResponseAnnotations(value)).toBe(true);
    expect(value.output[1].content?.map((p) => p.annotations)).toEqual([[], [], [citation]]);
    expect(normalizeResponseAnnotations(value)).toBe(false);
    const malformed = {
      output: [{ type: "message", content: [{ type: "output_text", annotations: "wrong" }] }],
    };
    expect(normalizeResponseAnnotations(malformed)).toBe(false);
  });
  it("leaves errors, streaming responses and invalid JSON readable", async () => {
    const error = new Response("bad gateway", { status: 502 });
    expect(await compatibleResponsesResponse(error)).toBe(error);
    const stream = new Response("data: {}\n\n", {
      headers: { "content-type": "text/event-stream" },
    });
    expect(await (await compatibleResponsesResponse(stream)).text()).toBe("data: {}\n\n");
    const mislabeled = new Response("data: {}\n\n", { headers: { "content-type": "text/plain" } });
    const compatible = await compatibleResponsesResponse(mislabeled, true);
    expect(compatible.headers.get("content-type")).toBe("text/plain");
    expect(await compatible.text()).toBe("data: {}\n\n");
    expect(await (await compatibleResponsesResponse(new Response("invalid"))).text()).toBe(
      "invalid",
    );
  });
  it("accepts an Ark-style response with reasoning followed by text lacking annotations through the real SDK", async () => {
    const paper = {
      name: "试卷",
      totalScore: 2,
      sections: [
        {
          number: "一",
          title: "计算题",
          description: "",
          score: 2,
          questions: [
            { number: 1, description: "1+1=?", materials: [], score: 2, subquestions: [] },
          ],
        },
      ],
    };
    const transport: typeof fetch = async () =>
      modelStreamResponse({
        id: "resp_1",
        model: "glm-5.3-flash",
        created_at: 1,
        status: "completed",
        output: [
          { type: "reasoning", id: "rs_1", summary: [] },
          {
            type: "message",
            id: "msg_1",
            role: "assistant",
            content: [{ type: "output_text", text: JSON.stringify(paper) }],
          },
        ],
        usage: { input_tokens: 20, output_tokens: 30 },
      });
    const model = createProviderExamModel(
      {
        providerId: "10000000-0000-4000-8000-000000000001",
        name: "Ark",
        apiType: "openai_responses",
        baseURL: "https://ark.cn-beijing.volces.com/api/plan/v3",
        encryptedApiKey: "unused",
        structuredOutputs: false,
        maxOutputTokens: 1024,
        timeoutSeconds: 60,
        maxConcurrency: 3,
        model: "glm-5.3-flash",
        reasoningEffort: "default",
      },
      "test-key",
      transport,
    );
    await expect(
      model.generate({ system: "Extract paper", content: [{ type: "text", text: "paper" }] }),
    ).resolves.toEqual(paper);
  });
  it("reports a successful HTTP response with invalid fields as a compatibility error", () => {
    const parsed = z
      .object({ output: z.array(z.object({ annotations: z.array(z.string()) })) })
      .safeParse({ output: [{}] });
    if (parsed.success) throw new Error("invalid fixture");
    const error = new APICallError({
      message: "Invalid JSON response",
      url: "https://example.com",
      requestBodyValues: {},
      statusCode: 200,
      cause: parsed.error,
    });
    expect(describeError(error)).toMatchObject({
      code: "AI_RESPONSE_INVALID",
      message: expect.stringContaining("output.0.annotations"),
    });
  });
});
