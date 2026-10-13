import "server-only";
import { join } from "node:path";
import type { Exam } from "@/contracts/exams";
import type { ExamTask } from "@/generated/prisma/client";
import { type ExportFormat, EXPORT_FORMATS, examExportFilename } from "@/contracts/exam-exports";
import { AppError } from "@/server/errors";
import { RequestError } from "@/server/http/errors";
import { taskDirectory } from "../tasks";
import { buildExportDocument } from "./document";
import { withExportPage, formulaImages } from "./browser";
import { exportWord } from "./word";
let active = 0;
export async function exportExam(
  task: ExamTask,
  exam: Exam,
  format: ExportFormat,
  signal?: AbortSignal,
) {
  if (task.status !== "COMPLETED" || !task.outputKey)
    throw new RequestError(409, "请等待试卷解析完成后再导出。");
  if (active >= 2) throw new RequestError(429, "正在导出的试卷较多，请稍后重试。");
  active++;
  try {
    const document = await buildExportDocument(
      exam,
      join(taskDirectory(task.id), task.outputKey),
      signal,
      task.id,
    );
    const data =
      format === "docx" && !document.formulas.size
        ? await exportWord(document, new Map())
        : await withExportPage(document, signal, async (page) =>
            format === "pdf"
              ? Buffer.from(
                  await page.pdf({
                    printBackground: true,
                    preferCSSPageSize: true,
                    waitForFonts: true,
                    timeout: 60_000,
                  }),
                )
              : exportWord(document, await formulaImages(page, document, signal)),
          );
    signal?.throwIfAborted();
    return {
      data,
      filename: examExportFilename(exam.name, format),
      mime: EXPORT_FORMATS[format].mime,
    };
  } catch (cause) {
    signal?.throwIfAborted();
    if (cause instanceof AppError) throw cause;
    throw new AppError("试卷导出失败，请稍后重试。", "EXAM_EXPORT_FAILED", 503, { cause });
  } finally {
    active--;
  }
}
export function exportResponse(result: Awaited<ReturnType<typeof exportExam>>) {
  return new Response(new Uint8Array(result.data), {
    headers: {
      "Content-Type": result.mime,
      "Content-Length": String(result.data.length),
      "Content-Disposition": `attachment; filename="exam.${result.filename.endsWith(".pdf") ? "pdf" : "docx"}"; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
