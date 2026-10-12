import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { requireSession } from "@/server/auth/session";
import { ownedExamTask, taskDirectory, taskResult } from "@/server/exams/tasks";
import { errorResponse, AccessError } from "@/server/http/errors";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string; path: string[] }> }) {
  try {
    const { user } = await requireSession(request.headers);
    const { id, path } = await context.params;
    const task = await ownedExamTask(user.id, id);
    const exam = await taskResult(task);
    const key = path.join("/");
    if (!exam || !task.outputKey) throw new AccessError(404, "识别结果尚未生成。");
    const allowed = new Set(["exam.json", "exam.md", "verification.json", ...exam.pages.map((p) => p.key),
      ...exam.assets.flatMap((a) => [a.evidenceKey, ...(a.cleanKey ? [a.cleanKey] : [])]), ...exam.sourceFiles.map((f) => f.key)]);
    if (path.some((part) => !part || part === "." || part === ".." || /[\\\x00]/.test(part)) || !allowed.has(key)) {
      throw new AccessError(404, "文件不存在。");
    }
    const file = join(taskDirectory(id), task.outputKey, key);
    const info = await stat(file);
    const mime = key.endsWith(".jpg") ? "image/jpeg" : key.endsWith(".png") ? "image/png"
      : key.endsWith(".pdf") ? "application/pdf" : key.endsWith(".json") ? "application/json" : "text/markdown; charset=utf-8";
    const download = new URL(request.url).searchParams.has("download") || !mime.startsWith("image/");
    return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, { headers: {
      "Content-Type": mime, "Content-Length": String(info.size), "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff", "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${path.at(-1)}"`,
    } });
  } catch (error) { return errorResponse(error); }
}
