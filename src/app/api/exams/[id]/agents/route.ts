import { isAdminUser } from "@/server/auth/authorization";
import { presentAgentTask } from "@/lib/task-presentation";
import { requireSession } from "@/server/auth/session";
import { listAgentTasks } from "@/server/exams/agent-tasks";
import { answerUploadState } from "@/server/exams/workflows";
import { errorResponse } from "@/server/http/errors";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  let isAdmin = false;
  try {
    const { user } = await requireSession(request.headers);
    isAdmin = await isAdminUser(user.id);
    return Response.json(
      {
        tasks: (await listAgentTasks(user.id, (await context.params).id)).map((task) =>
          presentAgentTask(task, isAdmin),
        ),
        upload: await answerUploadState(user.id, (await context.params).id),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(error, request, isAdmin);
  }
}
