import "server-only";
import { z } from "zod";
import { getEnv } from "@/server/config/env";
import { AccessError, RequestError } from "./errors";

export function requireSameOrigin(request: Request) {
  if (request.headers.get("origin") !== new URL(getEnv().BETTER_AUTH_URL).origin) {
    throw new AccessError(403, "请求来源无效，请刷新页面后重试。");
  }
}

export async function readJSON<T>(
  request: Request,
  schema: z.ZodType<T>,
  maxBytes = 16_384,
  allowEmpty = false,
): Promise<T> {
  if (!request.body) {
    if (allowEmpty) return schema.parse({});
    throw new RequestError(400, "请求内容不能为空。");
  }
  const reader = request.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new RequestError(413, "请求内容过大，请减少内容后重试。");
      }
      chunks.push(value);
    }
    let data: unknown;
    try {
      data = !size && allowEmpty ? {} : JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch (cause) {
      throw new RequestError(400, "请求内容必须是 JSON。", { cause });
    }
    const result = schema.safeParse(data);
    if (!result.success)
      throw new RequestError(
        400,
        `配置字段 ${result.error.issues[0]?.path.join(".") || "根字段"}：${result.error.issues[0]?.message ?? "内容无效"}`,
        { cause: result.error },
      );
    return result.data;
  } finally {
    reader.releaseLock();
  }
}
