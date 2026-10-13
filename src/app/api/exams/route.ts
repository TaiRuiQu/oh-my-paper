import { presentExamTask } from "@/lib/task-presentation";
import { isAdminUser } from "@/server/auth/authorization";
import { requireSession } from "@/server/auth/session";
import { createExamTask, listExamTasks } from "@/server/exams/tasks";
import { errorResponse } from "@/server/http/errors";
import { requireSameOrigin } from "@/server/http/mutations";
export const runtime = "nodejs";
export async function GET(request: Request) {
  let isAdmin = false;
  try {
    const { user } = await requireSession(request.headers);
    isAdmin = await isAdminUser(user.id);
    return Response.json(
      { tasks: (await listExamTasks(user.id)).map((task) => presentExamTask(task, isAdmin)) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error, request, isAdmin);
  }
}
export async function POST(request: Request) {
  let isAdmin = false;
  try {
    const { user } = await requireSession(request.headers);
    isAdmin = await isAdminUser(user.id);
    requireSameOrigin(request);
    return Response.json({ task: await createExamTask(request, user.id) }, { status: 202 });
  } catch (error) {
    return errorResponse(error, request, isAdmin);
  }
}
