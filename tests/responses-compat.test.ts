import { describe, expect, it } from "vitest";
import { APICallError } from "ai";
import { z } from "zod";
import {
  normalizeResponseAnnotations,
  compatibleResponsesResponse,
} from "@/server/ai/responses-compat";
import { createProviderExamModel } from "@/server/ai/providers";
import { describeError } from "@/server/logger";

describe("Responses gateway compatibility", () => {
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
    expect(await compatibleResponsesResponse(stream)).toBe(stream);
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
      Response.json({
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
