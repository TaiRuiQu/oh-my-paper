import { isAdminUser } from "@/server/auth/authorization";
import { presentWorkflow } from "@/lib/task-presentation";
import { requireSession } from "@/server/auth/session";
import { workflowDetail } from "@/server/exams/workflows";
import { errorResponse } from "@/server/http/errors";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  let isAdmin = false;
  try {
    const { user } = await requireSession(request.headers);
    isAdmin = await isAdminUser(user.id);
    return Response.json(
      {
        workflow: presentWorkflow(
          await workflowDetail(user.id, (await context.params).id),
          isAdmin,
        ),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error, request, isAdmin);
  }
}
