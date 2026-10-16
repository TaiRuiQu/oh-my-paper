import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiRequestError, apiRequest } from "@/lib/http-client";
const { report } = vi.hoisted(() => ({
  report: vi.fn((_context: string, error: Error) => error.message),
}));
vi.mock("@/lib/error-message", () => ({
  reportClientError: report,
}));
beforeEach(() => {
  report.mockClear();
});
afterEach(() => vi.unstubAllGlobals());
it("preserves a typed HTTP status through error reporting for conflict recovery", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ error: "评分版本已更新" }), { status: 409 })),
  );
  const error = await apiRequest("/api/platform/reviews/commands").catch((error: unknown) => error);
  expect(error).toBeInstanceOf(ApiRequestError);
  expect(error).toMatchObject({ status: 409, message: "评分版本已更新" });
});
it("does not classify network errors as HTTP conflicts", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("offline");
    }),
  );
  const error = await apiRequest("/api/platform/reviews/commands").catch((error: unknown) => error);
  expect(error).toBeInstanceOf(Error);
  expect(error).not.toBeInstanceOf(ApiRequestError);
  expect(report).toHaveBeenCalledOnce();
});
it("keeps the original fetch cancellation without logging it as a failed API request", async () => {
  const controller = new AbortController();
  const aborted = new DOMException("主动离页取消", "AbortError");
  controller.abort(aborted);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw aborted;
    }),
  );
  await expect(
    apiRequest("/api/platform/practice/sessions/x", { signal: controller.signal }),
  ).rejects.toBe(aborted);
  expect(report).not.toHaveBeenCalled();
});
it("preserves cancellation during body parsing and a custom AbortController reason", async () => {
  const controller = new AbortController(),
    reason = new Error("用户切换范围");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      status: 200,
      ok: true,
      json: async () => {
        controller.abort(reason);
        throw reason;
      },
    })),
  );
  await expect(apiRequest("/api/platform/analytics", { signal: controller.signal })).rejects.toBe(
    reason,
  );
  expect(report).not.toHaveBeenCalled();
});
it("still reports malformed JSON on an active request", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("broken", { status: 200 })),
  );
  await expect(apiRequest("/api/platform/analytics")).rejects.toThrow("不是有效 JSON");
  expect(report).toHaveBeenCalledOnce();
});
