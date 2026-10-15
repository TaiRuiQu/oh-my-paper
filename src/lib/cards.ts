import {
  SUBJECTS,
  type CardTemplate,
  type Paper,
  type CardRegion,
  type CardLayout,
} from "@/contracts/platform";
import { pageDimensions } from "./document-layout";
export type CardPreset = { objectiveHeight: number; blankHeight: number; subjectiveHeight: number };
export const CARD_PRESETS = SUBJECTS.map((subject) => ({
  id: `gaokao-${subject}`,
  name: `高考${subject}答题卡`,
  subject,
  objectiveHeight: 52,
  blankHeight: 56,
  subjectiveHeight: subject === "语文" ? 300 : 190,
}));
type CardFormat = Pick<
  CardLayout,
  | "paperSize"
  | "orientation"
  | "columns"
  | "fontFamily"
  | "annotations"
  | "headerMode"
  | "showAbsent"
  | "showFooter"
  | "showSubject"
  | "locked"
> &
  Partial<Pick<CardLayout, "width" | "height" | "studentNumber">>;
function baseLayout(format: CardFormat = {}): CardLayout {
  const orientation = format.paperSize === "A3" ? "landscape" : "portrait";
  const { width, height } = pageDimensions(format.paperSize, orientation);
  return {
    paperSize: format.paperSize ?? "A4",
    orientation,
    columns: format.columns ?? 1,
    fontFamily: format.fontFamily ?? "NSimSun",
    headerMode: format.headerMode ?? "EVERY_PAGE",
    omrVersion: 2,
    annotations: format.annotations?.map((a) => {
      const aw = Math.min(a.width * (format.width ?? width), width - 120);
      const ah = Math.min(a.height * (format.height ?? height), height - 120);
      const x = Math.max(60, Math.min(width - 60 - aw, a.x * (format.width ?? width)));
      const y = Math.max(60, Math.min(height - 60 - ah, a.y * (format.height ?? height)));
      return fitAnnotationText(
        { ...a, x: x / width, y: y / height, width: aw / width, height: ah / height },
        { width, height },
      );
    }),
    width,
    height,
    pageCount: 1,
    markers: [
      { x: 28 / width, y: 28 / height },
      { x: (width - 28) / width, y: 28 / height },
      { x: (width - 28) / width, y: (height - 28) / height },
      { x: 28 / width, y: (height - 28) / height },
    ],
    studentNumber: {
      mode: format.studentNumber?.mode ?? "OMR",
      digits: 6,
      x: (width - 270) / width,
      y: 94 / height,
      cellWidth: 29 / width,
      cellHeight: 16 / height,
    },
    regions: [],
  };
}
export function defaultCardPresets(): CardTemplate[] {
  return CARD_PRESETS.map((preset) => ({
    id: preset.id,
    ownerId: null,
    paperId: null,
    name: preset.name,
    subject: preset.subject,
    preset: true,
    layout: baseLayout(),
  }));
}
export function studentNumberBox(layout: CardLayout) {
  const n = layout.studentNumber;
  const topOffset = n.mode === "BARCODE" ? 22 : 28;
  return {
    x: n.x - n.cellWidth / 2,
    y: n.y - topOffset / layout.height,
    width: n.cellWidth * n.digits,
    height: n.mode === "BARCODE" ? 112 / layout.height : n.cellHeight * 9 + 34 / layout.height,
  };
}
export function cardPageHasHeader(layout: Pick<CardLayout, "headerMode">, page: number) {
  switch (layout.headerMode) {
    case "FIRST_PAGE":
      return page === 1;
    case "ODD_PAGES":
      return page % 2 === 1;
    default:
      return true;
  }
}
export function cardPageContentTop(layout: Pick<CardLayout, "headerMode">, page: number) {
  return cardPageHasHeader(layout, page) ? 275 : 95;
}
export function generateCardTemplate(
  paper: Paper,
  overrides: Partial<CardPreset> = {},
  format: CardFormat = paper.layout,
): CardTemplate {
  const preset = {
    ...(CARD_PRESETS.find((entry) => entry.subject === paper.subject) ?? CARD_PRESETS[1]),
    ...overrides,
  };
  const template: CardTemplate = {
    id: globalThis.crypto.randomUUID(),
    ownerId: paper.ownerId,
    paperId: paper.id,
    name: `${paper.name}答题卡`,
    subject: paper.subject,
    preset: false,
    layout: {
      ...baseLayout(format),
      showAbsent: format.showAbsent,
      showFooter: format.showFooter,
      showSubject: format.showSubject,
      locked: format.locked,
    },
  };
  let page = 1,
    column = 0;
  let y = cardPageContentTop(template.layout, page);
  const { width, height } = template.layout;
  const columns = template.layout.columns ?? 1;
  const columnWidth = (width - 110 - (columns - 1) * 12) / columns;
  for (const [index, item] of paper.items.entries()) {
    const kind =
      item.snapshot.type === "SINGLE" || item.snapshot.type === "MULTIPLE"
        ? "CHOICE"
        : item.snapshot.type === "BLANK"
          ? "BLANK"
          : "WRITING";
    const regionHeight =
      kind === "CHOICE"
        ? preset.objectiveHeight
        : kind === "BLANK"
          ? preset.blankHeight
          : preset.subjectiveHeight;
    if (!Number.isFinite(regionHeight) || regionHeight < 40 || regionHeight > 760)
      throw new Error("答题区域高度须在 40 至 760 之间");
    const optionColumns = Math.max(1, Math.floor((columnWidth - 60) / 32));
    const choiceHeight = 30 + Math.ceil(item.snapshot.content.options.length / optionColumns) * 22;
    const actualHeight = Math.min(
      height - 340,
      Math.max(
        regionHeight,
        kind === "CHOICE" ? choiceHeight : 0,
        item.snapshot.content.images.length
          ? Math.max(180, kind === "CHOICE" ? choiceHeight + 112 : 180)
          : 0,
      ),
    );
    if (y + actualHeight > height - 73) {
      column++;
      if (column >= columns) {
        page++;
        column = 0;
      }
      y = cardPageContentTop(template.layout, page);
    }
    template.layout.regions.push({
      itemId: item.id,
      page,
      x: (55 + column * (columnWidth + 12)) / width,
      y: y / height,
      width: columnWidth / width,
      height: actualHeight / height,
      kind,
      ...(item.snapshot.content.images[0] ? { image: item.snapshot.content.images[0] } : {}),
      options: kind === "CHOICE" ? item.snapshot.content.options.map((option) => option.label) : [],
      multiple: item.snapshot.type === "MULTIPLE",
    });
    const nextItem = paper.items[index + 1];
    const nextKind =
      nextItem &&
      (["SINGLE", "MULTIPLE"].includes(nextItem.snapshot.type)
        ? "CHOICE"
        : nextItem.snapshot.type === "BLANK"
          ? "BLANK"
          : "WRITING");
    y += actualHeight + (kind !== "WRITING" && nextKind === kind ? 1 : 12);
  }
  template.layout.pageCount = page;
  template.layout.annotations = template.layout.annotations?.map((a) => ({
    ...a,
    page: Math.min(a.page, page),
  }));
  return validateCardTemplate(template, paper);
}
export function validateCardTemplate(template: CardTemplate, paper?: Paper): CardTemplate {
  const { layout } = template;
  if (
    !["794:1123", "1123:794", "1123:1587", "1587:1123"].includes(
      `${layout.width}:${layout.height}`,
    ) ||
    (layout.paperSize !== undefined &&
      (() => {
        const d = pageDimensions(layout.paperSize, layout.orientation);
        return d.width !== layout.width || d.height !== layout.height;
      })()) ||
    !Number.isInteger(layout.columns ?? 1) ||
    (layout.columns ?? 1) < 1 ||
    (layout.columns ?? 1) > 4 ||
    layout.markers.length !== 4 ||
    layout.studentNumber.digits !== 6 ||
    !Number.isInteger(layout.pageCount) ||
    layout.pageCount < 1 ||
    layout.pageCount > 100
  )
    throw new Error("答题卡必须包含 A4/A3 横向或纵向页面、1–4 栏、四个定位点和六位学号");
  if (
    layout.headerMode !== undefined &&
    !["EVERY_PAGE", "ODD_PAGES", "FIRST_PAGE"].includes(layout.headerMode)
  )
    throw new Error("顶部信息区须选择每页、仅奇数页或仅首页显示");
  const { width, height } = layout;
  const within = (x: number, y: number, w = 0, h = 0) =>
    [x, y, w, h].every(Number.isFinite) &&
    x >= 0 &&
    y >= 0 &&
    w >= 0 &&
    h >= 0 &&
    x + w <= 1 &&
    y + h <= 1;
  for (const marker of layout.markers)
    if (!within(marker.x - 7 / width, marker.y - 7 / height, 14 / width, 14 / height))
      throw new Error("定位点坐标无效");
  if (new Set(layout.markers.map((m) => `${m.x}:${m.y}`)).size !== 4)
    throw new Error("定位点不能重复");
  const number = layout.studentNumber;
  const numberBox = studentNumberBox(layout);
  if (
    !within(numberBox.x, numberBox.y, numberBox.width, numberBox.height) ||
    (number.mode !== undefined && !["OMR", "BARCODE"].includes(number.mode)) ||
    number.cellWidth < 16 / width ||
    number.cellHeight < 12 / height
  )
    throw new Error("学号涂卡坐标无效");
  for (const region of layout.regions) {
    if (
      !region.itemId ||
      !Number.isInteger(region.page) ||
      region.page < 1 ||
      region.page > layout.pageCount ||
      !within(region.x, region.y, region.width, region.height) ||
      region.width < 0.02 ||
      region.height < 0.02
    )
      throw new Error("题目答题区域坐标无效");
    if (
      region.y < (cardPageContentTop(layout, region.page) - 10) / height ||
      region.y + region.height > (height - 63) / height
    )
      throw new Error("题目答题区域须避开页眉识别区和页脚");
    const { x: studentLeft, y: studentTop, width: studentWidth, height: studentHeight } = numberBox;
    if (
      cardPageHasHeader(layout, region.page) &&
      region.x < studentLeft + studentWidth &&
      region.x + region.width > studentLeft &&
      region.y < studentTop + studentHeight &&
      region.y + region.height > studentTop
    )
      throw new Error("题目答题区域不能覆盖学号涂卡");
    for (const marker of layout.markers)
      if (
        region.x < marker.x + 7 / width &&
        region.x + region.width > marker.x - 7 / width &&
        region.y < marker.y + 7 / height &&
        region.y + region.height > marker.y - 7 / height
      )
        throw new Error("题目答题区域不能覆盖定位点");
    if (
      layout.regions.some(
        (other) =>
          other !== region &&
          other.page === region.page &&
          region.x < other.x + other.width &&
          region.x + region.width > other.x &&
          region.y < other.y + other.height &&
          region.y + region.height > other.y,
      )
    )
      throw new Error("题目答题区域不可重叠");
    if (
      region.kind === "CHOICE" &&
      (!region.options?.length ||
        region.options.length > 12 ||
        new Set(region.options).size !== region.options.length)
    )
      throw new Error("客观题须有 1 至 12 个唯一选项");
  }
  for (const region of layout.regions) {
    if (region.image && cardMaterialBox(region, layout).height <= 0)
      throw new Error("请扩大答题区域以容纳配图");
    for (const bubble of choiceBubbles(region, layout)) {
      if (
        bubble.x - bubble.radius < region.x * width ||
        bubble.x + bubble.radius > (region.x + region.width) * width ||
        bubble.y - bubble.radius < region.y * height ||
        bubble.y + bubble.radius > (region.y + region.height) * height
      )
        throw new Error("选项涂卡必须完整位于对应答题区域内");
    }
  }
  for (const annotation of layout.annotations ?? []) {
    if (annotation.width * width < 14) throw new Error("附加文字宽度过小，请增大文字区域");
    if (
      annotationTextLines(annotation.text, annotation.width * width).length * 19.6 >
      annotation.height * height + 0.01
    )
      throw new Error("附加文字高度不足，请增大文字区域或缩短内容");
    if (
      !within(annotation.x, annotation.y, annotation.width, annotation.height) ||
      annotation.page < 1 ||
      annotation.page > layout.pageCount
    )
      throw new Error("文字必须位于有效页面内");
    const intersects = (x: number, y: number, w: number, h: number) =>
      annotation.x < x + w &&
      annotation.x + annotation.width > x &&
      annotation.y < y + h &&
      annotation.y + annotation.height > y;
    if (
      (cardPageHasHeader(layout, annotation.page) &&
        intersects(numberBox.x, numberBox.y, numberBox.width, numberBox.height)) ||
      intersects(
        (layout.markers[0].x * width + 23) / width,
        layout.markers[0].y - 5 / height,
        368 / width,
        10 / height,
      ) ||
      layout.markers.some((m) =>
        intersects(m.x - 9 / width, m.y - 9 / height, 18 / width, 18 / height),
      ) ||
      layout.regions.some(
        (r) =>
          r.kind === "CHOICE" &&
          r.page === annotation.page &&
          intersects(r.x, r.y, r.width, r.height),
      )
    )
      throw new Error("文字不能覆盖学号、页面识别码、定位点或选择题填涂区");
  }
  const corners = layout.markers;
  if (!(
    corners[0].x < corners[1].x &&
    corners[3].x < corners[2].x &&
    corners[0].y < corners[3].y &&
    corners[1].y < corners[2].y
  ))
    throw new Error("定位点须依次为左上、右上、右下、左下");
  const ids = layout.regions.map((r) => r.itemId);
  if (
    new Set(ids).size !== ids.length ||
    (paper &&
      (ids.length !== paper.items.length ||
        ids.some((id) => !paper.items.some((item) => item.id === id))))
  )
    throw new Error("答题卡必须完整且唯一地覆盖试卷题目");
  return template;
}
export function choiceBubbles(
  region: CardRegion,
  layout?: Pick<CardLayout, "width" | "height" | "omrVersion">,
) {
  const width = layout?.width ?? 794,
    height = layout?.height ?? 1123;
  const modern = !layout || layout.omrVersion === 2;
  const columns = Math.max(1, Math.floor((region.width * width - 60) / 32));
  return (region.options ?? []).map((value, i) => ({
    value,
    x: region.x * width + (modern ? 54 + (i % columns) * 32 : 85 + i * 46),
    y: region.y * height + (modern ? 44 + Math.floor(i / columns) * 22 : 29),
    radius: 7,
    width: 18,
    height: 10,
  }));
}

