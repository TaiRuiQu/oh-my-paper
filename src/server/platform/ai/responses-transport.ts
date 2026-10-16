import "server-only";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket, { type RawData } from "ws";
import { EventSourceParserStream } from "eventsource-parser/stream";
import type { ResponsesTransportMode } from "@/contracts/ai-models";
import { normalizeResponsesResponse } from "./responses";

type JsonObject = Record<string, unknown>;
type LastResponse = { request: JsonObject; id: string; output: unknown[] };
type Options = {
  mode: ResponsesTransportMode;
  timeoutMs: number;
  fetch?: typeof fetch;
  onFallback?: () => void;
};

// Codex model-provider-info defaults and async-utils exponential backoff.
const MAX_STREAM_RETRIES = 5;
const WEBSOCKET_CONNECT_TIMEOUT_MS = 15_000;

function object(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function stable(value: unknown): string {
  return JSON.stringify(value, (_key, entry) =>
    entry && typeof entry === "object" && !Array.isArray(entry)
      ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b)))
      : entry,
  );
}

/** Compare the server's output with the SDK's stateless replay encoding. */
function replayItems(items: unknown[]): unknown[] {
  return items.flatMap((value) => {
    const item = object(value);
    if (item.type === "message" || item.role) {
      const parts = Array.isArray(item.content) ? item.content : [{ text: item.content }];
      return parts.map((part) => ({
        role: item.role,
        content: object(part).text,
        ...(item.phase ? { phase: item.phase } : {}),
      }));
    }
    if (item.type === "function_call")
      return [
        Object.fromEntries(
          ["type", "call_id", "name", "arguments", "namespace", "async", "caller"]
            .filter((key) => item[key] !== undefined)
            .map((key) => [key, item[key]]),
        ),
      ];
    if (item.type === "reasoning")
      return [
        {
          type: item.type,
          encrypted_content: item.encrypted_content ?? undefined,
          summary: item.summary ?? [],
        },
      ];
    return [item];
  });
}

/** Codex only uses a delta when request settings and the entire known prefix match. */
function continuation(request: JsonObject, previous?: LastResponse) {
  if (!previous?.id || !Array.isArray(request.input) || !Array.isArray(previous.request.input))
    return request;
  const properties = (value: JsonObject) =>
    Object.fromEntries(
      Object.entries(value).filter(
        ([key]) => !["input", "stream_options", "client_metadata", "access_programs"].includes(key),
      ),
    );
  if (stable(properties(request)) !== stable(properties(previous.request))) return request;
  const prefix = previous.request.input;
  if (stable(request.input.slice(0, prefix.length)) !== stable(prefix)) return request;
  const output = replayItems(previous.output);
  const current = request.input.slice(prefix.length, prefix.length + output.length);
  if (stable(replayItems(current)) !== stable(output)) return request;
  return {
    ...request,
    previous_response_id: previous.id,
    input: request.input.slice(prefix.length + output.length),
  };
}

class ApiFailure extends Error {
  constructor(
    readonly response: Response,
    readonly code?: string,
  ) {
    super("Responses request failed.");
  }
}

function terminal(event: JsonObject): JsonObject | undefined {
  if (event.type === "error" || event.type === "response.failed") {
    const error = object(event.error ?? object(event.response).error);
    const status = Number(event.status ?? error.status);
    throw new ApiFailure(
      Response.json(
        { error },
        {
          status: status >= 400 && status <= 599 ? status : 500,
          headers: typeof event.request_id === "string" ? { "x-request-id": event.request_id } : {},
        },
      ),
      typeof error.code === "string" ? error.code : undefined,
    );
  }
  if (event.type === "response.completed" || event.type === "response.incomplete") {
    const response = object(event.response);
    if (!Array.isArray(response.output)) throw new TypeError("Responses output is missing.");
    return response;
  }
}

/**
 * Wire behavior follows openai/codex 6fbd7be (core/src/client.rs): stateless streaming HTTP,
 * or per-agent WebSocket prewarm + prefix-checked deltas with session-scoped HTTP fallback.
 * The SDK's generate API consumes the completed response; tool execution stays in ToolLoopAgent.
 */
