import { describe, expect, it } from "vitest";
import type { BankQuestion, CardLayout, Paper } from "@/contracts/platform";
import { generateCardTemplate, choiceBubbles } from "@/lib/cards";
import { renderCardSvg } from "@/lib/card-svg";
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
  it("retains card display choices through paper and column changes", () => {
    const format: CardLayout = {
      ...generateCardTemplate(paper).layout,
      showAbsent: false,
      showFooter: false,
      showSubject: false,
      locked: true,
      paperSize: "A3",
      orientation: "landscape",
      columns: 2,
    };
    const card = generateCardTemplate(paper, {}, format);
    expect(card.layout).toMatchObject({
      showAbsent: false,
      showFooter: false,
      showSubject: false,
      locked: true,
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
    paper: { findUnique: vi.fn().mockResolvedValue(paper), update },
    paperItem: { findMany: vi.fn().mockResolvedValue([original]), deleteMany: vi.fn() },
    assessmentPaper: { count: vi.fn().mockResolvedValue(0) },
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
  expect(update.mock.calls[0][0].data.items.create[0].id).toBe(original.id);
});
