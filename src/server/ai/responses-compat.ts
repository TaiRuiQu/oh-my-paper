import type { AssistantContent, ModelMessage } from "ai";

type ReasoningPart = Extract<Exclude<AssistantContent, string>[number], { type: "reasoning" }>;

function reasoningState(part: ReasoningPart) {
  const options = part.providerOptions?.openai;
  return options && typeof options === "object" && !Array.isArray(options) ? options : undefined;
}

// With store=false, only encrypted reasoning can be replayed. Gateways may
// return summaries without recoverable state; keep them in the current result,
// but omit them from later requests, as the Responses protocol requires.
export function prepareResponsesMessages(messages: ModelMessage[]): ModelMessage[] {
  return messages.flatMap((message): ModelMessage[] => {
    if (message.role !== "assistant" || typeof message.content === "string") return [message];
    // Streaming may attach the encrypted state only to the last summary part.
    // Retain the entire reasoning sequence when any part supplies that state.
    const encryptedIds = new Set(
      message.content.flatMap((part) => {
        if (part.type !== "reasoning") return [];
        const state = reasoningState(part);
        const encrypted = state?.reasoningEncryptedContent;
        return encrypted !== null && encrypted !== undefined && typeof state?.itemId === "string"
          ? [state.itemId]
          : [];
      }),
    );
    const content = message.content.filter((part) => {
      if (part.type !== "reasoning") return true;
      const state = reasoningState(part);
      const encrypted = state?.reasoningEncryptedContent;
      return (
        (encrypted !== null && encrypted !== undefined) ||
        (typeof state?.itemId === "string" && encryptedIds.has(state.itemId))
      );
    });
    if (content.length === message.content.length) return [message];
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

export async function compatibleResponsesResponse(response: Response): Promise<Response> {
  if (!response.ok || response.headers.get("content-type")?.includes("text/event-stream"))
    return response;
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
