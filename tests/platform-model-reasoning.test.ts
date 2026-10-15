import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { generateText } from "ai";

const mocks = vi.hoisted(() => ({ findModel: vi.fn(), getActor: vi.fn() }));
vi.mock("@/server/db/client", () => ({
  getDb: () => ({ aiModel: { findFirst: mocks.findModel } }),
}));
vi.mock("@/server/platform/service", () => ({ getActor: mocks.getActor }));
vi.mock("@/server/ai/credentials", () => ({ decryptApiKey: () => "test-key" }));
import { loadAiModel } from "@/server/platform/ai/model";

const protocols = ["openai_chat", "openai_responses", "anthropic", "google"] as const;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getActor.mockResolvedValue({ role: "ADMIN" });
});
afterEach(() => vi.unstubAllGlobals());

it.each(protocols)(
  "passes the saved reasoning effort to the actual %s request",
  async (apiType) => {
    const name =
      apiType === "anthropic"
        ? "claude-sonnet-5.5"
        : apiType === "google"
          ? "gemini-3.8-flash"
          : "school-model-alias";
    mocks.findModel.mockResolvedValue({
      id: "model",
      name,
      reasoningEffort: "high",
      isPublic: true,
      provider: {
        id: "provider",
        name: "test",
        apiType,
        baseURL: "https://model.test/v1",
        encryptedApiKey: "unused",
        maxOutputTokens: 16000,
        timeoutSeconds: 30,
        maxConcurrency: 1,
      },
    });
    const request = vi.fn(async () => {
      if (apiType === "openai_chat")
        return Response.json({
          id: "chat-test",
          created: 0,
          model: name,
          choices: [
            { index: 0, message: { role: "assistant", content: "done" }, finish_reason: "stop" },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        });
      if (apiType === "openai_responses")
        return Response.json({
          id: "resp_test",
          output: [
            {
              type: "message",
              id: "msg_test",
              role: "assistant",
              content: [{ type: "output_text", text: "done", annotations: [] }],
            },
          ],
          usage: { input_tokens: 1, output_tokens: 1 },
        });
      if (apiType === "anthropic")
        return Response.json({
          id: "msg_test",
          type: "message",
          role: "assistant",
          model: name,
          content: [{ type: "text", text: "done" }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        });
      return Response.json({
        candidates: [
          { content: { role: "model", parts: [{ text: "done" }] }, finishReason: "STOP", index: 0 },
        ],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
        modelVersion: name,
      });
    });
    const fetchMock = vi.fn<(...args: Parameters<typeof fetch>) => Promise<Response>>(async () =>
      request(),
    );
    vi.stubGlobal("fetch", fetchMock);
    const configuration = await loadAiModel("admin", "model");
    const result = await generateText({
      model: configuration.model,
      reasoning: configuration.reasoning,
      maxOutputTokens: configuration.maxOutputTokens,
      prompt: "Test reasoning setting",
      maxRetries: 0,
    });
    expect(result.text).toBe("done");
    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    if (apiType === "openai_chat") expect(body.reasoning_effort).toBe("high");
    if (apiType === "openai_responses") expect(body.reasoning.effort).toBe("high");
    if (apiType === "anthropic") expect(body.output_config.effort).toBe("high");
    if (apiType === "google")
      expect(body.generationConfig.thinkingConfig.thinkingLevel).toBe("high");
  },
);

it.each(["provider-default", "none", "minimal", "low", "medium", "high", "xhigh", "max"])(
  "loads saved reasoning effort %s",
  async (reasoningEffort) => {
    mocks.findModel.mockResolvedValue({
      id: "model",
      name: "configured-model",
      reasoningEffort,
      isPublic: true,
      provider: {
        id: "provider",
        apiType: "openai_chat",
        baseURL: "https://model.test/v1",
        encryptedApiKey: "unused",
        timeoutSeconds: 30,
      },
    });
    expect((await loadAiModel("admin", "model")).reasoning).toBe(reasoningEffort);
  },
);
