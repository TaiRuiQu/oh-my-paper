import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { requireSession } from "@/server/auth/session";
import { ownedExamTask, taskDirectory } from "@/server/exams/tasks";
import { readActivity } from "@/server/exams/activity";
import { AccessError, errorResponse } from "@/server/http/errors";

export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; key: string }> },
) {
  try {
    const { user } = await requireSession(request.headers);
    const { id, key } = await context.params;
    const task = await ownedExamTask(user.id, id),
      attempt = new URL(request.url).searchParams.get("attempt");
    if (
      !z.uuid().safeParse(attempt).success ||
      task.attempt !== attempt ||
      !/^(?:[0-9a-f-]{36}\.png|page-\d{3}\.jpg)$/.test(key)
    )
      throw new AccessError(404, "预览不存在。");
    const directory = join(taskDirectory(id), attempt!);
    const imageKey = key.startsWith("page-") ? `pages/${key.slice(5)}` : `agent/${key}`;
    const events = await readActivity(directory);
    if (
      !events.some(
        (e) =>
          e.type === "tool_result" &&
          e.data &&
          typeof e.data === "object" &&
          "images" in e.data &&
          Array.isArray(e.data.images) &&
          e.data.images.includes(imageKey),
      )
    )
      throw new AccessError(404, "预览不存在。");
    return new Response(await readFile(join(directory, imageKey)), {
      headers: {
        "Content-Type": key.endsWith(".jpg") ? "image/jpeg" : "image/png",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
