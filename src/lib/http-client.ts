import { reportClientError } from "./error-message";
export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ApiRequestError";
  }
}
function cancelled(error: unknown, signal: AbortSignal | null | undefined) {
  return signal?.aborted || (error instanceof Error && error.name === "AbortError");
}

export async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  try {
    const response = await fetch(url, { cache: "no-store", ...init });
    let data: unknown;
    try {
      data = await response.json();
    } catch (cause) {
      if (cancelled(cause, init?.signal)) throw cause;
      throw new Error(
        `接口返回的内容不是有效 JSON（HTTP ${response.status}）：${url.split("?")[0]}`,
        { cause },
      );
    }
    if (!response.ok) {
      const problem =
        data && typeof data === "object" ? (data as { error?: string; errorId?: string }) : {};
      throw new ApiRequestError(
        problem.error ??
          `接口请求失败（HTTP ${response.status}）：${url.split("?")[0]}${problem.errorId ? `，错误编号：${problem.errorId}` : ""}`,
        response.status,
      );
    }
    if (!data) throw new Error(`接口返回空结果：${url.split("?")[0]}`);
    return data as T;
  } catch (error) {
    if (cancelled(error, init?.signal)) throw error;
    const message = reportClientError("api.request", error);
    if (error instanceof ApiRequestError)
      throw new ApiRequestError(message, error.status, { cause: error });
    throw new Error(message, { cause: error });
  }
}
export function jsonBody(body: unknown): RequestInit {
  return { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}
