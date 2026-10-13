import { isAdminUser } from "@/server/auth/authorization";
import { presentExamTask } from "@/lib/task-presentation";
import { requireSession } from "@/server/auth/session";
import { ownedExamTask, taskResult, taskSummary } from "@/server/exams/tasks";
import { errorResponse } from "@/server/http/errors";
import { readJSON, requireSameOrigin } from "@/server/http/mutations";
import { examEditSchema } from "@/contracts/exams";
import { deleteExamTask, editExam } from "@/server/exams/edit";
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

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  let isAdmin = false;
  try {
    const { user } = await requireSession(request.headers);
    isAdmin = await isAdminUser(user.id);
    requireSameOrigin(request);
    await deleteExamTask(user.id, (await context.params).id);
    return Response.json({ deleted: true });
  } catch (error) {
    return errorResponse(error, request, isAdmin);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  let isAdmin = false;
  try {
    const { user } = await requireSession(request.headers);
    isAdmin = await isAdminUser(user.id);
    requireSameOrigin(request);
    const exam = await editExam(
      user.id,
      (await context.params).id,
      await readJSON(request, examEditSchema, 2 * 1024 * 1024),
    );
    return Response.json({ exam });
  } catch (error) {
    return errorResponse(error, request, isAdmin);
  }
}
