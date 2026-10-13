import { requireAdmin } from "@/server/auth/authorization";
import { logError } from "@/server/logger";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { reviewExamTask } from "@/server/admin/exams";
import { taskDirectory, taskResult } from "@/server/exams/tasks";
import { errorResponse, AccessError } from "@/server/http/errors";
import { examMaterials } from "@/lib/exam-materials";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; path: string[] }> },
) {
  let isAdmin = false;
  try {
    await requireAdmin(request.headers);
    isAdmin = true;
    const { id, path } = await context.params;
    const task = await reviewExamTask(id),
      exam = await taskResult(task);
    const key = path.join("/");
    if (!exam || !task.outputKey) throw new AccessError(404, "解析结果尚未生成。");
    const allowed = new Set(["exam.json", ...examMaterials(exam).map((material) => material.key)]);
    if (
      path.some((part) => !part || part === "." || part === ".." || /[\\\x00]/.test(part)) ||
      !allowed.has(key)
    )
      throw new AccessError(404, "文件不存在。");
    const file = join(taskDirectory(id), task.outputKey, key),
      info = await stat(file);
    const stream = createReadStream(file);
    stream.on("error", (error) => {
      logError("exam.file.stream.failed", error, { taskId: id, resource: key });
    });
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      headers: {
        "Content-Type": key.endsWith(".jpg") ? "image/jpeg" : "application/json",
        "Content-Length": String(info.size),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `${key === "exam.json" ? "attachment" : "inline"}; filename="${path.at(-1)}"`,
      },
    });
  } catch (error) {
    return errorResponse(error, request, isAdmin);
  }
}
