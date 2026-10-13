import { afterEach, describe, expect, it, vi } from "vitest";
import { APICallError, RetryError, NoObjectGeneratedError } from "ai";
import { z } from "zod";
import { AppError } from "@/server/errors";
import { describeError, logError } from "@/server/logger";
import { errorResponse, RequestError } from "@/server/http/errors";
import { apiRequest } from "@/lib/http-client";
import { redactErrorText } from "@/lib/error-message";
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("detailed diagnostics", () => {
  it("records the failing operation, exception chain and stack without credentials or request data", () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "private-auth-secret");
    const write = vi.spyOn(console, "error").mockImplementation(() => {});
    const cause = new APICallError({
      message: "Unauthorized: Bearer secret-provider-key private-auth-secret",
      url: "https://user:password@api.example/v1?api_key=secret-provider-key",
      requestBodyValues: { paper: "private exam content" },
      responseBody: "private exam answer",
      statusCode: 401,
    });
    const error = new AppError("模型连接失败。", "PROVIDER_FAILED", 503, { cause });
    const diagnostic = logError(
      "exam.parse.failed",
      error,
      { taskId: "task", phase: "model_recognition" },
      { secrets: ["secret-provider-key"] },
    );
    const output = String(write.mock.calls[0][0]),
      parsed = JSON.parse(output);
    expect(parsed.errorId).toBe(diagnostic.errorId);
    expect(parsed.phase).toBe("model_recognition");
    expect(parsed.causes[1].statusCode).toBe(401);
    expect(parsed.causes[0].stack).toContain("at ");
    for (const value of [
      "secret-provider-key",
      "private-auth-secret",
      "private exam content",
      "private exam answer",
      "password@",
    ])
      expect(output).not.toContain(value);
  });
  it("unwraps exhausted retries and returns a useful provider error", () => {
    const cause = new APICallError({
      message: "rate limited",
      url: "https://api.example",
      requestBodyValues: {},
      statusCode: 429,
    });
    const error = new RetryError({
      message: "retry exhausted",
      reason: "maxRetriesExceeded",
      errors: [cause],
    });
    expect(describeError(error)).toMatchObject({
      code: "AI_HTTP_429",
      message: expect.stringContaining("HTTP 429"),
    });
  });
  it("reports schema field paths while suppressing generated text and validation input values", () => {
    const invalid = z
      .object({ questions: z.array(z.object({ score: z.number() })) })
      .safeParse({ questions: [{ score: "PRIVATE_ANSWER" }] });
    if (invalid.success) throw new Error("Fixture should fail");
    const error = new NoObjectGeneratedError({
      cause: invalid.error,
      text: "PRIVATE_MODEL_TEXT",
      response: { id: "model-response", timestamp: new Date(), modelId: "test" },
      usage: {} as never,
      finishReason: "stop",
    });
    const output = JSON.stringify(describeError(error));
    expect(output).toContain("questions.0.score");
    expect(output).not.toContain("PRIVATE_ANSWER");
    expect(output).not.toContain("PRIVATE_MODEL_TEXT");
  });
  it("handles circular causes and database errors without logging SQL or row data", () => {
    const error = Object.assign(
      new Error("SELECT password FROM users WHERE answer='PRIVATE_ROW'"),
      { name: "PrismaClientKnownRequestError", code: "P2021", cause: undefined as unknown },
    );
    error.cause = error;
    const diagnostic = describeError(error);
    expect(diagnostic.message).toContain("迁移");
    expect(diagnostic.causes).toHaveLength(1);
    expect(JSON.stringify(diagnostic)).not.toContain("PRIVATE_ROW");
  });
  it("returns the same error ID in API JSON, headers and server logs", async () => {
    const write = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = errorResponse(
      new RequestError(413, "上传总大小超过 100 MB。"),
      new Request("http://localhost/api/exams?token=private", { method: "POST" }),
      true,
    );
    const data = await response.json(),
      event = JSON.parse(String(write.mock.calls[0][0]));
    expect(response.status).toBe(413);
    expect(data.error).toContain("100 MB");
    expect(response.headers.get("X-Error-Id")).toBe(data.errorId);
    expect(event.errorId).toBe(data.errorId);
    expect(event.path).toBe("/api/exams");
    expect(JSON.stringify(event)).not.toContain("token=private");
  });
  it("hides provider and database diagnostics from public responses while retaining upload guidance", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = errorResponse(
      new AppError("SDK provider schema secret-stage", "INTERNAL_STAGE", 503),
    );
    const data = await response.json();
    expect(data).toEqual({ error: "暂时无法完成操作，请稍后重试。" });
    expect(JSON.stringify(data)).not.toContain("SDK");
    const validation = await errorResponse(new RequestError(413, "上传总大小超过 100 MB。")).json();
    expect(validation).toEqual({ error: "上传总大小超过 100 MB。" });
    expect(
      (await errorResponse(new RequestError(503, "Worker heartbeat missing")).json()).error,
    ).not.toContain("Worker");
  });
  it("redacts URL credentials, query tokens, API keys and authorization", () => {
    const text = redactErrorText(
      'https://alice:password@api.example/v1?key=secret Authorization: Bearer secret-token api_key="private" sk-privateKey',
    );
    for (const value of [
      "alice",
      "password",
      "key=secret",
      "secret-token",
      "privateKey",
      '"private"',
    ])
      expect(text).not.toContain(value);
  });
  it("explains malformed HTTP responses and records browser failures", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("bad gateway", { status: 502 })));
    await expect(apiRequest("/api/exams")).rejects.toThrow("HTTP 502");
    expect(console.error).toHaveBeenCalled();
  });
});
