import { SUBJECTS, type CardTemplate, type Paper, type CardRegion } from "@/contracts/platform";
export type CardPreset = { objectiveHeight: number; blankHeight: number; subjectiveHeight: number };
export const CARD_PRESETS = SUBJECTS.map((subject) => ({
  id: `gaokao-${subject}`,
  name: `高考${subject}答题卡`,
  subject,
  objectiveHeight: 52,
  blankHeight: 110,
  subjectiveHeight: subject === "语文" ? 300 : 190,
}));
function baseLayout(): CardTemplate["layout"] {
  return {
    width: 794,
    height: 1123,
    pageCount: 1,
    markers: [
      { x: 28 / 794, y: 28 / 1123 },
      { x: 766 / 794, y: 28 / 1123 },
      { x: 766 / 794, y: 1095 / 1123 },
      { x: 28 / 794, y: 1095 / 1123 },
    ],
    studentNumber: {
      digits: 6,
      x: 470 / 794,
      y: 86 / 1123,
      cellWidth: 29 / 794,
      cellHeight: 16 / 1123,
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
export function generateCardTemplate(
  paper: Paper,
  overrides: Partial<CardPreset> = {},
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
    layout: baseLayout(),
  };
  let y = 275,
    page = 1;
  for (const item of paper.items) {
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
    const actualHeight = Math.max(regionHeight, item.snapshot.content.images.length ? 180 : 0);
    if (y + actualHeight > 1050) {
      page++;
      y = 275;
    }
    template.layout.regions.push({
      itemId: item.id,
      page,
      x: 55 / 794,
      y: y / 1123,
      width: 684 / 794,
      height: actualHeight / 1123,
      kind,
      ...(item.snapshot.content.images[0] ? { image: item.snapshot.content.images[0] } : {}),
      options: kind === "CHOICE" ? item.snapshot.content.options.map((option) => option.label) : [],
      multiple: item.snapshot.type === "MULTIPLE",
    });
    y += actualHeight + 12;
  }
  template.layout.pageCount = page;
  return validateCardTemplate(template, paper);
}
export function validateCardTemplate(template: CardTemplate, paper?: Paper): CardTemplate {
  const { layout } = template;
  if (
    layout.width !== 794 ||
    layout.height !== 1123 ||
    layout.markers.length !== 4 ||
    layout.studentNumber.digits !== 6 ||
    !Number.isInteger(layout.pageCount) ||
    layout.pageCount < 1 ||
    layout.pageCount > 100
  )
    throw new Error("答题卡必须包含 A4 页面、四个定位点和六位学号");
  const within = (x: number, y: number, w = 0, h = 0) =>
    [x, y, w, h].every(Number.isFinite) &&
    x >= 0 &&
    y >= 0 &&
    w >= 0 &&
    h >= 0 &&
    x + w <= 1 &&
    y + h <= 1;
  for (const marker of layout.markers)
    if (!within(marker.x - 7 / 794, marker.y - 7 / 1123, 14 / 794, 14 / 1123))
      throw new Error("定位点坐标无效");
  if (new Set(layout.markers.map((m) => `${m.x}:${m.y}`)).size !== 4)
    throw new Error("定位点不能重复");
  const number = layout.studentNumber;
  if (
    !within(
      number.x - 5 / 794,
      number.y - 5 / 1123,
      number.cellWidth * 5 + 10 / 794,
      number.cellHeight * 9 + 10 / 1123,
    ) ||
    number.cellWidth < 16 / 794 ||
    number.cellHeight < 12 / 1123
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
    if (region.y < 245 / 1123 || region.y + region.height > 1060 / 1123)
      throw new Error("题目答题区域须避开页眉识别区和页脚，Y 不低于 0.219，底边不超过 0.944");
    const studentLeft = number.x - 5 / 794,
      studentTop = number.y - 5 / 1123,
      studentWidth = number.cellWidth * 5 + 10 / 794,
      studentHeight = number.cellHeight * 9 + 10 / 1123;
    if (
      region.x < studentLeft + studentWidth &&
      region.x + region.width > studentLeft &&
      region.y < studentTop + studentHeight &&
      region.y + region.height > studentTop
    )
      throw new Error("题目答题区域不能覆盖学号涂卡");
    for (const marker of layout.markers)
      if (
        region.x < marker.x + 7 / 794 &&
        region.x + region.width > marker.x - 7 / 794 &&
        region.y < marker.y + 7 / 1123 &&
        region.y + region.height > marker.y - 7 / 1123
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
    for (const bubble of choiceBubbles(region)) {
      if (
        bubble.x - bubble.radius < region.x * 794 ||
        bubble.x + bubble.radius > (region.x + region.width) * 794 ||
        bubble.y - bubble.radius < region.y * 1123 ||
        bubble.y + bubble.radius > (region.y + region.height) * 1123
      )
        throw new Error("选项涂卡必须完整位于对应答题区域内");
    }
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
export function choiceBubbles(region: CardRegion) {
  return (region.options ?? []).map((value, i) => ({
    value,
    x: region.x * 794 + 85 + i * 46,
    y: region.y * 1123 + 29,
    radius: 7,
  }));
}
