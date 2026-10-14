import { presentAgentTask } from "@/lib/task-presentation";
import { isAdminUser } from "@/server/auth/authorization";
import { requireSession } from "@/server/auth/session";
import { retryAgentTask } from "@/server/exams/agent-tasks";
import { requireSameOrigin } from "@/server/http/mutations";
import { errorResponse } from "@/server/http/errors";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; agentId: string }> },
) {
  let isAdmin = false;
  try {
    const { user } = await requireSession(request.headers);
    isAdmin = await isAdminUser(user.id);
    requireSameOrigin(request);
    const { id, agentId } = await context.params;
    return Response.json(
      {
        task: presentAgentTask(await retryAgentTask(user.id, id, agentId), isAdmin),
      },
      { status: 202 },
    );
  } catch (error) {
    return errorResponse(error, request, isAdmin);
  }
}
