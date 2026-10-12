import { join } from "node:path";
import { requireSession } from "@/server/auth/session";
import { ownedExamTask, taskDirectory } from "@/server/exams/tasks";
import { readActivity } from "@/server/exams/activity";
import { errorResponse } from "@/server/http/errors";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireSession(request.headers);
    const task = await ownedExamTask(user.id, (await context.params).id);
    const params = new URL(request.url).searchParams;
    const sameAttempt = params.get("attempt") === task.attempt;
    const cursor = Number(params.get("after") ?? 0);
    const after = sameAttempt && Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0;
    const events = task.attempt
      ? await readActivity(join(taskDirectory(task.id), task.attempt), after)
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
    return errorResponse(error);
  }
}
