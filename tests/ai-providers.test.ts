import { modelStreamResponse } from "./model-stream-response";
import { describe, expect, it } from "vitest";
import {
  MAX_OUTPUT_TOKENS,
  providerInputSchema,
  type ProviderSnapshot,
} from "@/contracts/ai-providers";
import { anthropicBaseURL, createProviderExamModel, reasoningOptions } from "@/server/ai/providers";
const config: ProviderSnapshot = {
  providerId: "10000000-0000-4000-8000-000000000001",
  name: "test",
  apiType: "openai_chat",
  baseURL: "https://provider.example/v1",
  encryptedApiKey: "encrypted",
  structuredOutputs: true,
  maxOutputTokens: 16000,
  timeoutSeconds: 60,
  maxConcurrency: 3,
  model: "test-vision",
  reasoningEffort: "high",
};
const output = {
  name: "试卷",
  totalScore: 2,
  sections: [
    {
      number: "一",
      title: "计算题",
      description: "",
      score: 2,
      questions: [
        { number: 1, description: "$1+1=$？", materials: [], score: 2, subquestions: [] },
      ],
    },
  ],
};
describe("provider models and reasoning", () => {
  it("defaults to 384K output tokens and accepts this limit when saving a provider", () => {
    const input = {
      name: "test",
      apiType: "openai_chat",
      baseURL: "https://provider.example/v1",
      apiKey: "secret",
      models: [{ name: "one", reasoningEfforts: ["default"] }],
    };
    expect(MAX_OUTPUT_TOKENS).toBe(393216);
    expect(providerInputSchema.parse(input).maxOutputTokens).toBe(393216);
    expect(providerInputSchema.parse({ ...input, maxOutputTokens: 393216 }).maxOutputTokens).toBe(
      393216,
    );
    expect(providerInputSchema.safeParse({ ...input, maxOutputTokens: 393217 }).success).toBe(
      false,
    );
  });
  it("normalizes Anthropic gateway roots without duplicating the API version", () => {
    expect(anthropicBaseURL("https://gateway.example/apps/anthropic/")).toBe(
      "https://gateway.example/apps/anthropic/v1",
    );
    expect(anthropicBaseURL("https://api.anthropic.com/v1")).toBe("https://api.anthropic.com/v1");
    expect(anthropicBaseURL("https://gateway.example/anthropic/v1/messages")).toBe(
      "https://gateway.example/anthropic/v1",
    );
  });
  it("calls the versioned Anthropic Messages endpoint using SDK authentication and parses its response", async () => {
    let url = "";
    const transport: typeof fetch = async (input, init) => {
      url = String(input);
      expect(new Headers(init?.headers).get("x-api-key")).toBe("test-key");
      expect(new Headers(init?.headers).get("anthropic-version")).toBe("2023-06-01");
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe("qwen3.8-flash");
      expect(body.max_tokens).toBe(MAX_OUTPUT_TOKENS);
      expect(body.stream).toBe(true);
      return modelStreamResponse({
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: body.model,
        content: [{ type: "text", text: JSON.stringify(output) }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 20, output_tokens: 30 },
      });
    };
    const exam = await createProviderExamModel(
      {
        ...config,
        apiType: "anthropic",
        baseURL: "https://gateway.example/apps/anthropic",
        model: "qwen3.8-flash",
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        reasoningEffort: "default",
      },
      "test-key",
      transport,
    ).generate({ system: "Extract paper", content: [{ type: "text", text: "paper" }] });
    expect(url).toBe("https://gateway.example/apps/anthropic/v1/messages");
    expect(exam).toEqual(output);
  });
  it("allows several models with independent effort options and rejects duplicates", () => {
    const input = {
      name: "test",
      apiType: "openai_chat",
      baseURL: "https://provider.example/v1/",
      apiKey: "secret",
      models: [
        { name: "one", reasoningEfforts: ["default", "low", "high"] },
        { name: "two", reasoningEfforts: ["none", "medium"] },
      ],
    };
    expect(providerInputSchema.parse(input).models).toHaveLength(2);
    expect(
      providerInputSchema.safeParse({ ...input, models: [input.models[0], input.models[0]] })
        .success,
    ).toBe(false);
    expect(
      providerInputSchema.safeParse({ ...input, models: [{ name: "one", reasoningEfforts: [] }] })
        .success,
    ).toBe(false);
    expect(
      providerInputSchema.safeParse({
        ...input,
        models: [{ name: "one", reasoningEfforts: ["low", "low"] }],
      }).success,
    ).toBe(false);
    expect(
      providerInputSchema.safeParse({
        ...input,
        apiType: "google",
        models: [{ name: "one", reasoningEfforts: ["xhigh"] }],
      }).success,
    ).toBe(false);
  });
  it("maps reasoning to the correct API namespace", () => {
    expect(reasoningOptions({ ...config, apiType: "openai_responses" })).toEqual({
      openai: {
        store: false,
        reasoningEffort: "high",
        forceReasoning: true,
        systemMessageMode: "system",
        reasoningSummary: null,
      },
    });
    expect(
      reasoningOptions({ ...config, apiType: "openai_responses", reasoningEffort: "default" }),
    ).toEqual({ openai: { store: false } });
    expect(
      reasoningOptions({
        ...config,
        apiType: "openai_responses",
        baseURL: "https://api.openai.com/v1",
      }),
    ).toEqual({ openai: { store: false, reasoningEffort: "high" } });
    expect(reasoningOptions(config)).toEqual({ exam: { reasoningEffort: "high" } });
    expect(reasoningOptions({ ...config, apiType: "anthropic" })).toEqual({
      anthropic: { thinking: { type: "adaptive" }, effort: "high" },
    });
    expect(reasoningOptions({ ...config, apiType: "google" })).toEqual({
      google: { thinkingConfig: { thinkingLevel: "high" } },
    });
    expect(reasoningOptions({ ...config, reasoningEffort: "default" })).toEqual({});
  });
  it("passes the selected model and effort to the real SDK request and returns only exam content", async () => {
    let body: Record<string, unknown> = {},
      redirect: RequestRedirect | undefined;
    const transport: typeof fetch = async (_url, init) => {
      body = JSON.parse(String(init?.body));
      redirect = init?.redirect;
      return modelStreamResponse({
        id: "completion",
        object: "chat.completion",
        created: 1,
        model: config.model,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              // 说明不依赖结构化输出模式：允许模型用代码围栏包裹 JSON。
              content: "试卷内容如下：\n```json\n" + JSON.stringify(output) + "\n```",
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      });
    };
    const exam = await createProviderExamModel(config, "test-key", transport).generate({
      system: "Extract paper",
      content: [{ type: "text", text: "paper" }],
    });
    expect(body.model).toBe(config.model);
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(body.reasoning_effort).toBe("high");
    expect(body.response_format).toBeUndefined();
    expect(redirect).toBe("error");
    expect(exam).toEqual(output);
  });
});
