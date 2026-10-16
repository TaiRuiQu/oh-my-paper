"use client";
import {
  cloneElement,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type ReactElement,
} from "react";
import {
  documentFont,
  orderedDocumentBlocks,
  DOCUMENT_DEFAULTS,
  DOCUMENT_COLUMN_GAP_MM,
  DOCUMENT_FOOTER_MM,
  DOCUMENT_PX_PER_MM,
} from "@/lib/document-layout";
import { renderPrintRichText } from "@/lib/document-text";
import type { DocumentLayout } from "@/contracts/platform";
import { Button } from "@/components/ui/button";
import { ZoomIn, ZoomOut } from "lucide-react";
import { usePaperZoom } from "./use-paper-zoom";

export function PaperText({
  value,
  onChange,
  label,
  title = false,
  readOnly = false,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  title?: boolean;
  readOnly?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current && document.activeElement !== ref.current)
      ref.current.innerHTML = renderPrintRichText(value).replaceAll("\n", "<br>");
  }, [value]);
  return (
    <div
      ref={ref}
      contentEditable={readOnly ? undefined : "plaintext-only"}
      role={readOnly ? undefined : "textbox"}
      aria-label={readOnly ? undefined : label}
      aria-multiline={readOnly ? undefined : !title}
      suppressContentEditableWarning
      className={`p-document-text${title ? " p-document-title" : ""}`}
      data-placeholder={readOnly ? undefined : title ? "输入标题" : "点击此处输入内容"}
      onFocus={(e) => {
        if (readOnly) return;
        e.currentTarget.innerText = value;
      }}
      onBlur={(e) => {
        e.currentTarget.innerHTML = renderPrintRichText(e.currentTarget.innerText).replaceAll(
          "\n",
          "<br>",
        );
      }}
      onInput={(e) => onChange(e.currentTarget.innerText)}
    />
  );
}