export function createResponsesTransport(options: Options) {
  const httpFetch = options.fetch ?? globalThis.fetch;
  const sessionId = randomUUID();
  const lifetime = new AbortController();
  let socket: WebSocket | undefined;
  let last: LastResponse | undefined;
  let connectionKey: string | undefined;
  let turnState: string | undefined;
  let fallback = options.mode === "http";
  let prewarmed = false;
  let closed = false;
  let busy = false;

  function disconnect() {
    last = undefined;
    connectionKey = undefined;
    socket?.terminate();
    socket = undefined;
  }

  async function connect(url: string, headers: Headers, signal: AbortSignal) {
    const key = stable([url, [...headers.entries()]]);
    if (socket?.readyState === WebSocket.OPEN && connectionKey === key) return socket;
    disconnect();
    signal.throwIfAborted();
    return new Promise<WebSocket>((resolve, reject) => {
      const endpoint = new URL(url);
      endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
      const connection = new WebSocket(endpoint, {
        headers: {
          ...Object.fromEntries(headers),
          ...(turnState ? { "x-codex-turn-state": turnState } : {}),
        },
        handshakeTimeout: Math.min(options.timeoutMs, WEBSOCKET_CONNECT_TIMEOUT_MS),
        maxPayload: 64 * 1024 * 1024,
      });
      socket = connection;
      // A terminated connection can emit an error after its request listeners are removed.
      connection.on("error", () => {});
      const abort = () => {
        connection.terminate();
        finish(signal.reason);
      };
      const onError = (error: Error) => finish(error);
      const onClose = () => finish(new Error("Responses WebSocket closed during connection."));
      const finish = (error?: unknown) => {
        signal.removeEventListener("abort", abort);
        connection.off("error", onError);
        connection.off("close", onClose);
        connection.off("open", onOpen);
        if (error) reject(error);
        else resolve(connection);
      };
      const onOpen = () => {
        connectionKey = key;
        finish();
      };
      connection.on("upgrade", (response) => {
        const state = response.headers["x-codex-turn-state"];
        if (typeof state === "string") turnState = state;
      });
      connection.on("unexpected-response", (_request, response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size <= 256 * 1024) chunks.push(chunk);
        });
        response.on("end", () => {
          const responseHeaders = new Headers();
          for (const [name, value] of Object.entries(response.headers))
            if (typeof value === "string") responseHeaders.set(name, value);
          finish(
            new ApiFailure(
              new Response(Buffer.concat(chunks).toString(), {
                status: response.statusCode ?? 502,
                headers: responseHeaders,
              }),
            ),
          );
          connection.terminate();
        });
        response.on("error", onError);
      });
      signal.addEventListener("abort", abort, { once: true });
      connection.once("open", onOpen);
      connection.once("error", onError);
      connection.once("close", onClose);
      if (signal.aborted) abort();
    });
  }

  async function exchange(connection: WebSocket, payload: JsonObject, signal: AbortSignal) {
    signal.throwIfAborted();
    return new Promise<JsonObject>((resolve, reject) => {
      const finish = (error?: unknown, response?: JsonObject) => {
        signal.removeEventListener("abort", abort);
        connection.off("message", onMessage);
        connection.off("error", onError);
        connection.off("close", onClose);
        if (error) reject(error);
        else resolve(response!);
      };
      const abort = () => {
        disconnect();
        finish(signal.reason);
      };
      const onError = (error: Error) => finish(error);
      const onClose = () => finish(new Error("Responses WebSocket closed before completion."));
      const onMessage = (data: RawData) => {
        try {
          const result = terminal(object(JSON.parse(data.toString())));
          if (result) finish(undefined, result);
        } catch (error) {
          finish(error);
        }
      };
      connection.on("message", onMessage);
      connection.once("error", onError);
      connection.once("close", onClose);
      signal.addEventListener("abort", abort, { once: true });
      connection.send(JSON.stringify({ type: "response.create", ...payload }), (error) => {
        if (error) finish(error);
      });
      if (signal.aborted) abort();
    });
  }

  async function http(url: string, init: RequestInit, request: JsonObject, headers: Headers) {
    if (turnState) headers.set("x-codex-turn-state", turnState);
    const response = await httpFetch(url, { ...init, headers, body: JSON.stringify(request) });
    turnState = response.headers.get("x-codex-turn-state") ?? turnState;
    if (!response.ok || !response.headers.get("content-type")?.includes("text/event-stream"))
      return normalizeResponsesResponse(response);
    if (!response.body) throw new TypeError("Responses stream is empty.");
    const events = response.body
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new EventSourceParserStream())
      .getReader();
    try {
      while (true) {
        const { done, value } = await events.read();
        if (done) throw new Error("Responses HTTP stream ended before completion.");
        if (value.data === "[DONE]") continue;
        const result = terminal(object(JSON.parse(value.data)));
        if (result) {
          const responseHeaders = new Headers(response.headers);
          responseHeaders.delete("content-length");
          responseHeaders.delete("content-encoding");
          responseHeaders.set("content-type", "application/json");
          return normalizeResponsesResponse(
            new Response(JSON.stringify(result), { headers: responseHeaders }),
          );
        }
      }
    } finally {
      await events.cancel().catch(() => {});
      events.releaseLock();
    }
  }

  async function transportFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    if (closed) throw new Error("AI model session is closed.");
    if (busy) throw new Error("An AI model session cannot run concurrent requests.");
    const url = input instanceof Request ? input.url : String(input);
    const request: JsonObject = JSON.parse(String(init?.body));
    request.store = false;
    request.stream = true;
    request.include = [
      ...new Set([
        ...(Array.isArray(request.include) ? request.include : []),
        "reasoning.encrypted_content",
      ]),
    ];
    delete request.previous_response_id;
    delete request.max_output_tokens;
    const headers = new Headers(init?.headers);
    headers.delete("content-length");
    headers.set("session_id", sessionId);
    const signal = AbortSignal.any([
      lifetime.signal,
      ...(init?.signal ? [init.signal] : []),
      AbortSignal.timeout(options.timeoutMs),
    ]);
    busy = true;
    try {
      if (!fallback) {
        for (let attempt = 0; attempt <= MAX_STREAM_RETRIES; attempt++) {
          try {
            signal.throwIfAborted();
            const connection = await connect(url, headers, signal);
            if (!prewarmed) {
              prewarmed = true;
              // Best-effort Codex prewarm: no tokens are generated, but input is cached on the socket.
              try {
                const warmup = await exchange(connection, { ...request, generate: false }, signal);
                if (typeof warmup.id === "string" && warmup.status !== "incomplete")
                  last = { request, id: warmup.id, output: object(warmup).output as unknown[] };
              } catch (error) {
                if (
                  !(error instanceof ApiFailure) ||
                  [401, 403, 426, 429].includes(error.response.status)
                )
                  throw error;
              }
            }
            const result = await exchange(connection, continuation(request, last), signal);
            last =
              typeof result.id === "string" && result.status !== "incomplete"
                ? { request, id: result.id, output: result.output as unknown[] }
                : undefined;
            return normalizeResponsesResponse(Response.json(result));
          } catch (error) {
            disconnect();
            signal.throwIfAborted();
            if (closed) throw new Error("AI model session is closed.");
            if (error instanceof ApiFailure) {
              if (error.response.status === 426) break;
              if (
                !["previous_response_not_found", "websocket_connection_limit_reached"].includes(
                  error.code ?? "",
                )
              )
                return error.response;
            }
            if (attempt < MAX_STREAM_RETRIES)
              await delay(Math.floor(200 * 2 ** attempt * (0.9 + Math.random() * 0.2)), undefined, {
                signal,
              });
          }
        }
        fallback = true;
        options.onFallback?.();
      }
      return await http(url, { ...init, signal }, request, headers);
    } catch (error) {
      if (error instanceof ApiFailure) return error.response;
      throw error;
    } finally {
      busy = false;
    }
  }

  return {
    fetch: transportFetch as typeof fetch,
    close() {
      closed = true;
      lifetime.abort(new DOMException("AI model session closed.", "AbortError"));
      disconnect();
    },
  };
}
