import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { requireAdmin } from "@/server/auth/authorization";
import { ownedAgentTask, agentTaskDirectory } from "@/server/exams/agent-tasks";
import { AccessError, errorResponse } from "@/server/http/errors";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; agentId: string; path: string[] }> },
) {
  let isAdmin = false;
  try {
    const { user } = await requireAdmin(request.headers),
      { id, agentId, path } = await context.params;
    isAdmin = true;
    const task = await ownedAgentTask(user.id, id, agentId),
      key = path.join("/");
    if (
      !task.attempt ||
      new URL(request.url).searchParams.get("attempt") !== task.attempt ||
      !/^(?:pages\/\d{3}|agent\/[a-f0-9-]{36})\.jpg$/.test(key)
    )
      throw new AccessError(404, "工具预览不存在或已切换任务。");
    const bytes = await readFile(join(agentTaskDirectory(task.id), task.attempt, key));
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
