import { isAdminUser } from "@/server/auth/authorization";
import { answerTaskModelSchema } from "@/contracts/user-ai";
import { requireSession } from "@/server/auth/session";
import { createAgentTask } from "@/server/exams/agent-tasks";
import { requireSameOrigin, readJSON } from "@/server/http/mutations";
import { errorResponse } from "@/server/http/errors";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  let isAdmin = false;
  try {
    const { user } = await requireSession(request.headers);
    isAdmin = await isAdminUser(user.id);
    requireSameOrigin(request);
    const { modelId, reasoningEffort } = await readJSON(request, answerTaskModelSchema, 1024, true);
    return Response.json(
      {
        task: await createAgentTask(
          request,
          user.id,
          (await context.params).id,
          "ANSWER",
          undefined,
          false,
          modelId,
          reasoningEffort,
        ),
      },
      { status: 202 },
    );
  } catch (error) {
    return errorResponse(error, request, isAdmin);
  }
}
