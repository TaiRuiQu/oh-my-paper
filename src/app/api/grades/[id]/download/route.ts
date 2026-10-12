import { requireSession } from "@/server/auth/session";
import { errorResponse, RequestError } from "@/server/http/errors";
import { gradeTaskResult, ownedGradeTask } from "@/server/grading/tasks";
import { exportGradeMarkdown } from "@/server/grading/export";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireSession(request.headers);
    const task = await ownedGradeTask(user.id, (await context.params).id);
    const result = gradeTaskResult(task);
    if (!result || task.status !== "COMPLETED") throw new RequestError(409, "请等待批改完成后下载报告。");
    const markdown = new URL(request.url).searchParams.get("format") === "markdown";
    return new Response(markdown ? exportGradeMarkdown(result) : JSON.stringify(result, null, 2), { headers: {
      "Content-Type": markdown ? "text/markdown; charset=utf-8" : "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="grading-report.${markdown ? "md" : "json"}"`,
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) { return errorResponse(error); }
}
