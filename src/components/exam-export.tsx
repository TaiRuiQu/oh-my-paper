"use client";
import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { EXPORT_FORMATS, type ExportFormat, examExportFilename } from "@/contracts/exam-exports";
export function ExamExport({
  taskId,
  name,
  admin = false,
}: {
  taskId: string;
  name: string;
  admin?: boolean;
}) {
  const [pending, setPending] = useState<ExportFormat | null>(null),
    [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function download(format: ExportFormat) {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(format);
    setError("");
    try {
      const response = await fetch(
        `/api/${admin ? "admin/" : ""}exams/${taskId}/export?format=${format}`,
        { cache: "no-store", signal: controller.signal },
      );
      if (!response.ok) {
        const problem = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(problem.error ?? "导出失败，请稍后重试。");
      }
      const blob = await response.blob();
      controller.signal.throwIfAborted();
      const url = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = url;
      link.download = examExportFilename(name, format);
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      if (!controller.signal.aborted)
        setError(error instanceof Error ? error.message : "导出失败，请稍后重试。");
    } finally {
      if (request.current === controller) request.current = null;
      if (!controller.signal.aborted) setPending(null);
    }
  }
  return (
    <div
      className="exam-export-controls"
      role="group"
      aria-label="导出试卷"
      aria-busy={pending !== null}
    >
      <div className="inline-actions">
        {(["pdf", "docx"] as const).map((format) => (
          <button
            type="button"
            className="button secondary"
            key={format}
            disabled={pending !== null}
            onClick={() => void download(format)}
          >
            <Download size={16} aria-hidden="true" />
            {pending === format
              ? `正在导出 ${EXPORT_FORMATS[format].label}…`
              : `导出 ${EXPORT_FORMATS[format].label}`}
          </button>
        ))}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
