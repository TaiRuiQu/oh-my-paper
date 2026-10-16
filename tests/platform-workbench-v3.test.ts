import { describe, it, expect } from "vitest";
import type { BankQuestion, Paper, AssessmentPaper, Review } from "@/contracts/platform";
import { pageDimensions, orderedDocumentBlocks } from "@/lib/document-layout";
import {
  generateCardTemplate,
  choiceBubbles,
  fitAnnotationText,
  validateCardTemplate,
  annotationTextLines,
} from "@/lib/cards";
import { renderCardHtml, renderCardSvg, renderPaperHtml } from "@/server/platform/print";
import { commandSchema } from "@/server/platform/schemas";
import { finalGrades } from "@/server/platform/analytics";
const question: BankQuestion = {
  id: "local",
  ownerId: "teacher",
  type: "SINGLE",
  subject: "数学",
  grade: "高中一年级",
  difficulty: 0.5,
  knowledgeTags: [],
  createdAt: "",
  updatedAt: "",
  content: {
    stem: "自行编写的题目",
    options: ["A", "B", "C", "D"].map((label) => ({ label, text: label })),
    answers: ["A"],
    explanation: "",
    rubric: "",
    parts: [],
    images: [],
  },
};
const paper: Paper = {
  id: "paper",
  ownerId: "teacher",
  name: "排版测试",
  kind: "EXAM",
  subject: "数学",
  grade: "高中一年级",
  instructions: "",
  createdAt: "",
  updatedAt: "",
  layout: { paperSize: "A4", columns: 1 },
  items: Array.from({ length: 24 }, (_, i) => ({
    id: `i${i}`,
    questionId: `q${i}`,
    score: 10,
    section: "选择题",
    position: i,
    snapshot: question,
  })),
};
const config: AssessmentPaper = {
  paperId: "paper",
  subject: "数学",
  gradingMode: "SINGLE",
  arbitrationThreshold: 0,
  conversion: { enabled: false, bands: [] },
  questionRules: { i0: { doubleReview: true, arbitrationEnabled: true, maxDifference: 2 } },
};
const submission = { id: "s" } as Parameters<typeof finalGrades>[2];
const review = (round: Review["round"], score: number): Review => ({
  id: round,
  version: 1,
  round,
  score,
  itemId: "i0",
  submissionId: "s",
  reviewerId: round,
  feedback: "",
  createdAt: "",
});
describe("desktop document formats and question-level independent grading", () => {
  it("requires two teacher confirmations when an AI suggestion exists on a double-reviewed question", () => {
    const first = { ...review("FIRST", 8), source: "AI" as const },
      second = { ...review("SECOND", 6), source: "HUMAN" as const };
    expect(finalGrades(paper, config, submission, [first, second])[0].score).toBeNull();
    expect(
      finalGrades(paper, config, submission, [{ ...first, source: "HUMAN" }, second])[0].score,
    ).toBe(7);
  });

  it("keeps right-edge annotations inside smaller formats and wraps preview/print identically", () => {
    const template = generateCardTemplate({
      ...paper,
      layout: { paperSize: "A3", orientation: "landscape", columns: 3 },
    });
    const note = fitAnnotationText(
      {
        id: "note",
        text: "附加说明",
        page: 1,
        x: 1400 / 1587,
        y: 244 / 1123,
        width: 120 / 1587,
        height: 16 / 1123,
      },
      template.layout,
    );
    template.layout.annotations = [note];
    const smaller = generateCardTemplate(
      paper,
      {},
      { ...template.layout, paperSize: "A4", orientation: "portrait" },
    );
    expect(
      smaller.layout.annotations![0].x + smaller.layout.annotations![0].width,
    ).toBeLessThanOrEqual(1);
    const a = smaller.layout.annotations![0];
    smaller.layout.annotations = [
      fitAnnotationText(
        {
          ...a,
          text: "这是一段足够长的文字，用来验证自动换行与卡面实际高度。",
          y: 65 / smaller.layout.height,
          x: 60 / smaller.layout.width,
        },
        smaller.layout,
      ),
    ];
    const preview = renderCardSvg(smaller, 1, false),
      printed = renderCardSvg(smaller, 1, true);
    expect(preview).toBe(printed);
    expect(
      annotationTextLines(smaller.layout.annotations[0].text, a.width * smaller.layout.width)
        .length,
    ).toBeGreaterThan(1);
    smaller.layout.annotations[0].height = 1 / smaller.layout.height;
    expect(() => validateCardTemplate(smaller)).toThrow("高度不足");
  });
  it("treats decimal equidistance and exact threshold differences without floating-point bias", () => {
    expect(
      finalGrades(paper, config, submission, [
        review("FIRST", 1.1),
        review("SECOND", 8.9),
        review("ARBITRATION", 5),
      ])[0].score,
    ).toBe(5);
    const settings = {
      ...config,
      questionRules: { i0: { doubleReview: true, arbitrationEnabled: true, maxDifference: 0.3 } },
    };
    expect(
      finalGrades(paper, settings, submission, [review("FIRST", 0.4), review("SECOND", 0.1)])[0],
    ).toMatchObject({ status: "FINAL", score: 0.25 });
  });

  for (const paperSize of ["A4", "A3"] as const)
    for (const orientation of ["portrait", "landscape"] as const)
      for (const columns of [1, 2, 3, 4]) {
        it(`${paperSize} ${orientation} ${columns} columns keeps rectangular OMR inside every region`, () => {
          const document = { ...paper, layout: { paperSize, orientation, columns } };
          const template = generateCardTemplate(document),
            l = template.layout;
          const cardOrientation = paperSize === "A3" ? "landscape" : "portrait";
          expect({ width: l.width, height: l.height }).toEqual(
            pageDimensions(paperSize, cardOrientation),
          );
          expect(l.regions).toHaveLength(24);
          for (const region of l.regions)
            for (const box of choiceBubbles(region, l)) {
              expect(box.x - 9).toBeGreaterThanOrEqual(region.x * l.width);
              expect(box.x + 9).toBeLessThanOrEqual((region.x + region.width) * l.width);
              expect(box.y + 5).toBeLessThanOrEqual((region.y + region.height) * l.height);
            }
          const svg = renderCardSvg(template);
          expect(svg).not.toContain("<circle");
          expect(svg).toContain(">选择题</text>");
          expect(svg).not.toContain("1. 单项选择题");
          expect(renderCardHtml(template)).toContain(`size:${paperSize} ${cardOrientation}`);
          expect(renderPaperHtml(document)).toContain(`size:${paperSize} ${orientation}`);
        });
      }
  it("saves a paper-only question and arbitrary text without requiring a bank record", () => {
    const result = commandSchema.safeParse({
      type: "paper.save",
      paper: {
        ...paper,
        layout: {
          ...paper.layout,
          fontFamily: "NSimSun",
          textBlocks: [{ id: "text", text: "阅读材料", beforeQuestionId: "local" }],
        },
        items: [{ questionId: "local", question, score: 10, section: "" }],
      },
    });
    expect(result.success).toBe(true);
    const layout = {
      ...paper.layout,
      textBlocks: [
        { id: "text", text: "阅读材料", beforeQuestionId: "q0" },
        { id: "end", text: "结束" },
      ],
    };
    expect(
      orderedDocumentBlocks([{ key: "q0" }], layout, (b) => ({ key: b.id })).map((b) => b.key),
    ).toEqual(["text", "q0", "end"]);
    const html = renderPaperHtml({ ...paper, layout });
    expect(html.indexOf("阅读材料")).toBeLessThan(html.indexOf("自行编写的题目"));
    expect(html).toContain('font-family:"NSimSun"');
  });
  it("waits for the first reviewer when the second finishes first", () => {
    expect(finalGrades(paper, config, submission, [review("SECOND", 8)])[0]).toMatchObject({
      status: "PENDING",
      score: null,
    });
    expect(
      finalGrades(paper, config, submission, [review("SECOND", 8), review("FIRST", 6)])[0],
    ).toMatchObject({ status: "FINAL", score: 7 });
  });
  it("averages normally with arbitration disabled even beyond the threshold", () => {
    const settings = {
      ...config,
      questionRules: { i0: { doubleReview: true, arbitrationEnabled: false, maxDifference: 2 } },
    };
    expect(
      finalGrades(paper, settings, submission, [review("FIRST", 9), review("SECOND", 1)])[0].score,
    ).toBe(5);
  });
  it("uses the closer original review with the arbitration score", () => {
    expect(
      finalGrades(paper, config, submission, [
        review("FIRST", 9),
        review("SECOND", 1),
        review("ARBITRATION", 7),
      ])[0].score,
    ).toBe(8);
    expect(
      finalGrades(paper, config, submission, [
        review("FIRST", 9),
        review("SECOND", 1),
        review("ARBITRATION", 3),
      ])[0].score,
    ).toBe(2);
    expect(
      finalGrades(paper, config, submission, [
        review("FIRST", 9),
        review("SECOND", 1),
        review("ARBITRATION", 5),
      ])[0].score,
    ).toBe(5);
  });
  it("keeps another question single-reviewed in the same paper", () => {
    expect(
      finalGrades(paper, config, submission, [{ ...review("FIRST", 8), itemId: "i1" }])[1],
    ).toMatchObject({ score: 8, status: "FINAL" });
  });
});
