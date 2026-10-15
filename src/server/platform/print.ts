import type { CardTemplate, Paper } from "./types";
import { renderCardSvg } from "@/lib/card-svg";
import {
  documentFont,
  orderedDocumentBlocks,
  DOCUMENT_DEFAULTS,
  DOCUMENT_COLUMN_GAP_MM,
  DOCUMENT_FOOTER_MM,
  documentAnswerLines,
} from "@/lib/document-layout";
export { renderCardSvg } from "@/lib/card-svg";
export { escapePrintText, renderPrintRichText } from "@/lib/document-text";
import { escapePrintText, renderPrintRichText } from "@/lib/document-text";
function imageUrl(url: string): string {
  if (!/^(https?:\/\/|\/api\/|data:image\/(png|jpeg|webp);base64,)/.test(url))
    throw new Error("题目图片地址不受支持");
  return escapePrintText(url);
}
export function renderCardHtml(template: CardTemplate): string {
  const [short, long] = template.layout.paperSize === "A3" ? [297, 420] : [210, 297];
  const [mmWidth, mmHeight] =
    template.layout.orientation === "landscape" ? [long, short] : [short, long];
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${escapePrintText(template.name)}</title><style>@page{size:${template.layout.paperSize ?? "A4"} ${template.layout.orientation ?? "portrait"};margin:0}body{margin:0}svg{display:block;width:${mmWidth}mm;height:${mmHeight}mm;break-after:page}svg:last-child{break-after:auto}@media screen{body{background:#eee}svg{margin:12px auto}}</style><body>${Array.from({ length: template.layout.pageCount }, (_, i) => renderCardSvg(template, i + 1)).join("")}</body></html>`;
}
export function renderPaperHtml(paper: Paper): string {
  const margin = paper.layout.marginMm ?? DOCUMENT_DEFAULTS.marginMm;
  const rich = (value: string) =>
    `<div class="p-document-text">${renderPrintRichText(value)}</div>`;
  const options = (entries: { label: string; text: string }[]) =>
    entries.length
      ? `<div class="p-document-options">${entries
          .map(
            (o) =>
              `<div class="p-document-option"><span>${escapePrintText(o.label)}.</span>${rich(o.text)}</div>`,
          )
          .join("")}</div>`
      : "";
  const sections: string[][] = [[]];
  const questionBlocks = paper.items.map((item, index) => ({ key: item.questionId, item, index }));
  type PrintBlock = {
    key: string;
    item?: Paper["items"][number];
    index?: number;
    text?: string;
    pageBreakBefore?: boolean;
  };
  orderedDocumentBlocks<PrintBlock>(questionBlocks, paper.layout, (block) => ({
    key: block.id,
    text: block.text,
    pageBreakBefore: block.pageBreakBefore,
  })).forEach((block) => {
    if (!block.item) {
      if (block.pageBreakBefore && sections.at(-1)!.length) sections.push([]);
      sections.at(-1)!.push(rich(block.text ?? ""));
      return;
    }
    const item = block.item,
      index = block.index!;
    const q = item.snapshot.content;
    const settings = paper.layout.questionLayouts?.[item.questionId];
    if (settings?.pageBreakBefore && sections.at(-1)!.length) sections.push([]);
    const answerLines = documentAnswerLines(paper.layout, item.questionId);
    const homework = paper.kind === "HOMEWORK";
    const space =
      homework && answerLines > 0
        ? `<div class="p-workbook-lines">${Array.from({ length: answerLines }, () => "<div></div>").join("")}</div>`
        : "";
    const question = `<article class="${homework ? "p-workbook-exercise" : "p-paper-question"}"${homework ? ` style="padding-bottom:${settings?.spaceAfterMm ?? 2}mm"` : ""}><div class="p-document-question-body"><div class="p-document-stem"><strong class="p-document-question-number">${index + 1}.</strong>${rich(q.stem)}</div>${q.images.map((url) => `<img class="p-document-image" src="${imageUrl(url)}" alt="题目材料">`).join("")}${options(q.options)}${q.parts.map((part, n) => `<div class="p-document-part"><div class="p-document-stem"><span>（${n + 1}）</span>${rich(part.stem)}</div>${options(part.options)}</div>`).join("")}</div>${space}</article>`;
    sections.at(-1)!.push(question);
  });
  const subtitle =
    paper.kind === "EXAM"
      ? `<div class="p-document-subtitle">${escapePrintText(paper.subject)} · ${escapePrintText(paper.grade)}</div>`
      : "";
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${escapePrintText(paper.name)}</title><link rel="stylesheet" href="/print-fonts/geist/index.css"><link rel="stylesheet" href="/print-fonts/noto-sans-sc/index.css"><link rel="stylesheet" href="/print-fonts/katex/katex.min.css"><style>@page{size:${paper.layout.paperSize} ${paper.layout.orientation ?? "portrait"};margin:${margin}mm ${margin}mm ${margin + DOCUMENT_FOOTER_MM}mm}*{box-sizing:border-box}body{margin:0;font-family:${documentFont(paper.layout.fontFamily)};font-size:${paper.layout.fontSizePt ?? DOCUMENT_DEFAULTS.fontSizePt}pt;line-height:${paper.layout.lineHeight ?? DOCUMENT_DEFAULTS.lineHeight};color:#111}.p-document-title{font-size:24px;font-weight:700;line-height:1.4;text-align:center;margin-bottom:8px}.p-document-subtitle{text-align:center;color:#58657a;margin-bottom:8px;font-size:12px}.p-document-text{white-space:pre-wrap;min-height:1lh;padding:0;overflow-wrap:anywhere}.items{column-count:${paper.layout.columns};column-gap:${DOCUMENT_COLUMN_GAP_MM}mm;column-rule:0.5pt solid #666}.p-paper-question,.p-workbook-exercise{break-inside:avoid}.p-paper-question{padding:4px 0}.p-workbook-exercise{padding:3px 0}.p-document-stem{display:flex;align-items:baseline;gap:0.4em}.p-document-stem>.p-document-text{flex:1;min-width:0}.p-document-question-number{flex:none}.p-document-options{display:flex;flex-wrap:wrap;column-gap:1em;margin-top:2px}.p-document-option{display:flex;align-items:baseline;gap:0.35em;flex:1 0 max-content;min-width:calc(25% - 0.75em);max-width:100%}.p-document-option .p-document-text{flex:1;min-width:0}.p-document-part{margin:4px 0 0 1.5em}.p-workbook-lines>div{height:7mm;border-bottom:0.5pt solid #777}.p-workbook-lines small{font-size:11px;color:#58657a}.p-document-image{display:block;width:auto;max-width:100%;height:auto;max-height:220px;object-fit:contain;margin:8px 0}.p-document-text .katex-display{margin:0.35em 0}</style><body><div class="p-document-text p-document-title">${escapePrintText(paper.name)}</div>${subtitle}${rich(paper.instructions)}${sections.map((items, n) => `<div class="items"${n ? ' style="break-before:page"' : ""}>${items.join("")}</div>`).join("")}</body></html>`;
}
