import { describe, expect, it } from "vitest";
import { createOpenAI } from "@ai-sdk/openai";
import { ToolLoopAgent, isStepCount, tool } from "ai";
import { z } from "zod";
import { normalizeResponsesResponse, prepareResponsesStep } from "@/server/platform/ai/responses";

describe("Responses stored tool continuation", () => {
  it("reports missing server response IDs instead of replaying the entire history", () => {
    expect(() =>
      prepareResponsesStep({
        steps: [
          {
            providerMetadata: undefined,
            response: {
              id: "client-generated-id",
              timestamp: new Date(),
              modelId: "test-model",
              messages: [],
            },
          },
        ],
      }),
    ).toThrow(/未返回响应 ID/);
  });

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
  it.each([true, false])(
    "chains real provider requests with usePreviousResponseId=%s",
    async (usePreviousResponseId) => {
      const requests: {
        store: boolean;
        previous_response_id?: string;
        input: { type?: string; role?: string; call_id?: string }[];
        tools: unknown[];
      }[] = [];
      const model = createOpenAI({
        apiKey: "test-key",
        fetch: async (_url, init) => {
          requests.push(JSON.parse(String(init?.body)));
          const index = requests.length;
          return Response.json({
            id: `resp_${index}`,
            output:
              index < 3
                ? [
                    {
                      type: "function_call",
                      id: `fc_${index}`,
                      call_id: `call_${index}`,
                      name: "inspect",
                      arguments: JSON.stringify({ page: index }),
                    },
                  ]
                : [
                    {
                      type: "message",
                      id: "msg_3",
                      role: "assistant",
                      content: [{ type: "output_text", text: "done", annotations: [] }],
                    },
                  ],
            usage: { input_tokens: 10, output_tokens: 10 },
          });
        },
      }).responses("test-model");
      const agent = new ToolLoopAgent({
        model,
        instructions: "Keep these instructions on every request.",
        providerOptions: { openai: { store: true, parallelToolCalls: true } },
        prepareStep: usePreviousResponseId ? prepareResponsesStep : undefined,
        tools: {
          inspect: tool({
            inputSchema: z.object({ page: z.number() }),
            execute: async ({ page }) => ({ page }),
            toModelOutput: ({ output }) => ({
              type: "content",
              value: [
                { type: "text", text: `page ${output.page}` },
                {
                  type: "file",
                  mediaType: "image/jpeg",
                  data: {
                    type: "data",
                    data: Buffer.from(`image-page-${output.page}`).toString("base64"),
                  },
                },
              ],
            }),
          }),
        },
        stopWhen: isStepCount(3),
      });
      expect((await agent.generate({ prompt: "Initial task context" })).text).toBe("done");
      expect(requests).toHaveLength(3);
      expect(requests[0].previous_response_id).toBeUndefined();
      expect(JSON.stringify(requests[0])).toContain("Initial task context");
      for (const [index, request] of requests.entries()) {
        expect(request.store).toBe(true);
        expect(request.tools).toHaveLength(1);
        expect(JSON.stringify(request)).toContain("Keep these instructions on every request.");
        if (!index) continue;
        if (!usePreviousResponseId) {
          expect(request.previous_response_id).toBeUndefined();
          expect(request.input.some((item) => item.type === "item_reference")).toBe(false);
          expect(JSON.stringify(request)).toContain("Initial task context");
          for (let page = 1; page <= index; page++) {
            expect(request.input).toContainEqual(
              expect.objectContaining({ type: "function_call", call_id: `call_${page}` }),
            );
            expect(request.input).toContainEqual(
              expect.objectContaining({ type: "function_call_output", call_id: `call_${page}` }),
            );
            expect(JSON.stringify(request)).toContain(
              Buffer.from(`image-page-${page}`).toString("base64"),
            );
          }
          continue;
        }
        expect(request.previous_response_id).toBe(`resp_${index}`);
        const input = request.input.filter(
          (item) => !["system", "developer"].includes(item.role ?? ""),
        );
        expect(input).toHaveLength(1);
        expect(input[0]).toMatchObject({ type: "function_call_output", call_id: `call_${index}` });
        expect(JSON.stringify(request)).toContain(
          Buffer.from(`image-page-${index}`).toString("base64"),
        );
        expect(JSON.stringify(request)).not.toContain("Initial task context");
        if (index > 1)
          expect(JSON.stringify(request)).not.toContain(
            Buffer.from(`image-page-${index - 1}`).toString("base64"),
          );
      }
    },
  );
});
