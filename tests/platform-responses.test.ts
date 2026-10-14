import { describe, expect, it } from "vitest";
import type { ModelMessage } from "ai";
import {
  normalizeResponsesResponse,
  statelessResponsesMessages,
} from "@/server/platform/ai/responses";

describe("Responses stateless tool continuation", () => {
  it("normalizes only missing text annotations without hiding malformed data", async () => {
    const value = {
      output: [
        {
          type: "message",
          content: [
            { type: "output_text", text: "done" },
            {
              type: "output_text",
              text: "cite",
              annotations: [{ type: "url_citation", url: "https://example.test" }],
            },
          ],
        },
      ],
    };
    const response = await normalizeResponsesResponse(Response.json(value));
    const result = await response.json();
    expect(result.output[0].content[0].annotations).toEqual([]);
    expect(result.output[0].content[1].annotations).toEqual(value.output[0].content[1].annotations);
    const invalid = Response.json({ error: "bad" }, { status: 400 });
    expect(await normalizeResponsesResponse(invalid)).toBe(invalid);
  });
  it("drops unrecoverable reasoning IDs and preserves function calls and results", () => {
    const messages: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "reasoning",
            text: "summary",
            providerOptions: { openai: { itemId: "rs_unstored" } },
          },
          {
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "read_question",
            input: { questionId: "q" },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call_1",
            toolName: "read_question",
            output: { type: "json", value: { stem: "1+1" } },
          },
        ],
      },
    ];
    const prepared = statelessResponsesMessages(messages);
    expect(prepared[0]).toEqual({ role: "assistant", content: [messages[0].content[1]] });
    expect(prepared[1]).toBe(messages[1]);
    expect(messages[0].content).toHaveLength(2);
  });
  it("preserves encrypted reasoning state and ordinary text messages", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "question" },
      {
        role: "assistant",
        content: [
          {
            type: "reasoning",
            text: "",
            providerOptions: { openai: { itemId: "rs", reasoningEncryptedContent: "opaque" } },
          },
        ],
      },
    ];
    expect(statelessResponsesMessages(messages)).toEqual(messages);
  });
});
