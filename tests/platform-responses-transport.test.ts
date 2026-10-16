import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { once } from "node:events";
import { WebSocketServer, type WebSocket } from "ws";
import { createOpenAI } from "@ai-sdk/openai";
import { ToolLoopAgent, isStepCount, tool } from "ai";
import { z } from "zod";
import { createResponsesTransport } from "@/server/platform/ai/responses-transport";

type Body = Record<string, unknown> & { input?: Record<string, unknown>[] };
const cleanups: (() => Promise<unknown> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
  cleanups.length = 0;
});

async function server(onMessage?: (socket: WebSocket, body: Body, connection: number) => void) {
  const http = createServer();
  const ws = new WebSocketServer({ noServer: true });
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        ws.clients.forEach((socket) => socket.terminate());
        ws.close();
        http.close(() => resolve());
        http.closeAllConnections();
      }),
  );
  let connections = 0;
  const headers: IncomingMessage["headers"][] = [];
  if (onMessage)
    http.on("upgrade", (request, socket, head) => {
      headers.push(request.headers);
      const index = ++connections;
      ws.handleUpgrade(request, socket, head, (connection) => {
        connection.on("message", (raw) => onMessage(connection, JSON.parse(String(raw)), index));
      });
    });
  http.listen(0, "127.0.0.1");
  await once(http, "listening");
  return {
    http,
    headers,
    url: `http://127.0.0.1:${(http.address() as { port: number }).port}/v1/responses`,
  };
}

