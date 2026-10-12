import { requireSession } from "@/server/auth/session";
import { ownedExamTask, taskResult, taskSummary } from "@/server/exams/tasks";
import { errorResponse } from "@/server/http/errors";
import { renderExamMath } from "@/server/exams/math";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireSession(request.headers);
    const task = await ownedExamTask(user.id, (await context.params).id);
    const exam = await taskResult(task);
    return Response.json({ task: taskSummary(task), exam, mathImages: exam ? await renderExamMath(exam) : {} }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
