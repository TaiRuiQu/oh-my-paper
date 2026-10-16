// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { BankQuestion, CardLayout, Paper } from "@/contracts/platform";
import {
  generateCardTemplate,
  choiceBubbles,
  studentNumberBox,
  validateCardTemplate,
  cardPageContentTop,
  CARD_DEFAULT_FONT,
} from "@/lib/cards";
import { renderCardSvg, cardRegionGroups } from "@/lib/card-svg";
import { commandSchema } from "@/server/platform/schemas";

const question: BankQuestion = {
  id: "q",
  ownerId: "teacher",
  type: "SUBJECTIVE",
  subject: "语文",
  grade: "四年级",
  difficulty: 0.5,
  knowledgeTags: [],
  createdAt: "",
  updatedAt: "",
  content: {
    stem: "写一段话",
    options: [],
    answers: [],
    explanation: "",
    rubric: "",
    images: [],
    parts: [],
  },
};
const paper: Paper = {
  id: "paper",
  ownerId: "teacher",
  name: "语文月考",
  kind: "EXAM",
  subject: "语文",
  grade: "四年级",
  instructions: "",
  layout: { paperSize: "A4", columns: 1 },
  createdAt: "",
  updatedAt: "",
  items: [
    { id: "item", questionId: "q", position: 0, section: "作文", score: 20, snapshot: question },
  ],
};

