import {
  validateCardTemplate,
  choiceBubbles,
  cardPageCode,
  annotationTextLines,
  annotationLineWidth,
  cardMaterialBox,
  studentNumberBox,
  cardPageHasHeader,
  cardPageContentTop,
  CHOICE_GROUP_BOTTOM_PADDING,
  CARD_DEFAULT_FONT,
} from "./cards";
import { escapePrintText as text } from "./document-text";
import { documentFont } from "./document-layout";
import type { CardRegion, CardTemplate } from "@/contracts/platform";

function groupTitle(region: CardRegion) {
  if (
    region.kind === "CHOICE" &&
    (!region.label ||
      /^(单选题|多选题|不定项选择题|单项选择题|多项选择题|选择题)$/.test(region.label))
  )
    return "选择题";
  return region.label ?? (region.kind === "BLANK" ? "填空题" : "解答题");
}

/** Merge adjacent rows visually while retaining every question's scan and editing geometry. */
export function cardRegionGroups(layout: CardTemplate["layout"], page: number) {
  const groups: CardRegion[][] = [];
  const columns = layout.columns ?? 1;
  const columnWidth = (layout.width - 110 - (columns - 1) * 12) / columns;
  const columnOf = (region: CardRegion) =>
    Math.floor((region.x * layout.width - 55 + 0.5) / (columnWidth + 12));
  for (const region of layout.regions.filter((r) => r.page === page)) {
    const group = groups.at(-1);
    const previous = group?.at(-1);
    const close = (a: number, b: number) => Math.abs(a - b) < 0.5 / layout.width;
    const gap = previous ? (region.y - previous.y - previous.height) * layout.height : Infinity;
    const choiceNeighbor =
      region.kind === "CHOICE" &&
      group?.some((other) => {
        if (columnOf(other) !== columnOf(region) || !close(other.width, region.width)) return false;
        const horizontalGap = (region.x - other.x - other.width) * layout.width;
        const verticalGap = (region.y - other.y - other.height) * layout.height;
        return (
          (close(other.y, region.y) && horizontalGap >= -0.01 && horizontalGap <= 12.5) ||
          (close(other.x, region.x) && verticalGap >= -0.01 && verticalGap <= 12.5)
        );
      });
    if (
      previous &&
      region.kind !== "WRITING" &&
      previous.kind === region.kind &&
      groupTitle(previous) === groupTitle(region) &&
      (choiceNeighbor ||
        (region.kind !== "CHOICE" &&
          close(previous.x, region.x) &&
          close(previous.width, region.width) &&
          gap >= -0.01 &&
          gap <= 12.5))
    ) {
      group!.push(region);
    } else groups.push([region]);
  }
  return groups;
}
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
  const ink = l.printColor === "RED" ? "#d93232" : "black";
  const rect = (x: number, y: number, width: number, height: number, extra = "") =>
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" ${extra}/>`;
  const label = (x: number, y: number, value: string, size = 12, extra = "") =>
    `<text x="${x}" y="${y}" font-size="${size}" ${extra}>${text(value)}</text>`;
  const columns = l.columns ?? 1,
    cw = (w - 110 - (columns - 1) * 12) / columns;
  const barcode = n.mode === "BARCODE";
  const numberBox = studentNumberBox(l);
  const notesWidth = Math.max(230, w - 410);
  const noteParagraphs = [
    barcode
      ? "1. 答题前，考生先将自己的姓名、准考证号填写清楚，将条形码准确粘贴在考生信息条形码粘贴区。"
      : "1. 答题前，考生先将自己的姓名、准考证号填写清楚，并在准考证号填涂区逐列填涂对应数字。",
    "2. 答题时，必须使用0.5毫米的黑色墨水签字笔书写；作图时，可用2B铅笔，笔迹要清楚；选择题填涂时，必须用2B铅笔按图示规范填涂。",
    "3. 必须在题目所指示的答题区域内作答，超出答题区域的答案无效；在草稿纸、试题卷上答题无效。",
    "4. 保持答题卡清洁、完整，严禁折叠，严禁在答题卡上做任何标记，严禁使用涂改液和修正带。",
  ];
  let notesSize = 9;
  const wrapNotes = () =>
    noteParagraphs.flatMap((note) =>
      annotationTextLines(note, ((notesWidth - 18) * 14) / notesSize),
    );
  let notes = wrapNotes();
  while (notes.length * notesSize * 1.2 > 80 && notesSize > 6) {
    notesSize -= 0.25;
    notes = wrapNotes();
  }
  const groups = cardRegionGroups(l, page);
  const codeX = l.markers[0].x * w + 23;
  const codeY = l.markers[0].y * h - 5;
  const numberLeft = numberBox.x * w;
  const numberTop = numberBox.y * h;
  const numberWidth = numberBox.width * w;
  const contentTop = cardPageContentTop(l, page);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><title>${text(template.name)} · 第 ${page} 页</title>${rect(0, 0, w, h, 'fill="white"')}<g font-family="${text(documentFont(l.fontFamily ?? CARD_DEFAULT_FONT))}" fill="${ink}">${l.markers.map((m) => rect(m.x * w - 7, m.y * h - 7, 14, 14, 'fill="black"')).join("")}
  ${rect(45, 45, w - 90, h - 100, 'fill="none" stroke="#333" stroke-width="1.5"')}
  ${label(60, 69, template.name.length > 22 ? `${template.name.slice(0, 22)}…` : template.name, 20, 'font-weight="bold"')}
  <g data-page-code="${page}">${Array.from(cardPageCode(template.id, page), (bit, i) => (bit === "1" ? rect(codeX + i * 8, codeY, 6, 10, 'fill="black"') : "")).join("")}</g>
  ${
    cardPageHasHeader(l, page)
      ? `<g data-card-header="true">
  ${label(60, 108, "姓名：____________  班级：____________", 14)}
  ${rect(55, 122, notesWidth, 126, 'fill="none" stroke="#333" stroke-width="1"')}
  ${label(64, 136, "注意事项：", 11, 'font-weight="bold"')}
  ${notes
    .map((line, index) =>
      label(
        64,
        149 + index * notesSize * 1.2,
        line,
        notesSize,
        `data-card-note="true" textLength="${(annotationLineWidth(line) * notesSize) / 14}" lengthAdjust="spacingAndGlyphs"`,
      ),
    )
    .join("")}
  ${label(64, 241, "5. 正确填涂：", 9)}${rect(125, 233, 16, 9, 'fill="black"')}${label(150, 241, "错误填涂：", 9)}
  ${Array.from({ length: 6 }, (_, i) => rect(210 + i * 26, 233, 18, 9, 'fill="none" stroke="black" stroke-width="0.7"') + (i === 0 ? '<path d="M210 242L228 233" stroke="black"/>' : i === 1 ? '<path d="M236 233L254 242M236 242L254 233" stroke="black"/>' : i === 2 ? rect(262, 233, 9, 9, 'fill="black"') : i === 3 ? rect(288, 233, 3, 9, 'fill="black"') : i === 4 ? '<path d="M314 233L332 242" stroke="black"/>' : rect(340, 239, 18, 3, 'fill="black"'))).join("")}
  ${l.showAbsent !== false ? rect(55, 248, notesWidth, 12, 'fill="none" stroke="#333" stroke-width="0.7"') + label(64, 257, "此栏考生禁填    缺考标记 □（教师填写）", 8) : ""}
  ${
    barcode
      ? rect(
          numberLeft,
          numberTop,
          numberWidth,
          112,
          'fill="none" stroke="black" stroke-width="0.8"',
        ) +
        label(
          numberLeft + numberWidth / 2,
          numberTop + 45,
          "贴条形码区",
          16,
          'text-anchor="middle"',
        ) +
        label(
          numberLeft + numberWidth / 2,
          numberTop + 70,
          "请平整粘贴，勿折叠、污损",
          10,
          'text-anchor="middle"',
        ) +
        label(numberLeft, numberTop + 135, "准考证号：________________", 11)
      : label(numberLeft, numberTop - 7, "考号填涂区", 11) +
        `<g data-number-boxes="true">${Array.from({ length: n.digits }, (_, column) => rect(numberLeft + column * n.cellWidth * w, numberTop, n.cellWidth * w, 18, 'fill="none" stroke="black" stroke-width="0.8"')).join("")}</g>` +
        Array.from({ length: n.digits * 10 }, (_, i) => {
          const x = (n.x + Math.floor(i / 10) * n.cellWidth) * w,
            y = (n.y + (i % 10) * n.cellHeight) * h;
          return (
            rect(x - 9, y - 5, 18, 10, 'fill="white" stroke="black" stroke-width="0.7"') +
            label(x, y + 2.5, String(i % 10), 7, 'text-anchor="middle"')
          );
        }).join("")
  }
  </g>`
      : ""
  }
  ${Array.from({ length: columns }, (_, c) => rect(50 + c * (cw + 12), contentTop - 10, cw + 10, h - contentTop - 53, 'fill="none" stroke="#333" stroke-width="1.1"')).join("")}
  ${groups
    .map((group) => {
      const first = group[0];
      const left = Math.min(...group.map((r) => r.x));
      const top = Math.min(...group.map((r) => r.y));
      const right = Math.max(...group.map((r) => r.x + r.width));
      const bottom = Math.max(...group.map((r) => r.y + r.height));
      const title = groupTitle(first);
      return `<g data-card-group="${first.kind}">${rect(
        left * w,
        top * h,
        (right - left) * w,
        (bottom - top) * h + (first.kind === "CHOICE" ? CHOICE_GROUP_BOTTOM_PADDING : 0),
        'fill="none" stroke="black" stroke-width="1.2"',
      )}${
        first.kind !== "WRITING"
          ? label(first.x * w + 8, first.y * h + 20, title, 12, 'font-weight="bold"')
          : ""
      }</g>`;
    })
    .join("")}
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
        label(
          x + 8,
          r.kind === "CHOICE"
            ? (choiceBubbles(r, l)[0]?.y ?? y + 44) + 3
            : y + (r.kind === "BLANK" ? 45 : 20),
          r.kind === "WRITING"
            ? r.label?.startsWith("（")
              ? `${number}${r.label}`
              : `${number}. ${r.label ?? "解答题"}`
            : `${number}.`,
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
          ? `<path d="M ${x + 40} ${y + 45} H ${x + rw - 12}" stroke="#666" stroke-width="0.6"/>`
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
  return l.printColor === "RED"
    ? svg.replace(/stroke="(?:black|#333|#666|#999)"/g, `stroke="${ink}"`)
    : svg;
}
