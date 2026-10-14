import type { CardTemplate, Paper } from "./types";
import { renderCardSvg } from "@/lib/card-svg";
import { documentFont, orderedDocumentBlocks } from "@/lib/document-layout";
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
  const margin = paper.layout.marginMm ?? 18;
  const rich = (value: string) =>
    `<div class="p-document-text">${renderPrintRichText(value)}</div>`;
  const options = (entries: { label: string; text: string }[]) =>
    entries
      .map(
        (o) =>
          `<div class="p-document-option"><span>${escapePrintText(o.label)}.</span>${rich(o.text)}</div>`,
      )
      .join("");
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
    const answerLines =
      settings?.answerLines ?? (["SINGLE", "MULTIPLE"].includes(item.snapshot.type) ? 1 : 4);
    const homework = paper.kind === "HOMEWORK";
    const space = homework
      ? `<div class="p-workbook-lines"><small>作答：</small>${Array.from({ length: answerLines }, () => "<div></div>").join("")}</div>`
      : "";
    const question = `<article class="${homework ? "p-workbook-exercise" : "p-paper-question"}"${homework ? ` style="padding-bottom:${settings?.spaceAfterMm ?? 4}mm"` : ""}><div class="p-document-question-heading"><strong>${index + 1}. ${escapePrintText(item.section)}</strong><span>${item.score} 分</span></div><div class="p-document-question-body">${rich(q.stem)}${q.images.map((url) => `<img class="p-document-image" src="${imageUrl(url)}" alt="题目材料">`).join("")}${options(q.options)}${q.parts.map((part, n) => `<div class="p-document-part"><strong>（${n + 1}）</strong><small>（${part.score} 分）</small>${rich(part.stem)}${options(part.options)}</div>`).join("")}</div>${space}</article>`;
    sections.at(-1)!.push(question);
  });
  const subtitle =
    paper.kind === "EXAM"
      ? `<div class="p-document-subtitle">${escapePrintText(paper.subject)} · ${escapePrintText(paper.grade)} · 共 ${paper.items.reduce((n, i) => n + i.score, 0)} 分</div>`
      : "";
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${escapePrintText(paper.name)}</title><link rel="stylesheet" href="/print-fonts/geist/index.css"><link rel="stylesheet" href="/print-fonts/noto-sans-sc/index.css"><style>@page{size:${paper.layout.paperSize} ${paper.layout.orientation ?? "portrait"};margin:${margin}mm ${margin}mm ${margin + 32 / 3.78}mm}*{box-sizing:border-box}body{margin:0;font-family:${documentFont(paper.layout.fontFamily)};font-size:${paper.layout.fontSizePt ?? 11}pt;line-height:${paper.layout.lineHeight ?? 1.8};color:#202b3d}.p-document-title{font-size:24px;font-weight:650;line-height:1.4;text-align:center;margin-bottom:14px}.p-document-subtitle{text-align:center;color:#58657a;margin-bottom:16px;font-size:12px}.p-document-text{white-space:pre-wrap;min-height:1.5em;border:1px solid transparent;padding:3px 4px;overflow-wrap:anywhere}.items{column-count:${paper.layout.columns};column-gap:24px}.p-paper-question,.p-workbook-exercise{break-inside:avoid}.p-paper-question{padding:20px 0;border-top:1px solid #dfe5ee}.p-workbook-exercise{padding:16px 0}.p-document-question-heading{display:flex;justify-content:space-between;gap:12px;min-height:24px;margin-bottom:8px;font-size:12px;line-height:24px}.p-document-question-heading strong{font-weight:600}.p-document-option{display:flex;align-items:baseline;gap:8px}.p-document-option .p-document-text{flex:1;min-width:0}.p-document-part{margin:12px 0 0 18px}.p-workbook-lines>div{height:28px;border-bottom:1px solid #dfe5ee}.p-workbook-lines small{font-size:11px;color:#58657a}.p-document-image{display:block;width:auto;max-width:100%;height:auto;max-height:220px;object-fit:contain;margin:8px 0}math{font-size:1.08em}</style><body><div class="p-document-text p-document-title">${escapePrintText(paper.name)}</div>${subtitle}${rich(paper.instructions)}${sections.map((items, n) => `<div class="items"${n ? ' style="break-before:page"' : ""}>${items.join("")}</div>`).join("")}</body></html>`;
}
