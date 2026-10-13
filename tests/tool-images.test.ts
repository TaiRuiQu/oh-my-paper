import { describe, expect, it } from "vitest";
import type { ModelMessage } from "ai";
import { expandToolImages } from "@/server/ai/tool-images";

describe("chat tool image transport", () => {
  it("keeps tool IDs and textual results while moving image bytes into a user image part once", () => {
    const messages: ModelMessage[] = [
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "preview-call",
            toolName: "python",
            output: {
              type: "content",
              value: [
                { type: "text", text: '{"images":["agent/preview.jpg"]}' },
                { type: "file", mediaType: "image/jpeg", data: { type: "data", data: "YWJj" } },
              ],
            },
          },
        ],
      },
    ];
    const result = expandToolImages(messages);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      role: "tool",
      content: [
        { toolCallId: "preview-call", toolName: "python", output: { value: [{ type: "text" }] } },
      ],
    });
    expect(result[1]).toMatchObject({
      role: "user",
      content: [{ type: "text" }, { type: "file", mediaType: "image/jpeg", data: "YWJj" }],
    });
    expect(expandToolImages(result)).toEqual(result);
    expect(messages[0]).toMatchObject({
      content: [{ output: { value: [{ type: "text" }, { type: "file" }] } }],
    });
  });
  it("keeps all results of simultaneous tool calls together and preserves nonimage files", () => {
    const messages: ModelMessage[] = [
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "first",
            toolName: "read_pages",
            output: {
              type: "content",
              value: [
                { type: "file", mediaType: "image/jpeg", data: { type: "data", data: "YWJj" } },
              ],
            },
          },
          {
            type: "tool-result",
            toolCallId: "second",
            toolName: "append_answers",
            output: { type: "json", value: { questions: 1 } },
          },
          {
            type: "tool-result",
            toolCallId: "third",
            toolName: "download",
            output: {
              type: "content",
              value: [
                {
                  type: "file",
                  mediaType: "application/pdf",
                  data: { type: "data", data: "YWJj" },
                },
              ],
            },
          },
        ],
      },
    ];
    const result = expandToolImages(messages);
    expect(result[0]).toMatchObject({
      content: [
        { toolCallId: "first" },
        { toolCallId: "second", output: { value: { questions: 1 } } },
        { toolCallId: "third", output: { value: [{ mediaType: "application/pdf" }] } },
      ],
    });
    expect(result).toHaveLength(2);
  });
});
