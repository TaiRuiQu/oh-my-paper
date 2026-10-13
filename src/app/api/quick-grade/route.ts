import { isAdminUser } from "@/server/auth/authorization";
import { requireSession } from "@/server/auth/session";
import { createExamTask } from "@/server/exams/tasks";
import { getDb } from "@/server/db/client";
import { requireSameOrigin } from "@/server/http/mutations";
import { errorResponse } from "@/server/http/errors";
export const runtime = "nodejs";
export async function POST(request: Request) {
  let isAdmin = false;
  try {
    const { user } = await requireSession(request.headers);
    isAdmin = await isAdminUser(user.id);
    requireSameOrigin(request);
    const task = await createExamTask(request, user.id, true);
    const workflow = await getDb().gradingWorkflow.findFirstOrThrow({
      where: { sourceId: task.id, userId: user.id, kind: "QUICK" },
      select: { id: true },
    });
    return Response.json({ workflow }, { status: 202 });
  } catch (error) {
    return errorResponse(error, request, isAdmin);
  }
}
