import { requireSession } from "@/server/auth/session";
import { errorResponse } from "@/server/http/errors";
import { readJSON, requireSameOrigin } from "@/server/http/mutations";
import { gradeRequestSchema } from "@/contracts/grading";
import { createGradeTask, listGradeTasks } from "@/server/grading/tasks";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const { user } = await requireSession(request.headers);
    return Response.json({ tasks: await listGradeTasks(user.id, (await context.params).id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    const { user } = await requireSession(request.headers);
    requireSameOrigin(request);
    const input = await readJSON(request, gradeRequestSchema, 32 * 1024 * 1024);
    const task = await createGradeTask(user.id, (await context.params).id, input.submissions);
    return Response.json({ task }, { status: 202 });
  } catch (error) { return errorResponse(error); }
}
