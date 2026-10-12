import "server-only";

export class AccessError extends Error {
  constructor(
    public readonly status: 401 | 403 | 404,
    message: string,
  ) {
    super(message);
  }
}

export class RequestError extends Error {
  constructor(
    public readonly status: 400 | 409 | 413 | 422 | 429 | 503,
    message: string,
  ) {
    super(message);
  }
}

export function errorResponse(error: unknown) {
  if (error instanceof AccessError || error instanceof RequestError) {
    return Response.json(
      { error: error.message },
      { status: error.status, headers: { "Cache-Control": "no-store" } },
    );
  }
  // Never send database URLs, SQL, user content, or provider credentials to the client.
  return Response.json(
    { error: "服务暂时不可用，请稍后重试。" },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}
