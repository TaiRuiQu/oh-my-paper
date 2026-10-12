import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { requireSession } from "@/server/auth/session";
import { ownedGradeTask } from "@/server/grading/tasks";
import { taskDirectory } from "@/server/exams/tasks";
import { AccessError, errorResponse } from "@/server/http/errors";
import type { DigitalExam } from "@/contracts/exams";

export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; page: string }> },
) {
  try {
    const { user } = await requireSession(request.headers);
    const { id, page } = await context.params;
    const task = await ownedGradeTask(user.id, id);
    const input = task.input as unknown as { exam: DigitalExam };
    const source = /^\d+$/.test(page)
      ? input.exam.pages.find((p) => p.page === Number(page))
      : null;
    if (!source || !/^pages\/\d{3}\.jpg$/.test(source.key))
      throw new AccessError(404, "原图不存在。");
    const path = join(taskDirectory(task.examTaskId), task.examOutputKey, source.key);
    const info = await stat(path);
    return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, {
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(info.size),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": 'inline; filename="source-page.jpg"',
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
