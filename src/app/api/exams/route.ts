import { requireSession } from "@/server/auth/session";
import { createExamTask, listExamTasks } from "@/server/exams/tasks";
import { errorResponse } from "@/server/http/errors";
import { requireSameOrigin } from "@/server/http/mutations";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const { user } = await requireSession(request.headers);
    return Response.json({ tasks: await listExamTasks(user.id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const { user } = await requireSession(request.headers);
    requireSameOrigin(request);
    return Response.json({ task: await createExamTask(request, user.id) }, { status: 202 });
  } catch (error) { return errorResponse(error); }
}
