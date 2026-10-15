import {
  validateCardTemplate,
  choiceBubbles,
  cardPageCode,
  annotationTextLines,
  annotationLineWidth,
  cardMaterialBox,
} from "./cards";
import { escapePrintText as text } from "./document-text";
import { documentFont } from "./document-layout";
import type { CardTemplate } from "@/contracts/platform";
export function renderCardSvg(template: CardTemplate, page = 1, validate = true): string {
  if (validate) validateCardTemplate(template);
  if (
    validate &&
    template.layout.regions.some(
      (r) => r.image && !/^(\/api\/|https?:\/\/|data:image\/(png|jpeg|webp);base64,)/.test(r.image),
    )
  )
    throw new Error("题目图片地址不受支持");
  const l = template.layout,
    w = l.width,
    h = l.height,
    n = l.studentNumber;
  if (!Number.isInteger(page) || page < 1 || page > l.pageCount)
    throw new Error("答题卡页码不存在");
  const rect = (x: number, y: number, width: number, height: number, extra = "") =>
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" ${extra}/>`;
  const label = (x: number, y: number, value: string, size = 12, extra = "") =>
    `<text x="${x}" y="${y}" font-size="${size}" ${extra}>${text(value)}</text>`;
  const columns = l.columns ?? 1,
    cw = (w - 110 - (columns - 1) * 12) / columns;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><title>${text(template.name)} · 第 ${page} 页</title>${rect(0, 0, w, h, 'fill="white"')}<g font-family="${text(documentFont(l.fontFamily))}" fill="black">${l.markers.map((m) => rect(m.x * w - 7, m.y * h - 7, 14, 14, 'fill="black"')).join("")}
  ${rect(45, 45, w - 90, h - 100, 'fill="none" stroke="#333" stroke-width="1.5"')}
  ${label(60, 69, template.name.length > 22 ? `${template.name.slice(0, 22)}…` : template.name, 20, 'font-weight="bold"')}
  ${label(60, 108, "姓名：____________  班级：____________", 14)}
  ${rect(55, 122, Math.max(230, w - 410), 52, 'fill="none" stroke="#333" stroke-width="1"')}
  ${label(64, 140, "注意事项", 11, 'font-weight="bold"')}${label(64, 158, "1. 客观题用 2B 铅笔填涂。主观题用黑色字迹书写。", 10)}
  ${l.showAbsent !== false ? rect(55, 174, Math.max(230, w - 410), 12, 'fill="none" stroke="#333" stroke-width="0.7"') + label(64, 183, "正确填涂 ▰     缺考标记 □（教师填写）", 8) : ""}
  <g data-page-code="${page}">${Array.from(cardPageCode(template.id, page), (bit, i) => (bit === "1" ? rect(65 + i * 8, 190, 6, 10, 'fill="black"') : "")).join("")}</g>${label(65, 225, "页面识别码 · 请勿涂改", 10)}
  ${label(n.x * w - 10, 57, "六位学号 / 考号（每列填一个数字）", 11)}
  ${Array.from({ length: n.digits }, (_, column) => rect((n.x + column * n.cellWidth) * w - 10, n.y * h - 22, 20, 15, 'fill="none" stroke="black" stroke-width="0.8"')).join("")}
  ${Array.from({ length: n.digits * 10 }, (_, i) => {
    const x = (n.x + Math.floor(i / 10) * n.cellWidth) * w,
      y = (n.y + (i % 10) * n.cellHeight) * h;
    return (
      rect(x - 9, y - 5, 18, 10, 'fill="white" stroke="black" stroke-width="0.7"') +
      label(x, y + 2.5, String(i % 10), 7, 'text-anchor="middle"')
    );
  }).join("")}
  ${Array.from({ length: columns }, (_, c) => rect(50 + c * (cw + 12), 265, cw + 10, h - 328, 'fill="none" stroke="#333" stroke-width="1.1"')).join("")}
  ${l.regions
    .filter((r) => r.page === page)
    .map((r) => {
      const x = r.x * w,
        y = r.y * h,
        rw = r.width * w,
        rh = r.height * h;
      const number = l.regions.indexOf(r) + 1;
      const material = cardMaterialBox(r, l);
      return (
        rect(x, y, rw, rh, 'fill="none" stroke="black" stroke-width="1.2"') +
        label(
          x + 8,
          y + 20,
          `${number}. ${r.label ?? (r.kind === "CHOICE" ? (r.multiple ? "多项选择题" : "单项选择题") : r.kind === "BLANK" ? "填空题" : "解答题")}`,
          12,
          'font-weight="bold"',
        ) +
        (r.kind === "WRITING" && r.writingStyle === "lines"
          ? Array.from(
              { length: Math.max(0, Math.floor((rh - 32) / 24)) },
              (_, i) =>
                `<path d="M ${x + 12} ${y + 48 + i * 24} H ${x + rw - 12}" stroke="#999" stroke-width="0.6"/>`,
            ).join("")
          : r.kind === "WRITING" && r.writingStyle === "grid"
            ? Array.from({ length: Math.max(0, Math.floor((rh - 36) / 24)) }, (_, row) =>
                Array.from({ length: Math.max(0, Math.floor((rw - 24) / 24)) }, (_, col) =>
                  rect(
                    x + 12 + col * 24,
                    y + 32 + row * 24,
                    24,
                    24,
                    'fill="none" stroke="#999" stroke-width="0.5"',
                  ),
                ).join(""),
              ).join("")
            : "") +
        choiceBubbles(r, l)
          .map(
            (b) =>
              rect(b.x - 9, b.y - 5, 18, 10, 'fill="white" stroke="black" stroke-width="0.8"') +
              label(b.x, b.y + 3, b.value, 9, 'text-anchor="middle"'),
          )
          .join("") +
        (r.kind === "BLANK"
          ? `<path d="M ${x + 12} ${y + 45} H ${x + rw - 12}" stroke="#666" stroke-width="0.6"/>`
          : "") +
        (r.image &&
        material.height > 0 &&
        /^(\/api\/|https?:\/\/|data:image\/(png|jpeg|webp);base64,)/.test(r.image)
          ? `<image href="${text(r.image)}" x="${x + 12}" y="${y + material.y}" width="${material.width}" height="${material.height}" preserveAspectRatio="xMidYMid meet"/>`
          : "")
      );
    })
    .join("")}
${(l.annotations ?? [])
  .filter((a) => a.page === page)
  .map(
    (a) =>
      `<text x="${a.x * w}" y="${a.y * h + 14}" font-size="14">${annotationTextLines(
        a.text,
        a.width * w,
      )
        .map(
          (line, i) =>
            `<tspan x="${a.x * w}" dy="${i ? 19.6 : 0}" textLength="${annotationLineWidth(line)}" lengthAdjust="spacingAndGlyphs">${text(line)}</tspan>`,
        )
        .join("")}</text>`,
  )
  .join("")}
  ${l.showFooter !== false ? label(w / 2, h - 40, `第 ${page} 页 / 共 ${l.pageCount} 页 · 请在各题答题区域内作答`, 10, 'text-anchor="middle"') : ""}
  ${l.showSubject !== false ? label(w - 60, h - 58, `${template.subject}答题卡`, 11, 'text-anchor="end"') : ""}</g></svg>`;
}
