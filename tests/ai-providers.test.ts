import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createProviderExamModel } from "@/server/ai/providers";
import { decryptApiKey, encryptApiKey } from "@/server/ai/credentials";
import { providerSchema } from "@/contracts/ai-providers";
import { applyPromptPreset, examPromptPrefix } from "@/server/exams/prompt-presets";
import { promptPresetSchema } from "@/contracts/prompt-presets";

afterEach(() => vi.unstubAllEnvs());
const config = providerSchema.parse({ name: "fixture", apiType: "openai_chat", baseURL: "https://fixture.test/v1/", model: "custom-vision" });
const request = { name: "test", schema: z.object({ ok: z.boolean() }), system: "Return JSON only.",
  content: [{ type: "file" as const, data: new Uint8Array([1, 2, 3]), mediaType: "image/jpeg" }] };
function chatResponse(text = '{"ok":true}') {
  return { id: "fixture", object: "chat.completion", created: 1, model: config.model,
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
    usage: { prompt_tokens: 5, completion_tokens: 4, total_tokens: 9 } };
}

describe("configurable model protocols", () => {
  it.each([false, true])("uses Chat Completions with schema support = %s", async (structuredOutputs) => {
    let body: Record<string, unknown> = {};
    const fetch: typeof globalThis.fetch = async (url, init) => {
      expect(String(url)).toBe("https://fixture.test/v1/chat/completions");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer fixture-key");
      expect(init?.redirect).toBe("error");
      body = JSON.parse(String(init?.body));
      return Response.json(chatResponse());
    };
    const result = await createProviderExamModel({ ...config, structuredOutputs }, "fixture-key", fetch).generate(request);
    expect(result.output).toEqual({ ok: true });
    expect(body.response_format).toMatchObject({ type: structuredOutputs ? "json_schema" : "json_object" });
    expect(JSON.stringify(body.messages)).toContain("image_url");
    expect(JSON.stringify(body)).not.toContain("reasoning_effort");
    if (!structuredOutputs) expect(JSON.stringify(body.messages)).toContain("Required JSON Schema");
  });
  it("retains the required schema during JSON-mode repairs", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetch: typeof globalThis.fetch = async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json(chatResponse(bodies.length === 1 ? '{"ok",true}' : '{"ok":true}'));
    };
    const result = await createProviderExamModel(config, "fixture-key", fetch).generate(request);
    expect(result.calls).toBe(2);
    expect(JSON.stringify(bodies[1].messages)).toContain("Required JSON Schema");
  });
  it("does not repair malformed output when only one call is authorized", async () => {
    let calls = 0;
    const fetch: typeof globalThis.fetch = async () => { calls++; return Response.json(chatResponse('{"ok",true}')); };
    await expect(createProviderExamModel(config, "fixture-key", fetch).generate({ ...request, maxCalls: 1 })).rejects.toThrow();
    expect(calls).toBe(1);
  });
  it("retains both calls and consumed tokens when JSON repair also fails", async () => {
    let calls = 0;
    const fetch: typeof globalThis.fetch = async () => { calls++; return Response.json(chatResponse('{"ok",true}')); };
    await expect(createProviderExamModel(config, "fixture-key", fetch).generate({ ...request, maxCalls: 2 })).rejects.toMatchObject({
      usage: { calls: 2, inputTokens: 10, outputTokens: 8, cachedInputTokens: 0, cacheWriteTokens: 0 },
    });
    expect(calls).toBe(2);
  });
  it("does not retry transport errors outside an explicit call budget", async () => {
    let calls = 0;
    const fetch: typeof globalThis.fetch = async () => { calls++; return Response.json({ error: { message: "Service unavailable" } }, { status: 503 }); };
    await expect(createProviderExamModel(config, "fixture-key", fetch).generate({ ...request, maxCalls: 1 })).rejects.toMatchObject({ usage: { calls: 1 } });
    expect(calls).toBe(1);
  });
  it("routes Responses without fixed DeepSeek parameters", async () => {
    const fetch: typeof globalThis.fetch = async (url, init) => {
      expect(String(url)).toBe("https://fixture.test/v1/responses");
      const body = JSON.parse(String(init?.body));
      expect(body.store).toBe(false);
      expect(body.model).toBe("custom-vision");
      expect(body.reasoning).toBeUndefined();
      expect(JSON.stringify(body.input)).toContain("input_image");
      return Response.json({ id: "fixture", object: "response", created_at: 1, status: "completed", model: "custom-vision",
        output: [{ type: "message", id: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: '{"ok":true}', annotations: [] }] }],
        usage: { input_tokens: 5, output_tokens: 4, total_tokens: 9 } });
    };
    expect((await createProviderExamModel({ ...config, apiType: "openai_responses" }, "fixture-key", fetch).generate(request)).output).toEqual({ ok: true });
  });
  it("routes Anthropic image inputs and x-api-key", async () => {
    const fetch: typeof globalThis.fetch = async (url, init) => {
      expect(String(url)).toBe("https://fixture.test/v1/messages");
      expect(new Headers(init?.headers).get("x-api-key")).toBe("fixture-key");
      expect(JSON.stringify(JSON.parse(String(init?.body)).messages)).toContain('"type":"image"');
      // Unknown model IDs use the SDK's JSON tool fallback for Anthropic.
      return Response.json({ id: "message", type: "message", role: "assistant", model: "custom-vision", content: [{ type: "tool_use", id: "tool", name: "json", input: { ok: true } }],
        stop_reason: "tool_use", stop_sequence: null, usage: { input_tokens: 5, output_tokens: 4 } });
    };
    expect((await createProviderExamModel({ ...config, apiType: "anthropic" }, "fixture-key", fetch).generate(request)).output).toEqual({ ok: true });
  });
  it("routes Google image inputs and x-goog-api-key", async () => {
    const fetch: typeof globalThis.fetch = async (url, init) => {
      expect(String(url)).toContain("/models/custom-vision:generateContent");
      expect(new Headers(init?.headers).get("x-goog-api-key")).toBe("fixture-key");
      expect(JSON.stringify(JSON.parse(String(init?.body)).contents)).toContain("inlineData");
      return Response.json({ candidates: [{ content: { role: "model", parts: [{ text: '{"ok":true}' }] }, finishReason: "STOP", index: 0 }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 4, totalTokenCount: 9 } });
    };
    expect((await createProviderExamModel({ ...config, apiType: "google" }, "fixture-key", fetch).generate(request)).output).toEqual({ ok: true });
  });
});

