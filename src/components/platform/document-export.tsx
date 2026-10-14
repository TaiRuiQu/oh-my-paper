"use client";
import { useState } from "react";
import { Download, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";

export function DocumentExport({ paperId, templateId }: { paperId?: string; templateId?: string }) {
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState("");
  async function download(format: "pdf" | "docx") {
    setBusy(format);
    setError("");
    try {
      const params = new URLSearchParams({
        format,
        ...(paperId ? { paperId } : { templateId: templateId! }),
      });
      const response = await fetch(`/api/platform/print?${params}`, { cache: "no-store" });
      if (!response.ok) {
        const problem = await response.json();
        throw new Error(problem.error ?? "导出失败，请重试。");
      }
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = encoded ? decodeURIComponent(encoded) : `教学文档.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) {
      setError(error instanceof Error ? error.message : "导出失败，请重试。");
    } finally {
      setBusy(undefined);
    }
  }
  return (
    <div>
      <div className="p-actions">
        {paperId && (
          <Button variant="outline" disabled={!!busy} onClick={() => void download("docx")}>
            <FileText />
            {busy === "docx" ? "正在导出 Word…" : "导出 Word"}
          </Button>
        )}
        <Button disabled={!!busy} onClick={() => void download("pdf")}>
          <Download />
          {busy === "pdf" ? "正在导出 PDF…" : "导出 PDF"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}
