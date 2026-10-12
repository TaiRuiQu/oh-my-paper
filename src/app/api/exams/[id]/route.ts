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

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireSession(request.headers);
    const { readJSON, requireSameOrigin } = await import("@/server/http/mutations");
    const { examEditSchema } = await import("@/contracts/exam-edits");
    const { editQuestion } = await import("@/server/exams/edit");
    requireSameOrigin(request);
    await editQuestion(user.id, (await context.params).id, await readJSON(request, examEditSchema));
    return Response.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
