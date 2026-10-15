"use client";
import { useState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { printClientDocument } from "@/lib/client-print";
import { apiRequest } from "@/lib/http-client";
import { useDomain } from "./domain-provider";
import { Field } from "./primitives";

export function BarcodeLabels({ pageCount }: { pageCount: number }) {
  const { state } = useDomain();
  const [open, setOpen] = useState(false);
  const [classroomId, setClassroomId] = useState(state.classrooms[0]?.id ?? "");
  const [copies, setCopies] = useState(Math.min(20, pageCount));
  const [pages, setPages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function generate() {
    setBusy(true);
    setError("");
    setPages([]);
    try {
      const params = new URLSearchParams({ classroomId, copies: String(copies) });
      const result = await apiRequest<{ pages: string[] }>(`/api/platform/barcodes?${params}`);
      setPages(result.pages);
    } catch (error) {
      setError(error instanceof Error ? error.message : "条码生成失败，请重试。");
    } finally {
      setBusy(false);
    }
  }
  async function print() {
    setBusy(true);
    setError("");
    try {
      const content = document.createElement("div");
      content.innerHTML = pages
        .map((svg) => `<div class="p-card-print-page">${svg}</div>`)
        .join("");
      await printClientDocument({
        content,
        title: "考号条码标签",
        paperSize: "A4",
        orientation: "portrait",
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : "无法打开打印窗口，请重试。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Printer />
        打印条码标签
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="p-card-preview-sheet p-barcode-label-sheet">
          <SheetHeader>
            <SheetTitle>考号条码标签</SheetTitle>
            <SheetDescription>
              按班级生成独立的 A4 标签纸，裁切后粘贴到每页答题卡的贴码区。
            </SheetDescription>
          </SheetHeader>
          <div className="p-maker-fields">
            <Field label="班级">
              <select
                value={classroomId}
                disabled={busy}
                onChange={(event) => {
                  setClassroomId(event.target.value);
                  setPages([]);
                }}
              >
                {!state.classrooms.length && <option value="">暂无可用班级</option>}
                {state.classrooms.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}（{row.students.length} 人）
                  </option>
                ))}
              </select>
            </Field>
            <Field label="每人份数" hint={`当前答题卡共 ${pageCount} 页，每页粘贴一枚。`}>
              <Input
                type="number"
                min={1}
                max={20}
                value={copies}
                disabled={busy}
                onChange={(event) => {
                  setCopies(Number(event.target.value));
                  setPages([]);
                }}
              />
            </Field>
            <div className="p-actions">
              <Button
                type="button"
                disabled={
                  busy || !classroomId || !Number.isInteger(copies) || copies < 1 || copies > 20
                }
                onClick={() => void generate()}
              >
                {busy ? "正在准备…" : "生成标签纸"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy || !pages.length}
                onClick={() => void print()}
              >
                <Printer />
                打印 / 保存 PDF
              </Button>
            </div>
            {error && (
              <p className="field-error" role="alert">
                {error}
              </p>
            )}
            {!!pages.length && (
              <p role="status">共 {pages.length} 张 A4 标签纸；请按 100% 打印，关闭页眉页脚。</p>
            )}
          </div>
          {!!pages.length && (
            <div className="p-card-preview" role="region" aria-label="条码标签纸预览" tabIndex={0}>
              {pages.map((svg, index) => (
                <div
                  key={index}
                  className="p-barcode-label-page"
                  dangerouslySetInnerHTML={{ __html: svg }}
                />
              ))}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
