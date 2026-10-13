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
