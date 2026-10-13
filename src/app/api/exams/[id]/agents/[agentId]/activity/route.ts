import { z } from "zod";
import { join } from "node:path";
import { requireAdmin } from "@/server/auth/authorization";
import { ownedAgentTask, agentTaskDirectory } from "@/server/exams/agent-tasks";
import { readActivity } from "@/server/exams/activity";
import { RequestError, errorResponse } from "@/server/http/errors";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; agentId: string }> },
) {
  let isAdmin = false;
  try {
    const { user } = await requireAdmin(request.headers),
      { id, agentId } = await context.params;
    isAdmin = true;
    const task = await ownedAgentTask(user.id, id, agentId),
      params = new URL(request.url).searchParams;
    const parsed = z.coerce
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .safeParse(params.get("after") ?? 0);
    if (!parsed.success) throw new RequestError(400, "活动记录游标必须是非负整数。");
    const after = params.get("attempt") === task.attempt ? parsed.data : 0;
    const events = task.attempt
      ? await readActivity(join(agentTaskDirectory(task.id), task.attempt), after)
      : [];
    return Response.json(
      {
        attempt: task.attempt,
        events,
        cursor: events.at(-1)?.sequence ?? after,
        active: ["QUEUED", "RUNNING"].includes(task.status),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(error, request, isAdmin);
  }
}
