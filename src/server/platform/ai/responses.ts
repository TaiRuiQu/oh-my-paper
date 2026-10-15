import type { StepResult, ToolSet } from "ai";
import { RequestError } from "@/server/http/errors";

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

/** The server retains prior inputs and assistant output; send only the latest tool results. */
export function prepareResponsesStep({
  steps,
}: {
  steps: Pick<StepResult<ToolSet>, "providerMetadata" | "response">[];
}) {
  const previous = steps.at(-1);
  if (!previous) return;
  const responseId = previous.providerMetadata?.openai?.responseId;
  if (typeof responseId !== "string" || !responseId.length)
    throw new RequestError(
      503,
      "Responses 接口未返回响应 ID，无法继续 AI 会话，请检查供应商配置。",
    );
  return {
    messages: previous.response.messages.filter((message) => message.role === "tool"),
    providerOptions: {
      openai: { store: true, parallelToolCalls: true, previousResponseId: responseId },
    },
  };
}