/** Printed machine code binds each page to its persisted template and page number. */
export function cardPageCode(templateId: string, page: number): string {
  let signature = 2166136261;
  for (let i = 0; i < templateId.length; i++)
    signature = Math.imul(signature ^ templateId.charCodeAt(i), 16777619);
  return `101${(signature >>> 0).toString(2).padStart(32, "0")}${page.toString(2).padStart(8, "0")}110`;
}

/** Plain card text uses one deterministic wrapping model in SVG preview and print. */
export function annotationTextLines(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "",
      used = 0;
    for (const character of paragraph) {
      const advance = /[\u0000-\u00ff]/.test(character) ? 7 : 14;
      if (used + advance > width && line) {
        lines.push(line);
        line = "";
        used = 0;
      }
      line += character;
      used += advance;
    }
    lines.push(line);
  }
  return lines;
}
export function fitAnnotationText(
  annotation: NonNullable<CardLayout["annotations"]>[number],
  layout: Pick<CardLayout, "width" | "height">,
) {
  return {
    ...annotation,
    height: Math.max(
      annotation.height,
      (annotationTextLines(annotation.text, annotation.width * layout.width).length * 19.6) /
        layout.height,
    ),
  };
}

export function annotationLineWidth(line: string) {
  return [...line].reduce(
    (width, character) => width + (/[\u0000-\u00ff]/.test(character) ? 7 : 14),
    0,
  );
}

export function cardMaterialBox(
  region: CardRegion,
  layout: Pick<CardLayout, "width" | "height" | "omrVersion">,
) {
  const y =
    region.kind === "CHOICE"
      ? Math.max(
          72,
          ...choiceBubbles(region, layout).map((b) => b.y - region.y * layout.height + 16),
        )
      : 32;
  return {
    x: 12,
    y,
    width: Math.min(135, region.width * layout.width - 24),
    height: Math.min(100, region.height * layout.height - y - 8),
  };
}