describe("provider credentials and prompt presets", () => {
  it("encrypts with authenticated random nonces and detects tampering/key changes", () => {
    vi.stubEnv("PROVIDER_KEY_ENCRYPTION_KEY", "test-random-encryption-secret-32-characters");
    const encrypted = encryptApiKey("secret-api-key");
    expect(encrypted).not.toContain("secret-api-key");
    expect(decryptApiKey(encrypted)).toBe("secret-api-key");
    expect(encryptApiKey("secret-api-key")).not.toBe(encrypted);
    const parts = encrypted.split("."); parts[2] = Buffer.alloc(16).toString("base64url");
    expect(() => decryptApiKey(parts.join("."))).toThrow();
    vi.stubEnv("PROVIDER_KEY_ENCRYPTION_KEY", "different-test-random-secret-32-characters");
    expect(() => decryptApiKey(encrypted)).toThrow();
    vi.stubEnv("PROVIDER_KEY_ENCRYPTION_KEY", "REPLACE_WITH_RANDOM_SECRET");
    expect(() => encryptApiKey("secret-api-key")).toThrow(/PROVIDER_KEY_ENCRYPTION_KEY/);
  });
  it("rejects URL credentials, query secrets and non-HTTP schemes", () => {
    for (const baseURL of ["file:///etc/passwd", "https://user:password@example.com", "https://example.com?key=secret", "https://example.com#fragment"]) {
      expect(providerSchema.safeParse({ ...config, baseURL }).success).toBe(false);
    }
    expect(config.baseURL).toBe("https://fixture.test/v1");
  });
  it("applies distinct presets without dropping domain rules or mutating requests", () => {
    const systems = promptPresetSchema.options.map((preset) => applyPromptPreset(preset, request).system);
    expect(new Set(systems).size).toBe(5);
    for (const system of systems) {
      expect(system).toContain("Return JSON only.");
      expect(system).toContain("untrusted");
      expect(system).toContain("TARGET");
    }
    expect(request.system).toBe("Return JSON only.");
    const deepseek = applyPromptPreset("deepseek", { ...request, name: "exam_layout" });
    expect(deepseek.system).toContain('"questions":[]');
    expect(deepseek.system).toContain("Synthetic formatting example");
  });
  it("keeps a byte-identical substantial prefix across pages and stages", () => {
    for (const preset of promptPresetSchema.options) {
      const layout = applyPromptPreset(preset, { ...request, name: "exam_layout", content: "page 1" });
      const verification = applyPromptPreset(preset, { ...request, name: "verified_exam_page", content: "page 9" });
      const prefix = examPromptPrefix(preset);
      expect(prefix.length).toBeGreaterThan(5000);
      expect(layout.system.startsWith(prefix)).toBe(true);
      expect(verification.system.startsWith(prefix)).toBe(true);
      expect(layout.cachePrefix).toBe(verification.cachePrefix);
      expect(prefix).not.toContain("page 9");
    }
  });
});