describe("answer card maker print and persistence contract", () => {
  it("defaults cards to DengXian sans serif independently of the paper font", () => {
    const p = { ...paper, layout: { ...paper.layout, fontFamily: "NSimSun" } };
    const card = generateCardTemplate(p);
    expect(card.layout.fontFamily).toBe(CARD_DEFAULT_FONT);
    const doc = new DOMParser().parseFromString(renderCardSvg(card), "image/svg+xml");
    const font = doc.querySelector("svg > g")!.getAttribute("font-family")!;
    expect(font).toContain('"DengXian"');
    expect(font).toContain('"Noto Sans CJK SC"');
    expect(font.endsWith("sans-serif")).toBe(true);
    expect(font).not.toContain("SimSun");
    expect(p.layout.fontFamily).toBe("NSimSun");
    delete card.layout.fontFamily;
    expect(renderCardSvg(card)).toContain("DengXian");
    const custom = generateCardTemplate(p, {}, { ...card.layout, fontFamily: "SimHei" });
    expect(custom.layout.fontFamily).toBe("SimHei");
  });
  const groupedPaper = (): Paper => ({
    ...paper,
    subject: "数学",
    items: ["SINGLE", "SINGLE", "MULTIPLE", "BLANK", "BLANK", "SUBJECTIVE"].map((type, index) => ({
      ...paper.items[0],
      id: `item-${index}`,
      position: index,
      snapshot: {
        ...question,
        type: type as BankQuestion["type"],
        content: {
          ...question.content,
          options: ["SINGLE", "MULTIPLE"].includes(type)
            ? ["A", "B", "C", "D"].map((label) => ({ label, text: label }))
            : [],
        },
      },
    })),
  });
  it("merges consecutive single/multiple choice and blank rows without changing scan coordinates or numbering", () => {
    const card = generateCardTemplate(groupedPaper());
    card.layout.regions[0].label = "单选题";
    card.layout.regions[2].label = "多选题";
    expect(cardRegionGroups(card.layout, 1).map((g) => g.length)).toEqual([3, 2, 1]);
    const svg = new DOMParser().parseFromString(renderCardSvg(card), "image/svg+xml");
    expect(svg.querySelectorAll('[data-card-group="CHOICE"]')).toHaveLength(1);
    expect(svg.querySelectorAll('[data-card-group="BLANK"]')).toHaveLength(1);
    for (const [index, region] of card.layout.regions.entries()) {
      if (region.kind !== "CHOICE") continue;
      const number = [...svg.querySelectorAll("text")].find(
        (t) => t.textContent === `${index + 1}.`,
      )!;
      const firstBubble = choiceBubbles(region, card.layout)[0];
      expect(Number(number.getAttribute("y"))).toBe(firstBubble.y + 3);
      expect(Number(number.getAttribute("x"))).toBeLessThan(firstBubble.x - 9);
    }
    expect(svg.documentElement.textContent).not.toContain("单项选择题");
    expect(card.layout.regions.map((r) => r.itemId)).toEqual(groupedPaper().items.map((i) => i.id));
  });
  it("repeats group headings across columns and pages, and separates rows moved away from their group", () => {
    const p = groupedPaper();
    p.items = Array.from({ length: 160 }, (_, i) => ({ ...p.items[0], id: `item-${i}` }));
    const card = generateCardTemplate(p, {}, { paperSize: "A4", columns: 2 });
    expect(card.layout.pageCount).toBeGreaterThan(1);
    expect(cardRegionGroups(card.layout, 1)).toHaveLength(2);
    expect(cardRegionGroups(card.layout, 2).length).toBeGreaterThan(0);
    const firstGroupSize = cardRegionGroups(card.layout, 1)[0].length;
    const second = card.layout.regions[1];
    second.y += 1 / card.layout.height;
    expect(
      cardRegionGroups(card.layout, 1)
        .slice(0, 3)
        .map((g) => g.length),
    ).toEqual([1, 1, firstGroupSize - 2]);
  });
  it("packs choices into multiple internal columns and tight rows without carrying material images", () => {
    const p = groupedPaper();
    p.items = Array.from({ length: 14 }, (_, index) => ({
      ...p.items[0],
      id: `item-${index}`,
      snapshot: {
        ...p.items[0].snapshot,
        content: { ...p.items[0].snapshot.content, images: ["/api/platform/assets/material"] },
      },
    }));
    const card = generateCardTemplate(p);
    expect(card.layout.columns).toBe(1);
    const regions = card.layout.regions;
    expect(new Set(regions.map((region) => region.x)).size).toBe(4);
    expect(regions.slice(0, 4).every((region) => region.y === regions[0].y)).toBe(true);
    expect(regions[4].height * card.layout.height).toBeCloseTo(24);
    expect((regions[8].y - regions[4].y) * card.layout.height).toBeCloseTo(25);
    expect(regions.every((region) => !region.image)).toBe(true);
    expect(cardRegionGroups(card.layout, 1)).toHaveLength(1);
    const doc = new DOMParser().parseFromString(renderCardSvg(card), "image/svg+xml");
    expect(doc.querySelectorAll('[data-card-group="CHOICE"]')).toHaveLength(1);
    const frame = doc.querySelector('[data-card-group="CHOICE"] rect')!;
    expect(Number(frame.getAttribute("width"))).toBeCloseTo(684);
    const frameBottom = Number(frame.getAttribute("y")) + Number(frame.getAttribute("height"));
    const lastBubbleBottom = Math.max(
      ...regions.flatMap((region) =>
        choiceBubbles(region, card.layout).map((bubble) => bubble.y + bubble.height / 2),
      ),
    );
    expect(frameBottom - lastBubbleBottom).toBeCloseTo(11);
    expect(doc.querySelectorAll("image")).toHaveLength(0);
    expect(doc.querySelectorAll("text").length).toBeGreaterThan(14);
    const invalid = structuredClone(card);
    invalid.layout.regions[0].image = "/api/platform/assets/material";
    expect(() => validateCardTemplate(invalid)).toThrow(/选择题.*不添加材料图片/);
  });
  it("prints only the question number and score in a writing question heading", () => {
    const p = groupedPaper();
    p.items = Array.from({ length: 15 }, (_, index) => ({
      ...p.items[0],
      id: `item-${index}`,
      ...(index === 14 ? { snapshot: question, score: 13 } : {}),
    }));
    const card = generateCardTemplate(p);
    const doc = new DOMParser().parseFromString(renderCardSvg(card), "image/svg+xml");
    expect([...doc.querySelectorAll("text")].map((node) => node.textContent)).toContain(
      "15（13分）",
    );
  });
  it("uses red for printed text and rules while keeping scan markers and page codes black", () => {
    const card = generateCardTemplate(groupedPaper(), {}, { printColor: "RED" });
    const doc = new DOMParser().parseFromString(renderCardSvg(card), "image/svg+xml");
    const ink = doc.querySelector("svg > g")!;
    expect(ink.getAttribute("fill")).toBe("#d93232");
    expect(
      [...ink.children].slice(0, 4).every((marker) => marker.getAttribute("fill") === "black"),
    ).toBe(true);
    expect(
      [...doc.querySelectorAll("[data-page-code] rect")].every(
        (code) => code.getAttribute("fill") === "black",
      ),
    ).toBe(true);
    expect(
      [...doc.querySelectorAll("[stroke]")].every(
        (rule) => rule.getAttribute("stroke") === "#d93232",
      ),
    ).toBe(true);
    const black = generateCardTemplate(groupedPaper());
    expect(black.layout.printColor).toBe("BLACK");
    expect(renderCardSvg(black)).not.toContain("#d93232");
  });
  for (const paperSize of ["A4", "A3"] as const) {
    it(`${paperSize}: contains notes above the fill examples and separates handwritten exam numbers from the first fill row`, () => {
      const card = generateCardTemplate(groupedPaper(), {}, { paperSize });
      const doc = new DOMParser().parseFromString(renderCardSvg(card), "image/svg+xml");
      for (const line of doc.querySelectorAll("[data-card-note]")) {
        expect(
          Number(line.getAttribute("x")) + Number(line.getAttribute("textLength")),
        ).toBeLessThan(card.layout.width - 355);
        expect(Number(line.getAttribute("y"))).toBeLessThan(229);
      }
      const box = studentNumberBox(card.layout);
      const writing = doc.querySelector("[data-number-boxes] rect")!;
      const writingBottom =
        Number(writing.getAttribute("y")) + Number(writing.getAttribute("height"));
      const firstFillTop = card.layout.studentNumber.y * card.layout.height - 5;
      expect(firstFillTop - writingBottom).toBeGreaterThanOrEqual(4);
      expect(box.y * card.layout.height).toBeCloseTo(Number(writing.getAttribute("y")));
      expect(doc.documentElement.textContent).toContain("考号填涂区");
      expect(doc.documentElement.textContent).not.toContain("每列填一个数字");
    });
  }
  it("retains card display choices through paper and column changes", () => {
    const format: CardLayout = {
      ...generateCardTemplate(paper).layout,
      showAbsent: false,
      headerMode: "ODD_PAGES",
      showFooter: false,
      showSubject: false,
      locked: true,
      paperSize: "A3",
      printColor: "RED",
      orientation: "landscape",
      columns: 2,
    };
    const card = generateCardTemplate(paper, {}, format);
    expect(card.layout).toMatchObject({
      headerMode: "ODD_PAGES",
      showAbsent: false,
      showFooter: false,
      showSubject: false,
      locked: true,
      printColor: "RED",
      width: 1587,
      height: 1123,
      columns: 2,
    });
    const svg = renderCardSvg(card);
    expect(svg).not.toContain("缺考标记");
    expect(svg).not.toContain("请在各题答题区域内作答");
    expect(svg).not.toContain(">语文答题卡<");
    expect(svg).toContain("data-page-code");
    expect(svg.match(/font-size="7"/g)).toHaveLength(60);
  });
  for (const headerMode of ["EVERY_PAGE", "ODD_PAGES", "FIRST_PAGE"] as const) {
    for (const paperSize of ["A4", "A3"] as const) {
      it(`${paperSize} ${headerMode}: prints and reserves the header only on the configured pages in every column`, () => {
        const p = {
          ...paper,
          items: Array.from({ length: 40 }, (_, index) => ({
            ...paper.items[0],
            id: `item-${index}`,
          })),
        };
        const card = generateCardTemplate(p, {}, { headerMode, paperSize, columns: 2 });
        expect(card.layout.pageCount).toBeGreaterThanOrEqual(4);
        for (let page = 1; page <= card.layout.pageCount; page++) {
          const visible =
            headerMode === "EVERY_PAGE" ||
            page === 1 ||
            (headerMode === "ODD_PAGES" && page % 2 === 1);
          const svg = new DOMParser().parseFromString(renderCardSvg(card, page), "image/svg+xml");
          expect(svg.querySelector("parsererror")).toBeNull();
          expect(!!svg.querySelector("[data-card-header]")).toBe(visible);
          expect(svg.documentElement.textContent?.includes("姓名：")).toBe(visible);
          expect(svg.documentElement.textContent?.includes("注意事项：")).toBe(visible);
          expect(svg.querySelectorAll("[data-number-boxes]").length).toBe(visible ? 1 : 0);
          expect(svg.querySelector(`[data-page-code="${page}"]`)).not.toBeNull();
          const regions = card.layout.regions.filter((region) => region.page === page);
          for (const x of new Set(regions.map((region) => region.x))) {
            expect(regions.find((region) => region.x === x)!.y * card.layout.height).toBeCloseTo(
              visible ? 275 : 95,
            );
          }
        }
        expect(() => validateCardTemplate(card, p)).not.toThrow();
      });
    }
  }
  it("allows answers and annotations in the unused number area only on pages without a header", () => {
    const card = generateCardTemplate(paper, {}, { headerMode: "FIRST_PAGE" });
    card.layout.pageCount = 2;
    const box = studentNumberBox(card.layout);
    card.layout.regions[0] = { ...card.layout.regions[0], page: 2, y: 95 / card.layout.height };
    card.layout.annotations = [{ ...box, id: "note", page: 2, text: "附加说明" }];
    expect(() => validateCardTemplate(card)).not.toThrow();
    card.layout.headerMode = "EVERY_PAGE";
    expect(() => validateCardTemplate(card)).toThrow();
    expect(cardPageContentTop(card.layout, 2)).toBe(275);
  });
  it("prints essay grids and ruled lines with escaped labels", () => {
    const card = generateCardTemplate(paper);
    card.layout.regions[0] = {
      ...card.layout.regions[0],
      writingStyle: "grid",
      label: "作文<script>",
    };
    const grid = renderCardSvg(card);
    expect(grid).toContain("作文&lt;script&gt;");
    expect(grid).toContain('stroke-width="0.5"');
    card.layout.regions[0].writingStyle = "lines";
    expect(renderCardSvg(card)).toContain('stroke-width="0.6"');
    expect(choiceBubbles(card.layout.regions[0], card.layout)).toEqual([]);
  });
  it("accepts an atomic card and paper revision and retains the options in the API schema", () => {
    const card = generateCardTemplate(paper);
    card.layout.showAbsent = false;
    card.layout.showFooter = false;
    card.layout.headerMode = "FIRST_PAGE";
    card.layout.printColor = "RED";
    card.layout.regions[0].writingStyle = "grid";
    const parsed = commandSchema.parse({
      type: "template.save",
      template: { paperId: paper.id, name: card.name, subject: paper.subject, layout: card.layout },
      paperDraft: {
        itemIds: ["item"],
        items: [
          {
            questionId: "q",
            score: 20,
            section: "作文",
            question: {
              type: question.type,
              subject: question.subject,
              grade: question.grade,
              difficulty: question.difficulty,
              knowledgeTags: [],
              content: question.content,
            },
          },
        ],
      },
    });
    expect(parsed.type).toBe("template.save");
    if (parsed.type !== "template.save") throw new Error("Unexpected command");
    expect(parsed.template.layout.showAbsent).toBe(false);
    expect(parsed.template.layout.headerMode).toBe("FIRST_PAGE");
    expect(parsed.template.layout.printColor).toBe("RED");
    expect(parsed.template.layout.regions[0].writingStyle).toBe("grid");
    expect(parsed.paperDraft?.itemIds).toEqual(["item"]);
  });
});

