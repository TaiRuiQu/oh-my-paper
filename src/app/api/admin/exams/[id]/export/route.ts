import { requireAdmin } from "@/server/auth/authorization";
import { reviewExamTask } from "@/server/admin/exams";
import { exportFormatSchema } from "@/contracts/exam-exports";
import { taskResult } from "@/server/exams/tasks";
import { exportExam, exportResponse } from "@/server/exams/export";
import { errorResponse, RequestError } from "@/server/http/errors";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  let isAdmin = false;
  try {
    await requireAdmin(request.headers);
    isAdmin = true;
    const format = exportFormatSchema.safeParse(new URL(request.url).searchParams.get("format"));
    if (!format.success) throw new RequestError(400, "请选择 PDF 或 Word 导出格式。");
    const task = await reviewExamTask((await context.params).id);
    const exam = await taskResult(task);
    if (!exam) throw new RequestError(409, "请等待试卷解析完成后再导出。");
    return exportResponse(await exportExam(task, exam, format.data, request.signal));
  } catch (error) {
    return errorResponse(error, request, isAdmin);
  }
}
