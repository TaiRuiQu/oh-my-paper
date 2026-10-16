import "server-only";
import { AppError } from "@/server/errors";
import { logError } from "@/server/logger";
export class AccessError extends AppError {
  constructor(status: 401 | 403 | 404, message: string, options?: ErrorOptions) {
    super(message, `ACCESS_${status}`, status, options);
    this.name = "AccessError";
  }
}
export class RequestError extends AppError {
  constructor(status: 400 | 409 | 413 | 422 | 429 | 503, message: string, options?: ErrorOptions) {
    super(message, `REQUEST_${status}`, status, options);
    this.name = "RequestError";
  }
}
export function errorResponse(error: unknown, request?: Request, isAdmin = false) {
  const diagnostic = logError(
    "http.request.failed",
    error,
    request
      ? {
          method: request.method,
          path: new URL(request.url).pathname,
        }
      : {},
  );
  return Response.json(
    isAdmin
      ? {
          error: `${diagnostic.message}（错误编号：${diagnostic.errorId}）`,
          code: diagnostic.code,
          errorId: diagnostic.errorId,
        }
      : {
          error:
            error instanceof AccessError ||
            (error instanceof RequestError && error.status !== 503) ||
            (error instanceof AppError && error.code === "CREDITS_EXHAUSTED")
              ? error.message
              : "暂时无法完成操作，请稍后重试。",
        },
    {
      status: error instanceof AppError ? error.status : 503,
      headers: { "Cache-Control": "no-store", "X-Error-Id": diagnostic.errorId },
    },
  );
}
