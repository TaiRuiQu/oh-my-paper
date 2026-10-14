import katex from "katex";
import { validateCardTemplate, choiceBubbles, cardPageCode } from "./cards";
import type { CardTemplate, Paper } from "./types";
export function escapePrintText(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
  );
}
function imageUrl(url: string): string {
  if (!/^(https?:\/\/|\/api\/|data:image\/(png|jpeg|webp);base64,)/.test(url))
    throw new Error("题目图片地址不受支持");
  return escapePrintText(url);
}
/** Safe text plus native MathML avoids external fonts and preserves printed formulas. */
export function renderPrintRichText(value: string): string {
  const expression = /\$\$([\s\S]+?)\$\$|\$([^\n$]+?)\$|\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\]/g;
  let output = "",
    offset = 0;
  for (const match of value.matchAll(expression)) {
    output += escapePrintText(value.slice(offset, match.index));
    const math = match[1] ?? match[2] ?? match[3] ?? match[4];
    output += katex.renderToString(math, {
      output: "mathml",
      displayMode: !!(match[1] ?? match[4]),
      throwOnError: false,
      trust: false,
      maxExpand: 1000,
    });
    offset = match.index! + match[0].length;
  }
  return output + escapePrintText(value.slice(offset));
}
export function renderCardSvg(template: CardTemplate, pageNumber = 1): string {
  validateCardTemplate(template);
  const { layout: l } = template;
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > l.pageCount)
    throw new Error("答题卡页码不存在");
  const text = escapePrintText,
    n = l.studentNumber;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="794" height="1123" viewBox="0 0 794 1123"><title>${text(template.name)} · 第 ${pageNumber} 页</title><rect width="794" height="1123" fill="white"/><g fill="black">${l.markers.map((m) => `<rect x="${m.x * 794 - 7}" y="${m.y * 1123 - 7}" width="14" height="14"/>`).join("")}</g><g font-family="sans-serif" fill="black"><text x="60" y="66" font-size="20">${text(template.name.length > 18 ? `${template.name.slice(0, 18)}…` : template.name)}</text><text x="60" y="108" font-size="15">姓名：____________ 班级：____________</text><text x="60" y="148" font-size="13">请用 2B 铅笔填涂学号及客观题。</text><g data-page-code="${pageNumber}">${Array.from(cardPageCode(template.id, pageNumber), (bit, i) => (bit === "1" ? `<rect x="${65 + i * 8}" y="190" width="6" height="10" fill="black"/>` : "")).join("")}</g><text x="60" y="225" font-size="11">页面识别码 · 请勿涂改</text><text x="460" y="57" font-size="14">六位学号（每列填一个数字）</text>${Array.from(
    { length: 60 },
    (_, i) => {
      const x = (n.x + Math.floor(i / 10) * n.cellWidth) * 794,
        y = (n.y + (i % 10) * n.cellHeight) * 1123;
      return `<circle cx="${x}" cy="${y}" r="5" fill="white" stroke="black" stroke-width="0.7"/><text x="${x}" y="${y + 2.5}" text-anchor="middle" font-size="7">${i % 10}</text>`;
    },
  ).join("")}${l.regions
    .filter((r) => r.page === pageNumber)
    .map(
      (r) =>
        `<rect x="${r.x * 794}" y="${r.y * 1123}" width="${r.width * 794}" height="${r.height * 1123}" fill="none" stroke="black" stroke-width="0.6"/><text x="${r.x * 794 + 8}" y="${r.y * 1123 + 20}" font-size="12">${l.regions.indexOf(r) + 1}. ${r.kind === "CHOICE" ? (r.multiple ? "多选题" : "单选题") : "答题区域"}</text>${choiceBubbles(
          r,
        )
          .map(
            (b) =>
              `<circle cx="${b.x}" cy="${b.y}" r="${b.radius}" fill="white" stroke="black" stroke-width="0.7"/><text x="${b.x}" y="${b.y + 3}" font-size="9" text-anchor="middle">${text(b.value)}</text>`,
          )
          .join(
            "",
          )}${r.image ? `<image href="${imageUrl(r.image)}" x="${r.x * 794 + 12}" y="${r.y * 1123 + (r.kind === "CHOICE" ? 48 : 32)}" width="135" height="100" preserveAspectRatio="xMidYMid meet"/>` : ""}`,
    )
    .join(
      "",
    )}<text x="397" y="1082" text-anchor="middle" font-size="11">第 ${pageNumber} 页 / 共 ${l.pageCount} 页 · ${text(template.id)}</text></g></svg>`;
}
export function renderCardHtml(template: CardTemplate): string {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${escapePrintText(template.name)}</title><style>@page{size:A4;margin:0}body{margin:0}svg{display:block;width:210mm;height:297mm;break-after:page}svg:last-child{break-after:auto}@media screen{body{background:#eee}svg{margin:12px auto}}</style><body>${Array.from({ length: template.layout.pageCount }, (_, i) => renderCardSvg(template, i + 1)).join("")}</body></html>`;
}
export function renderPaperHtml(paper: Paper): string {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${escapePrintText(paper.name)}</title><style>@page{size:${paper.layout.paperSize};margin:18mm}body{font-family:sans-serif;line-height:1.7;color:#111}h1{text-align:center;font-size:24px}.items{column-count:${paper.layout.columns};column-gap:24px}.question{break-inside:avoid;margin-bottom:24px;white-space:pre-wrap}.part{margin:12px 0 0 18px}math{font-size:1.08em}img{max-width:100%;max-height:220px}.score{float:right}</style><body><h1>${escapePrintText(paper.name)}</h1><p>${renderPrintRichText(paper.instructions)}</p><div class="items">${paper.items
    .map((item, i) => {
      const q = item.snapshot.content;
      return `<article class="question"><span class="score">${item.score} 分</span><strong>${i + 1}.</strong> ${renderPrintRichText(q.stem)}${q.images.map((url) => `<br><img src="${imageUrl(url)}" alt="题目材料">`).join("")}${q.options.map((o) => `<div>${escapePrintText(o.label)}. ${renderPrintRichText(o.text)}</div>`).join("")}${q.parts.map((p) => `<div class="part"><strong>(${escapePrintText(p.id)})</strong> ${renderPrintRichText(p.stem)} <small>（${p.score} 分）</small>${p.options.map((o) => `<div>${escapePrintText(o.label)}. ${renderPrintRichText(o.text)}</div>`).join("")}</div>`).join("")}</article>`;
    })
    .join("")}</div></body></html>`;
}
