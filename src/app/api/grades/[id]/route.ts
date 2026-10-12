import { requireSession } from "@/server/auth/session";
import { errorResponse } from "@/server/http/errors";
import { readJSON, requireSameOrigin } from "@/server/http/mutations";
import { gradeReviewSchema } from "@/contracts/grading";
import { gradeTaskResult, gradeTaskSummary, ownedGradeTask, reviewGradeTask } from "@/server/grading/tasks";
import { renderMathText } from "@/server/exams/math";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const { user } = await requireSession(request.headers);
    const task = await ownedGradeTask(user.id, (await context.params).id);
    const result = gradeTaskResult(task);
    const mathImages = result ? await renderMathText(result.questions.flatMap((q) => [q.questionText, q.studentAnswer, q.expectedAnswer, q.feedback])) : {};
    return Response.json({ task: gradeTaskSummary(task), result, mathImages }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
export async function PATCH(request: Request, context: Context) {
  try {
    const { user } = await requireSession(request.headers);
    requireSameOrigin(request);
    const result = await reviewGradeTask(user.id, (await context.params).id, await readJSON(request, gradeReviewSchema));
    return Response.json({ result });
  } catch (error) { return errorResponse(error); }
}
