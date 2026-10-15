import "server-only";
import { conversationSnapshot } from "./store";
import { subscribeXiaozhi } from "./notifications";

export async function xiaozhiEvents(request: Request, userId: string, id: string, expiresAt: Date) {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let closed = false;
  let dirty = false;
  let reading = false;
  let unsubscribe: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let lifetime: ReturnType<typeof setTimeout> | undefined;
  const close = () => {
    if (closed) return;
    closed = true;
    unsubscribe?.();
    clearInterval(heartbeat);
    clearTimeout(lifetime);
    request.signal.removeEventListener("abort", close);
    controller?.close();
  };
  const send = (value: string) => {
    if (closed || !controller) return;
    if ((controller.desiredSize ?? 0) <= 0) return close();
    controller.enqueue(new TextEncoder().encode(value));
  };
  const snapshot = async () => {
    if (!controller || closed || reading) return;
    reading = true;
    try {
      do {
        dirty = false;
        const value = await conversationSnapshot(userId, id);
        send(`event: snapshot\ndata: ${JSON.stringify(value)}\n\n`);
      } while (dirty && !closed);
    } catch {
      close();
    } finally {
      reading = false;
    }
  };
  try {
    unsubscribe = await subscribeXiaozhi((change) => {
      if (change.userId === userId && change.id === id) {
        dirty = true;
        void snapshot();
      }
    }, close);
    await conversationSnapshot(userId, id);
    request.signal.addEventListener("abort", close, { once: true });
    if (request.signal.aborted) {
      close();
      return new Response(null, { status: 204 });
    }
    const stream = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
        send("retry: 1500\n\n");
        void snapshot();
        heartbeat = setInterval(() => send(": heartbeat\n\n"), 15000);
        lifetime = setTimeout(
          close,
          Math.max(0, Math.min(300000, expiresAt.getTime() - Date.now())),
        );
      },
      cancel() {
        controller = undefined;
        close();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "private, no-store",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (cause) {
    close();
    throw cause;
  }
}
