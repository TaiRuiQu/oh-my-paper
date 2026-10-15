"use client";
import type { ScanUploadPage } from "@/contracts/uploads";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { Box, Paper } from "@/contracts/platform";
import { Field } from "./primitives";
type ScanBox = Box & { itemId: string };
export function WorkbookCrop({
  files,
  paper,
  boxes,
  onChange,
  onAdd,
}: {
  files: ScanUploadPage[];
  paper: Paper;
  boxes: ScanBox[];
  onChange: (boxes: ScanBox[]) => void;
  onAdd?: () => void;
}) {
  const [page, setPage] = useState(1),
    [itemId, setItemId] = useState(paper.items[0]?.id ?? ""),
    [preview, setPreview] = useState<{
      file: ScanUploadPage;
      url: string;
      width: number;
      height: number;
    } | null>(null),
    [draft, setDraft] = useState<Box | null>(null);
  const start = useRef<{ x: number; y: number; pointer: number } | null>(null);
  const actualPage = Math.min(page, files.length);
  const file = files[actualPage - 1];
  useEffect(() => {
    if (!file) return;
    let alive = true;
    const url = "assetUrl" in file ? file.assetUrl : URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => {
      if (alive) setPreview({ file, url, width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      if (alive) setPreview(null);
    };
    img.src = url;
    return () => {
      alive = false;
      if (!("assetUrl" in file)) URL.revokeObjectURL(url);
    };
  }, [file]);
  const point = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
  };
  function finish(event: React.PointerEvent<HTMLDivElement>) {
    const origin = start.current;
    if (!origin) return;
    const p = point(event),
      box = {
        page: actualPage,
        x: Math.min(origin.x, p.x),
        y: Math.min(origin.y, p.y),
        width: Math.abs(p.x - origin.x),
        height: Math.abs(p.y - origin.y),
      };
    start.current = null;
    setDraft(null);
    if (box.width > 0.005 && box.height > 0.005) {
      onChange([...boxes.filter((b) => b.itemId !== itemId), { ...box, itemId }]);
      const index = paper.items.findIndex((i) => i.id === itemId);
      if (paper.items[index + 1]) setItemId(paper.items[index + 1].id);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }
  if (!files.length) return <p className="p-muted">先选择扫描图片或 PDF，再按页逐题框选。</p>;
  return (
    <div className="p-crop-editor">
      <div className="p-form-grid">
        <Field label="框选页面">
          <select value={actualPage} onChange={(e) => setPage(Number(e.target.value))}>
            {files.map((f, i) => (
              <option key={i} value={i + 1}>
                第 {i + 1} 页 · {f.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="当前框选题目">
          <select value={itemId} onChange={(e) => setItemId(e.target.value)}>
            {paper.items.map((item, i) => (
              <option key={item.id} value={item.id}>
                第 {i + 1} 题{boxes.some((b) => b.itemId === item.id) ? "（已框选，可重画）" : ""}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="p-actions">
        {paper.items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            className="button secondary"
            disabled={boxes.some((box) => box.itemId === item.id)}
            onClick={() => {
              setItemId(item.id);
              onChange([
                ...boxes,
                { itemId: item.id, page: actualPage, x: 0.05, y: 0.1, width: 0.9, height: 0.2 },
              ]);
              onAdd?.();
            }}
          >
            添加第 {index + 1} 题答题区域
          </button>
        ))}
      </div>
      <p className="p-muted">
        在图片上按住并拖动，框出当前题的完整作答。每题框选后自动切换下一题；也可在下方用坐标精确调整。
      </p>
      {file && preview?.file === file && (
        <div
          className="p-crop-surface"
          style={{ aspectRatio: `${preview.width}/${preview.height}` }}
          role="group"
          aria-label="练习册原图框选区域"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            const p = point(e);
            start.current = { ...p, pointer: e.pointerId };
            e.currentTarget.setPointerCapture(e.pointerId);
            setDraft({ page: actualPage, ...p, width: 0, height: 0 });
          }}
          onPointerMove={(e) => {
            const origin = start.current;
            if (!origin || origin.pointer !== e.pointerId) return;
            const p = point(e);
            setDraft({
              page: actualPage,
              x: Math.min(origin.x, p.x),
              y: Math.min(origin.y, p.y),
              width: Math.abs(p.x - origin.x),
              height: Math.abs(p.y - origin.y),
            });
          }}
          onPointerUp={finish}
          onPointerCancel={() => {
            start.current = null;
            setDraft(null);
          }}
          onLostPointerCapture={() => {
            start.current = null;
            setDraft(null);
          }}
        >
          <Image
            fill
            unoptimized
            src={preview.url}
            alt={`第 ${actualPage} 页作业扫描原图`}
            sizes="(max-width: 760px) 100vw, 700px"
            draggable={false}
          />
          {boxes
            .filter((b) => b.page === actualPage)
            .map((b) => (
              <div
                key={b.itemId}
                className={`p-crop-box${b.itemId === itemId ? " active" : ""}`}
                style={{
                  left: `${b.x * 100}%`,
                  top: `${b.y * 100}%`,
                  width: `${b.width * 100}%`,
                  height: `${b.height * 100}%`,
                }}
              >
                <span>第 {paper.items.findIndex((i) => i.id === b.itemId) + 1} 题</span>
              </div>
            ))}
          {draft && (
            <div
              className="p-crop-box active"
              style={{
                left: `${draft.x * 100}%`,
                top: `${draft.y * 100}%`,
                width: `${draft.width * 100}%`,
                height: `${draft.height * 100}%`,
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
