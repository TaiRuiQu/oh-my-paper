import { isAdminUser } from "@/server/auth/authorization";
import { presentExamTask } from "@/lib/task-presentation";
import { requireSession } from "@/server/auth/session";
import { ownedExamTask, taskResult, taskSummary } from "@/server/exams/tasks";
import { errorResponse } from "@/server/http/errors";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  let isAdmin = false;
  try {
    const { user } = await requireSession(request.headers);
    isAdmin = await isAdminUser(user.id);
    const task = await ownedExamTask(user.id, (await context.params).id);
    const exam = await taskResult(task);
    return Response.json(
      {
        task: presentExamTask(taskSummary(task), isAdmin),
        exam,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error, request, isAdmin);
  }
}
