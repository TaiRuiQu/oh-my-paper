import type { AssistantContent, ModelMessage } from "ai";

type ReasoningPart = Extract<Exclude<AssistantContent, string>[number], { type: "reasoning" }>;

function reasoningState(part: ReasoningPart) {
  const options = part.providerOptions?.openai;
  return options && typeof options === "object" && !Array.isArray(options) ? options : undefined;
}

// Prefer opaque encrypted state when provided, even if storage is enabled.
// Otherwise stored reasoning can be replayed by item ID; unsupported summaries
// without either recoverable state are omitted.
export function prepareResponsesMessages(
  messages: ModelMessage[],
  { store = false }: { store?: boolean } = {},
): ModelMessage[] {
  return messages.flatMap((message): ModelMessage[] => {
    if (message.role !== "assistant" || typeof message.content === "string") return [message];
    const originalContent = message.content;
    // Streaming may attach the encrypted state only to the last summary part.
    // Retain the entire reasoning sequence when any part supplies that state.
    const encryptedIds = new Set(
      originalContent.flatMap((part) => {
        if (part.type !== "reasoning") return [];
        const state = reasoningState(part);
        const encrypted = state?.reasoningEncryptedContent;
        return encrypted !== null && encrypted !== undefined && typeof state?.itemId === "string"
          ? [state.itemId]
          : [];
      }),
    );
    const emittedEncryptedIds = new Set<string>();
    const content = originalContent.flatMap((part): Exclude<AssistantContent, string>[number][] => {
      if (part.type !== "reasoning") return [part];
      const state = reasoningState(part);
      const encrypted = state?.reasoningEncryptedContent;
      const id = state?.itemId;
      if (store && typeof id === "string" && encryptedIds.has(id)) {
        if (emittedEncryptedIds.has(id)) return [];
        emittedEncryptedIds.add(id);
        const sequence = originalContent.filter(
          (item): item is ReasoningPart =>
            item.type === "reasoning" && reasoningState(item)?.itemId === id,
        );
        const encryptedPart = sequence.findLast((item) => {
          const encrypted = reasoningState(item)?.reasoningEncryptedContent;
          return encrypted !== null && encrypted !== undefined;
        })!;
        const options = { ...reasoningState(encryptedPart) };
        // With store=true, an item ID would make the SDK discard encrypted
        // content in favor of a server reference. Merge streamed summary parts
        // before removing the ID so only one complete reasoning item is sent.
        delete options.itemId;
        return [
          {
            ...part,
            text: sequence.map((item) => item.text).join("\n"),
            providerOptions: { ...part.providerOptions, openai: options },
          },
        ];
      }
      return (store && typeof state?.itemId === "string") ||
        (encrypted !== null && encrypted !== undefined) ||
        (typeof state?.itemId === "string" && encryptedIds.has(state.itemId))
        ? [part]
        : [];
    });
    if (
      content.length === originalContent.length &&
      content.every((part, index) => part === originalContent[index])
    )
      return [message];
    return content.length ? [{ ...message, content }] : [];
  });
}

// Some Responses-compatible gateways omit annotations when there are no citations.
// Preserve all actual annotations and leave other malformed fields to SDK validation.
export function normalizeResponseAnnotations(value: unknown): boolean {
  if (!value || typeof value !== "object" || !("output" in value) || !Array.isArray(value.output))
    return false;
  let changed = false;
  for (const item of value.output) {
    if (item?.type !== "message" || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (
        part?.type === "output_text" &&
        (part.annotations === null || part.annotations === undefined)
      ) {
        part.annotations = [];
        changed = true;
      }
    }
  }
  return changed;
}

// Only the start event may omit arguments: later deltas and the completed
// item's arguments remain authoritative and must still pass SDK validation.
function normalizeStreamEvent(frame: string): string {
  const lines = frame.split(/\r\n|\r|\n/);
  const data = lines.flatMap((line) =>
    line === "data" ? [""] : line.startsWith("data:") ? [line.slice(5).replace(/^ /, "")] : [],
  );
  if (!data.length) return frame;
  let value;
  try {
    value = JSON.parse(data.join("\n"));
  } catch {
    return frame;
  }
  if (
    value?.type !== "response.output_item.added" ||
    value.item?.type !== "function_call" ||
    value.item.arguments !== undefined
  )
    return frame;
  value.item.arguments = "";
  let written = false;
  return lines
    .flatMap((line) => {
      if (line !== "data" && !line.startsWith("data:")) return [line];
      if (written) return [];
      written = true;
      return [`data: ${JSON.stringify(value)}`];
    })
    .join("\n");
}

function compatibleResponsesStream(response: Response): Response {
  if (!response.body) return response;
  let pending = "";
  let frame = "";
  const stream = response.body
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(
      new TransformStream<string, string>({
        transform(chunk, controller) {
          pending += chunk;
          // Keep a trailing CR until the next chunk so split CRLF stays one newline.
          let match;
          while ((match = /\r\n|\r|\n/.exec(pending))) {
            if (match[0] === "\r" && match.index === pending.length - 1) break;
            const line = pending.slice(0, match.index);
            frame += pending.slice(0, match.index + match[0].length);
            pending = pending.slice(match.index + match[0].length);
            if (line === "") {
              controller.enqueue(normalizeStreamEvent(frame));
              frame = "";
            }
          }
        },
        flush(controller) {
          if (frame || pending) controller.enqueue(normalizeStreamEvent(frame + pending));
        },
      }),
    )
    .pipeThrough(new TextEncoderStream());
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function compatibleResponsesResponse(
  response: Response,
  streaming = false,
): Promise<Response> {
  if (!response.ok) return response;
  if (streaming || response.headers.get("content-type")?.includes("text/event-stream"))
    return compatibleResponsesStream(response);
  const body = await response.text();
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    // Keep the original invalid body so the SDK can report the real parse error.
  }
  const changed = normalizeResponseAnnotations(value);
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  return new Response(changed ? JSON.stringify(value) : body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