// Regression: completing a newly added question must not remove its saved card.
it("preserves card references when only question text or answers change", async () => {
  const { vi } = await import("vitest");
  const { executePapersCommand } = await import("@/server/platform/commands/papers");
  const original = { ...paper.items[0], paperId: paper.id };
  const deleteCards = vi.fn();
  const update = vi.fn().mockResolvedValue({ id: paper.id });
  const db = {
    paper: {
      findUnique: vi.fn().mockResolvedValue(paper),
      findUniqueOrThrow: vi.fn().mockResolvedValue(paper),
      update,
    },
    assessment: { count: vi.fn().mockResolvedValue(0) },
    assessmentParticipantSubject: { count: vi.fn().mockResolvedValue(0) },
    question: { findMany: vi.fn().mockResolvedValue([]) },
    cardTemplate: { deleteMany: deleteCards },
  };
  await executePapersCommand(
    db as unknown as Parameters<typeof executePapersCommand>[0],
    { id: "teacher", name: "教师", role: "TEACHER" },
    {
      type: "paper.save",
      paper: {
        id: paper.id,
        name: paper.name,
        kind: "EXAM",
        subject: paper.subject,
        grade: paper.grade,
        instructions: "",
        layout: paper.layout,
        items: [
          {
            questionId: question.id,
            section: "作文",
            score: 20,
            question: {
              type: question.type,
              subject: question.subject,
              grade: question.grade,
              difficulty: 0.5,
              knowledgeTags: [],
              content: { ...question.content, stem: "完善后的题干", answers: ["参考答案"] },
            },
          },
        ],
      },
    },
  );
  expect(deleteCards).not.toHaveBeenCalled();
  expect(update.mock.calls[0][0].data.items[0].id).toBe(original.id);
});