type Block = { key: string; content: ReactNode; pageBreakBefore?: boolean };
export function DocumentCanvas({
  layout,
  header,
  blocks: questionBlocks,
  empty,
  onTextBlocksChange,
}: {
  layout: DocumentLayout;
  header: ReactNode;
  blocks: Block[];
  empty?: ReactNode;
  onTextBlocksChange?: (blocks: NonNullable<DocumentLayout["textBlocks"]>) => void;
}) {
  const blocks = orderedDocumentBlocks<Block>(questionBlocks, layout, (block) => ({
    key: block.id,
    pageBreakBefore: block.pageBreakBefore,
    content: (
      <article className="p-document-free-text">
        {onTextBlocksChange && (
          <div className="p-text-block-tools">
            <select
              aria-label="文字位置"
              value={block.beforeQuestionId ?? ""}
              onChange={(e) =>
                onTextBlocksChange(
                  (layout.textBlocks ?? []).map((b) =>
                    b.id === block.id ? { ...b, beforeQuestionId: e.target.value || undefined } : b,
                  ),
                )
              }
            >
              <option value="">文档末尾</option>
              {questionBlocks.map((q, n) => (
                <option key={q.key} value={q.key}>
                  第 {n + 1} 题前
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                onTextBlocksChange((layout.textBlocks ?? []).filter((b) => b.id !== block.id))
              }
            >
              删除文字
            </Button>
          </div>
        )}
        <PaperText
          label="自由文字"
          readOnly={!onTextBlocksChange}
          value={block.text}
          onChange={(text) =>
            onTextBlocksChange?.(
              (layout.textBlocks ?? []).map((b) => (b.id === block.id ? { ...b, text } : b)),
            )
          }
        />
      </article>
    ),
  }));
  const host = useRef<HTMLDivElement>(null);
  const printedPages = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLFieldSetElement>(null);
  const [pages, setPages] = useState<number[][][]>([[blocks.map((_, n) => n)]]);
  const physical = layout.paperSize === "A3" ? [297, 420] : [210, 297];
  const [pageWidthMm, pageHeightMm] =
    layout.orientation === "landscape" ? physical.toReversed() : physical;
  const width = pageWidthMm * DOCUMENT_PX_PER_MM;
  const { zoom, setZoom, fitToWidth } = usePaperZoom(host, width);
  const height = pageHeightMm * DOCUMENT_PX_PER_MM;
  const margin = (layout.marginMm ?? DOCUMENT_DEFAULTS.marginMm) * DOCUMENT_PX_PER_MM;
  const columnGap = DOCUMENT_COLUMN_GAP_MM * DOCUMENT_PX_PER_MM;
  const footerHeight = DOCUMENT_FOOTER_MM * DOCUMENT_PX_PER_MM;
  const columns = layout.columns;
  const signature = blocks.map((b) => `${b.key}:${b.pageBreakBefore}`).join("|");
  useEffect(() => {
    const element = measure.current;
    if (!element) return;
    let timer: ReturnType<typeof setTimeout>;
    const paginate = () => {
      const heights = new Map(
        Array.from(element.querySelectorAll<HTMLElement>("[data-measure-block]")).map((block) => [
          Number(block.dataset.measureBlock),
          block.getBoundingClientRect().height,
        ]),
      );
      const headerHeight =
        element.querySelector<HTMLElement>("[data-measure-header]")?.getBoundingClientRect()
          .height ?? 0;
      const next: number[][][] = [Array.from({ length: columns }, () => [])];
      let column = 0;
      let used = 0;
      let capacity = height - 2 * margin - footerHeight - headerHeight;
      blocks.forEach((block, n) => {
        const blockHeight = heights.get(n) ?? 100;
        const hasPageContent = next.at(-1)!.some((entries) => entries.length);
        if (hasPageContent && block.pageBreakBefore) {
          next.push(Array.from({ length: columns }, () => []));
          column = 0;
          used = 0;
          capacity = height - 2 * margin - footerHeight;
        } else if (used > 0 && used + blockHeight > capacity) {
          column++;
          used = 0;
          if (column === columns) {
            next.push(Array.from({ length: columns }, () => []));
            column = 0;
            capacity = height - 2 * margin - footerHeight;
          }
        }
        next.at(-1)![column].push(n);
        used += blockHeight;
      });
      setPages((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next));
    };
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(paginate, 120);
    });
    element
      .querySelectorAll("[data-measure-block], [data-measure-header]")
      .forEach((block) => observer.observe(block));
    paginate();
    void document.fonts.ready.then(paginate);
    document.fonts.addEventListener("loadingdone", paginate);
    const currentPages = printedPages.current;
    currentPages?.addEventListener("omp:prepare-print", paginate);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
      document.fonts.removeEventListener("loadingdone", paginate);
      currentPages?.removeEventListener("omp:prepare-print", paginate);
    };
    // React nodes update in place; ResizeObserver recalculates their actual measured heights.
  }, [signature, width, height, margin, columns, blocks, footerHeight]);
  const style = {
    "--document-width": `${width}px`,
    "--document-height": `${height}px`,
    "--document-margin": `${margin}px`,
    "--document-font-family": documentFont(layout.fontFamily),
    "--document-font": `${(layout.fontSizePt ?? DOCUMENT_DEFAULTS.fontSizePt) * (96 / 72)}px`,
    "--document-line": layout.lineHeight ?? DOCUMENT_DEFAULTS.lineHeight,
    "--document-columns": columns,
    "--document-column-gap": `${columnGap}px`,
    "--document-footer": `${footerHeight}px`,
    "--document-measure-width": `${(width - 2 * margin - (columns - 1) * columnGap) / columns}px`,
    zoom,
  } as CSSProperties;
  return (
    <div className="p-document-area">
      <fieldset
        ref={measure}
        className="p-document-measure"
        aria-hidden="true"
        inert
        disabled
        style={{ ...style, zoom: 1 }}
      >
        <div data-measure-header>{header}</div>
        {blocks.map((block, index) => (
          <div key={block.key} data-measure-block={index}>
            {isValidElement(block.content)
              ? cloneElement(block.content as ReactElement<{ id?: string }>, { id: undefined })
              : block.content}
          </div>
        ))}
      </fieldset>
      <div className="p-document-status">
        <span>
          {layout.paperSize} · {layout.orientation === "landscape" ? "横向" : "纵向"} ·{" "}
          {pages.length} 页 · {columns} 栏
        </span>
        <div className="p-actions">
          <Button
            className="p-mobile-document-zoom"
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setZoom(1);
            }}
          >
            100% 编辑
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="缩小纸张"
            disabled={zoom <= 0.3}
            onClick={() => {
              setZoom(Math.max(0.3, zoom - 0.1));
            }}
          >
            <ZoomOut />
          </Button>
          <span>{Math.round(zoom * 100)}%</span>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="放大纸张"
            onClick={() => {
              setZoom(zoom + 0.1);
            }}
          >
            <ZoomIn />
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={fitToWidth}>
            适应宽度
          </Button>
        </div>
      </div>
      <div
        className="p-document-scroll"
        ref={host}
        role="region"
        aria-label="文档预览"
        tabIndex={0}
      >
        <div
          ref={printedPages}
          className="p-document-pages"
          style={style}
          data-paper-size={layout.paperSize}
          data-orientation={layout.orientation ?? "portrait"}
        >
          {pages.map((pageColumns, page) => (
            <div className="p-document-page" key={page}>
              {page === 0 && <div data-document-header>{header}</div>}
              <div className="p-document-columns">
                {pageColumns.map((indices, column) => (
                  <div className="p-document-column" key={column}>
                    {!blocks.length && page === 0 && column === 0 && empty}
                    {indices.map(
                      (index) =>
                        blocks[index] && (
                          <div key={blocks[index].key} data-document-block={index}>
                            {blocks[index].content}
                          </div>
                        ),
                    )}
                  </div>
                ))}
              </div>
              <footer>
                {page + 1} / {pages.length}
              </footer>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
