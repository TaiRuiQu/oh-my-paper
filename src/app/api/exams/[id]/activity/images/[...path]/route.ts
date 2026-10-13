import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { requireAdmin } from "@/server/auth/authorization";
import { ownedExamTask, taskDirectory } from "@/server/exams/tasks";
import { AccessError, errorResponse } from "@/server/http/errors";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; path: string[] }> },
) {
  let isAdmin = false;
  try {
    const { user } = await requireAdmin(request.headers),
      { id, path } = await context.params;
    isAdmin = true;
    const task = await ownedExamTask(user.id, id),
      key = path.join("/");
    if (
      !task.attempt ||
      new URL(request.url).searchParams.get("attempt") !== task.attempt ||
      !/^(?:pages\/\d{3}|agent\/[a-f0-9-]{36})\.jpg$/.test(key)
    )
      throw new AccessError(404, "工具预览不存在或已切换解析任务。");
    const bytes = await readFile(join(taskDirectory(id), task.attempt, key));
    return new Response(bytes, {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error, request, isAdmin);
  }
}
