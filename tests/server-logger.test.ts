import { afterEach, describe, expect, it, vi } from "vitest";
import { APICallError, RetryError } from "ai";
import { AppError } from "@/server/errors";
import { describeError, logError } from "@/server/logger";

afterEach(() => vi.restoreAllMocks());

function apiError(statusCode: number) {
  return new APICallError({
    message: "Service Unavailable",
    url: "https://user:password@gateway.example/v1/responses?api_key=private-key",
    requestBodyValues: { prompt: "private exam content" },
    responseBody: "private upstream response",
    responseHeaders: { "x-request-id": "upstream-request-123", authorization: "private-key" },
    statusCode,
  });
}

describe("readable server diagnostics", () => {
  it("explains upstream 503 and reports the actual SDK attempt count", () => {
    const error = new RetryError({
      message: "Failed after 3 attempts",
      reason: "maxRetriesExceeded",
      errors: [apiError(503), apiError(503), apiError(503)],
    });
    const details = describeError(error);
    expect(details).toMatchObject({
      code: "AI_HTTP_503",
      statusCode: 503,
      retryable: true,
      attempts: 3,
      requestId: "upstream-request-123",
      endpoint: "https://gateway.example/v1/responses",
    });
    expect(details.message).toContain("上游服务暂时不可用");
    expect(details.message).toContain("可能");
    expect(details.message).toContain("供应商或中转服务状态");
    expect(details.message).toContain("共尝试 3 次（含 2 次自动重试）");
    for (const secret of ["password", "private-key", "private exam", "private upstream"])
      expect(JSON.stringify(details)).not.toContain(secret);
  });

  it("does not invent retries or classify authentication failure as transient", () => {
    expect(describeError(apiError(401))).toMatchObject({
      code: "AI_HTTP_401",
      retryable: false,
      attempts: undefined,
    });
    expect(describeError(apiError(401)).message).toContain("认证失败");
    expect(describeError(apiError(401)).message).not.toContain("自动重试");
  });

  it.each([
    [429, "额度"],
    [500, "内部错误"],
    [502, "有效响应"],
    [504, "响应超时"],
  ])("gives a specific explanation for HTTP %s", (status, explanation) => {
    expect(describeError(apiError(status)).message).toContain(explanation);
  });

  it("preserves explicit application errors and invalid-success-response diagnostics", () => {
    expect(describeError(new AppError("请先配置模型。", "MODEL_MISSING"))).toMatchObject({
      code: "MODEL_MISSING",
      message: "请先配置模型。",
    });
    expect(describeError(apiError(200))).toMatchObject({ code: "AI_RESPONSE_INVALID" });
  });

  it("keeps readable messages, context and redacted technical details in structured logs", () => {
    const output = vi.spyOn(console, "error").mockImplementation(() => {});
    const diagnostic = logError("platform.ai.job.failed", apiError(503), {
      jobId: "job",
      kind: "IMPORT",
      providerName: "学校 AI 网关",
      model: "configured-model",
    });
    expect(JSON.parse(output.mock.calls[0][0])).toMatchObject({
      errorId: diagnostic.errorId,
      message: diagnostic.message,
      jobId: "job",
      providerName: "学校 AI 网关",
      model: "configured-model",
      causes: [expect.objectContaining({ type: "AI_APICallError", statusCode: 503 })],
    });
  });
});
