"use client";
import { useState } from "react";
import { Printer, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CardTemplate } from "@/contracts/platform";
import { renderCardSvg } from "@/lib/card-svg";
import { printClientDocument } from "@/lib/client-print";

export function DocumentExport({
  paperId,
  template,
  title,
}: {
  paperId?: string;
  template?: CardTemplate;
  title?: string;
}) {
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState("");
  async function print() {
    setBusy("print");
    setError("");
    try {
      let content: HTMLElement;
      if (template) {
        content = document.createElement("div");
        content.innerHTML = Array.from(
          { length: template.layout.pageCount },
          (_, index) =>
            `<div class="p-card-print-page">${renderCardSvg(template, index + 1)}</div>`,
        ).join("");
      } else {
        const pages = document.querySelector<HTMLElement>(".p-document-pages");
        if (!pages) throw new Error("请先打开文档预览，再打印。");
        content = pages;
      }
      await printClientDocument({
        content,
        title: template?.name ?? title ?? document.title,
        paperSize: template?.layout.paperSize ?? (content.dataset.paperSize === "A3" ? "A3" : "A4"),
        orientation:
          template?.layout.orientation ??
          (content.dataset.orientation === "landscape" ? "landscape" : "portrait"),
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : "无法打开打印窗口，请重试。");
    } finally {
      setBusy(undefined);
    }
  }
  async function download(format: "docx") {
    setBusy(format);
    setError("");
    try {
      const params = new URLSearchParams({
        format,
        paperId: paperId!,
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
        <Button disabled={!!busy} onClick={() => void print()}>
          <Printer />
          {busy === "print" ? "正在准备打印…" : "打印 / 保存 PDF"}
        </Button>
      </div>
      <small className="p-print-hint">
        使用本机字体；在打印窗口选择「另存为 PDF」，缩放设为 100%，关闭页眉页脚。
      </small>
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}
