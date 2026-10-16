/** Compatible gateways may omit an empty citation list on otherwise valid text. */
export async function normalizeResponsesResponse(response: Response): Promise<Response> {
  if (!response.ok || !response.headers.get("content-type")?.includes("application/json"))
    return response;
  const body = await response.text();
  let result: unknown;
  try {
    result = JSON.parse(body);
  } catch {
    return new Response(body, response);
  }
  if (
    !result ||
    typeof result !== "object" ||
    !("output" in result) ||
    !Array.isArray(result.output)
  )
    return new Response(body, response);
  let changed = false;
  for (const item of result.output) {
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
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  return new Response(changed ? JSON.stringify(result) : body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