function response(id: string, output: unknown[] = []) {
  return { id, status: "completed", output, usage: { input_tokens: 10, output_tokens: 5 } };
}
function complete(socket: WebSocket, id: string, output: unknown[] = []) {
  socket.send(JSON.stringify({ type: "response.completed", response: response(id, output) }));
}
const initial = { model: "test-model", input: [{ role: "user", content: "hello" }] };
function client(mode: "http" | "websocket", timeoutMs = 5000) {
  const onFallback = vi.fn();
  const transport = createResponsesTransport({ mode, timeoutMs, onFallback });
  cleanups.push(() => transport.close());
  const send = (url: string, body: Body = initial, signal?: AbortSignal) =>
    transport.fetch(url, {
      method: "POST",
      headers: { authorization: "Bearer test-secret", "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  return { transport, send, onFallback };
}
function httpReply(http: Server, requests: Body[]) {
  http.on("request", async (request, reply) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push(JSON.parse(Buffer.concat(chunks).toString()));
    reply.writeHead(200, { "content-type": "text/event-stream" });
    const data = `event: response.completed\r\ndata: ${JSON.stringify({ type: "response.completed", response: response("http-done") })}\r\n\r\n`;
    reply.write(data.slice(0, 20));
    reply.end(data.slice(20));
  });
}

describe("Codex Responses transport", () => {
  it("uses stateless streaming HTTP and returns a completed SDK response", async () => {
    const host = await server();
    const requests: Body[] = [];
    httpReply(host.http, requests);
    const { send } = client("http");
    expect(
      (
        await (
          await send(host.url, {
            ...initial,
            store: true,
            previous_response_id: "old",
            max_output_tokens: 999,
          })
        ).json()
      ).id,
    ).toBe("http-done");
    expect(requests[0]).toMatchObject({
      store: false,
      stream: true,
      input: initial.input,
      include: ["reasoning.encrypted_content"],
    });
    expect(requests[0]).not.toHaveProperty("previous_response_id");
    expect(requests[0]).not.toHaveProperty("max_output_tokens");
  });

  it("prewarms and chains real SDK tool calls, text, encrypted reasoning and images on one socket", async () => {
    const requests: Body[] = [];
    let step = 0;
    const host = await server((socket, body) => {
      requests.push(body);
      if (body.generate === false) return complete(socket, "warmup");
      const index = ++step;
      complete(
        socket,
        `resp_${index}`,
        index < 3
          ? [
              {
                type: "reasoning",
                id: `rs_${index}`,
                summary: [{ type: "summary_text", text: "inspect" }],
                encrypted_content: `encrypted_${index}`,
              },
              {
                type: "message",
                id: `msg_${index}`,
                role: "assistant",
                content: [{ type: "output_text", text: `Inspecting ${index}`, annotations: [] }],
              },
              {
                type: "function_call",
                id: `fc_${index}`,
                call_id: `call_${index}`,
                name: "inspect",
                arguments: JSON.stringify({ page: index }),
              },
            ]
          : [
              {
                type: "message",
                id: "msg_done",
                role: "assistant",
                content: [{ type: "output_text", text: "done", annotations: [] }],
              },
            ],
      );
    });
    const { transport } = client("websocket");
    const model = createOpenAI({
      apiKey: "test-secret",
      baseURL: host.url.replace(/\/responses$/, ""),
      fetch: transport.fetch,
    }).responses("gpt-6-astra");
    const agent = new ToolLoopAgent({
      model,
      instructions: "Inspect pages.",
      providerOptions: { openai: { store: false } },
      stopWhen: isStepCount(3),
      tools: {
        inspect: tool({
          inputSchema: z.object({ page: z.number() }),
          execute: ({ page }) => page,
          toModelOutput: ({ output }) => ({
            type: "content",
            value: [
              { type: "text", text: `page ${output}` },
              {
                type: "file",
                mediaType: "image/jpeg",
                data: { type: "data", data: Buffer.from(`image-${output}`).toString("base64") },
              },
            ],
          }),
        }),
      },
    });
    expect((await agent.generate({ prompt: "Initial task" })).text).toBe("done");
    expect(host.headers).toHaveLength(1);
    expect(host.headers[0].authorization).toBe("Bearer test-secret");
    expect(requests).toHaveLength(4);
    expect(requests[0]).toMatchObject({ generate: false, store: false, stream: true });
    expect(requests[1]).toMatchObject({ previous_response_id: "warmup", input: [] });
    for (let index = 2; index < 4; index++) {
      expect(requests[index]).toMatchObject({
        previous_response_id: `resp_${index - 1}`,
        store: false,
      });
      expect(requests[index].input).toHaveLength(1);
      expect(requests[index].input![0]).toMatchObject({
        type: "function_call_output",
        call_id: `call_${index - 1}`,
      });
      expect(JSON.stringify(requests[index])).toContain(
        Buffer.from(`image-${index - 1}`).toString("base64"),
      );
    }
  });

  it("sends full context when request settings or earlier input change", async () => {
    const requests: Body[] = [];
    const host = await server((socket, body) => {
      requests.push(body);
      complete(socket, `r${requests.length}`);
    });
    const { send } = client("websocket");
    await send(host.url);
    await send(host.url, { ...initial, model: "another-model" });
    await send(host.url, {
      ...initial,
      model: "another-model",
      input: [{ role: "user", content: "edited" }],
    });
    for (const body of requests.slice(2)) {
      expect(body.previous_response_id).toBeUndefined();
      expect(body.input).toHaveLength(1);
    }
  });

  it.each(["previous_response_not_found", "websocket_connection_limit_reached", "disconnect"])(
    "reconnects with complete context after %s",
    async (failure) => {
      const requests: { body: Body; connection: number }[] = [];
      let failed = false;
      const host = await server((socket, body, connection) => {
        requests.push({ body, connection });
        if (body.generate === false) return complete(socket, `warm_${connection}`);
        if (!failed) {
          failed = true;
          if (failure === "disconnect") socket.terminate();
          else
            socket.send(
              JSON.stringify({
                type: "error",
                status: 400,
                error: { code: failure, message: failure },
              }),
            );
        } else complete(socket, "done");
      });
      const { send, onFallback } = client("websocket");
      expect((await (await send(host.url)).json()).id).toBe("done");
      expect(host.headers).toHaveLength(2);
      expect(requests.find(({ connection }) => connection === 2)!.body.input).toEqual(
        initial.input,
      );
      expect(
        requests.find(({ connection }) => connection === 2)!.body.previous_response_id,
      ).toBeUndefined();
      expect(onFallback).not.toHaveBeenCalled();
    },
  );

  it("falls back to HTTP for the session when upgrade is unavailable", async () => {
    const host = await server();
    let upgrades = 0;
    host.http.on("upgrade", (_request, socket) => {
      upgrades++;
      socket.end("HTTP/1.1 426 Upgrade Required\r\nContent-Length: 0\r\n\r\n");
    });
    const requests: Body[] = [];
    httpReply(host.http, requests);
    const { send, onFallback } = client("websocket");
    await send(host.url);
    await send(host.url);
    expect(upgrades).toBe(1);
    expect(onFallback).toHaveBeenCalledOnce();
    expect(requests).toHaveLength(2);
    expect(requests.every((body) => body.store === false && !body.previous_response_id)).toBe(true);
  });

  it("preserves upstream authorization errors without falling back", async () => {
    const host = await server();
    host.http.on("upgrade", (_request, socket) =>
      socket.end("HTTP/1.1 403 Forbidden\r\nX-Request-Id: blocked\r\nContent-Length: 0\r\n\r\n"),
    );
    const { send, onFallback } = client("websocket");
    const result = await send(host.url);
    expect(result.status).toBe(403);
    expect(result.headers.get("x-request-id")).toBe("blocked");
    expect(onFallback).not.toHaveBeenCalled();
  });

  it("falls back after repeated connection failures and keeps the full input", async () => {
    const host = await server((socket) => socket.terminate());
    const requests: Body[] = [];
    httpReply(host.http, requests);
    const { send, onFallback } = client("websocket", 15000);
    expect((await (await send(host.url)).json()).id).toBe("http-done");
    expect(host.headers).toHaveLength(6);
    expect(requests[0].input).toEqual(initial.input);
    expect(onFallback).toHaveBeenCalledOnce();
  }, 15000);

  it("replays full context when the provider omits response IDs", async () => {
    const requests: Body[] = [];
    const host = await server((socket, body) => {
      requests.push(body);
      const result = response("unused");
      socket.send(
        JSON.stringify({ type: "response.completed", response: { ...result, id: undefined } }),
      );
    });
    const { send } = client("websocket");
    await send(host.url);
    await send(host.url);
    expect(requests).toHaveLength(3);
    expect(requests.every((body) => !body.previous_response_id && body.input?.length === 1)).toBe(
      true,
    );
  });

  it("does not share connection or continuation state between model sessions", async () => {
    const requests: Body[] = [];
    const host = await server((socket, body, connection) => {
      requests.push(body);
      complete(socket, `resp_${connection}`);
    });
    const first = client("websocket");
    const second = client("websocket");
    await Promise.all([first.send(host.url), second.send(host.url)]);
    expect(host.headers).toHaveLength(2);
    expect(host.headers[0].session_id).not.toBe(host.headers[1].session_id);
    expect(requests.filter((body) => body.generate === false)).toHaveLength(2);
  });

  it("preserves an SSE response.failed status and request ID", async () => {
    const host = await server();
    host.http.on("request", (_request, reply) => {
      reply.writeHead(200, { "content-type": "text/event-stream" });
      reply.end(
        `data: ${JSON.stringify({ type: "response.failed", status: 403, request_id: "denied-request", response: { error: { code: "forbidden", message: "Forbidden" } } })}\n\n`,
      );
    });
    const { send } = client("http");
    const result = await send(host.url);
    expect(result.status).toBe(403);
    expect(result.headers.get("x-request-id")).toBe("denied-request");
  });

  it("rejects a truncated SSE stream instead of reporting a completed task", async () => {
    const host = await server();
    host.http.on("request", (_request, reply) => {
      reply.writeHead(200, { "content-type": "text/event-stream" });
      reply.end('data: {"type":"response.created"}\n\n');
    });
    const { send } = client("http");
    await expect(send(host.url)).rejects.toThrow(/before completion/);
  });

  it("times out an unresponsive socket without sending an HTTP request", async () => {
    const host = await server(() => {});
    const request = vi.fn();
    host.http.on("request", request);
    const { send, onFallback } = client("websocket", 100);
    await expect(send(host.url)).rejects.toMatchObject({ name: "TimeoutError" });
    expect(onFallback).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("aborts an active socket request and closes session resources", async () => {
    const host = await server(() => {});
    const { send, transport } = client("websocket");
    const abort = new AbortController();
    const pending = send(host.url, initial, abort.signal);
    const rejection = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    abort.abort();
    await rejection;
    transport.close();
    await expect(send(host.url)).rejects.toThrow(/closed/);
  });
});
