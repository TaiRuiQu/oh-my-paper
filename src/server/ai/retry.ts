import "server-only";
import type { LanguageModelMiddleware } from "ai";
import { AppError } from "@/server/errors";

export const AI_MAX_RETRIES = 3;

export function isTransientAiError(error: unknown): boolean {
  if (!(error instanceof Error) || error instanceof AppError) return false;
  const value = error as Error & { statusCode?: number; isRetryable?: boolean; code?: string };
  if (value.statusCode !== undefined && value.statusCode >= 400)
    return [408, 409, 425, 429].includes(value.statusCode) || value.statusCode >= 500;
  // Providers can wrap a broken HTTP 200 stream as a non-retryable API error.
  if (value.cause && isTransientAiError(value.cause)) return true;
  if (value.isRetryable !== undefined) return value.isRetryable;
  if (value.name === "TimeoutError") return true;
  if (value.name === "AbortError") return false;
  if (
    [
      "ECONNRESET",
      "ECONNREFUSED",
      "ETIMEDOUT",
      "EAI_AGAIN",
      "UND_ERR_SOCKET",
      "UND_ERR_CONNECT_TIMEOUT",
    ].includes(value.code ?? "")
  )
    return true;
  return /fetch failed|network|connection|socket|stream.*(closed|ended|reset|incomplete)|terminated/i.test(
    value.message,
  );
}

export async function waitForAiRetry(error: unknown, retry: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const headers = (error as { responseHeaders?: Record<string, string> })?.responseHeaders;
  let ms = 1000 * 2 ** (retry - 1);
  if (headers?.["retry-after-ms"]) ms = Number(headers["retry-after-ms"]);
  else if (headers?.["retry-after"]) {
    const seconds = Number(headers["retry-after"]);
    ms = Number.isFinite(seconds)
      ? seconds * 1000
      : Date.parse(headers["retry-after"]) - Date.now();
  }
  if (!Number.isFinite(ms) || ms < 0) ms = 1000 * 2 ** (retry - 1);
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(
      () => {
        signal?.removeEventListener("abort", abort);
        resolve();
      },
      Math.min(ms, 60_000),
    );
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export async function retryAiRequest<T>(
  operation: () => PromiseLike<T>,
  signal?: AbortSignal,
  maxRetries = AI_MAX_RETRIES,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    try {
      return await operation();
    } catch (error) {
      signal?.throwIfAborted();
      if (attempt >= maxRetries || !isTransientAiError(error)) throw error;
      await waitForAiRetry(error, attempt + 1, signal);
    }
  }
}

/** Turn transport/idle failures into stream error events for the SDK's step recovery.
 * The SDK buffers tool calls until a successful model response, so completed
 * earlier steps remain intact and failed attempts cannot execute local tools.
 */
export function aiRecoveryMiddleware(
  timeoutMs: number,
  maxRetries = AI_MAX_RETRIES,
): LanguageModelMiddleware {
  return {
    specificationVersion: "v4",
    wrapStream: async ({ model, params }) => {
      const abort = new AbortController();
      const signal = params.abortSignal
        ? AbortSignal.any([params.abortSignal, abort.signal])
        : abort.signal;
      const result = await retryAiRequest(
        () => model.doStream({ ...params, abortSignal: signal }),
        params.abortSignal,
        maxRetries,
      );
      const reader = result.stream.getReader();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let complete = false,
        hasOutput = false;
      let timeoutError: DOMException | undefined;
      const arm = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          timeoutError = new DOMException(
            hasOutput
              ? "Chunk timeout: AI 流式输出等待超时。"
              : "First chunk timeout: AI 首次输出等待超时。",
            "TimeoutError",
          );
          abort.abort(timeoutError);
          void reader.cancel(timeoutError).catch(() => {});
        }, timeoutMs);
      };
      arm();
      return {
        ...result,
        stream: new ReadableStream({
          async pull(controller) {
            try {
              const next = await reader.read();
              params.abortSignal?.throwIfAborted();
              if (timeoutError) throw timeoutError;
              if (next.done) {
                clearTimeout(timer);
                if (!complete) throw new Error("AI stream ended before completion");
                controller.close();
                return;
              }
              const part = next.value;
              if (part.type === "error") {
                clearTimeout(timer);
                complete = true;
                if (!isTransientAiError(part.error)) throw part.error;
              }
              if (part.type === "finish") {
                complete = true;
                clearTimeout(timer);
              } else if (
                (part.type === "text-delta" ||
                  part.type === "reasoning-delta" ||
                  part.type === "tool-input-delta") &&
                part.delta.length
              ) {
                hasOutput = true;
                arm();
              } else if (part.type === "tool-call") {
                hasOutput = true;
                arm();
              }
              controller.enqueue(part);
            } catch (error) {
              clearTimeout(timer);
              abort.abort(error);
              void reader.cancel(error).catch(() => {});
              if (!params.abortSignal?.aborted && isTransientAiError(error)) {
                controller.enqueue({ type: "error", error });
                controller.close();
              } else controller.error(params.abortSignal?.reason ?? error);
            }
          },
          async cancel(reason) {
            clearTimeout(timer);
            abort.abort(reason);
            await reader.cancel(reason);
          },
        }),
      };
    },
  };
}
