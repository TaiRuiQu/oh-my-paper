import { describe, expect, it } from "vitest";
import { commandSchema } from "@/server/platform/schemas";
import { renderPaperHtml } from "@/server/platform/print";
import { scopePageState } from "@/server/platform/page-state";
import type { Paper, PlatformState } from "@/contracts/platform";
import { DOCUMENT_DEFAULTS, documentAnswerSpaceMm, documentFont } from "@/lib/document-layout";

const question = {
  id: "q",
  ownerId: "t",
  type: "SUBJECTIVE" as const,
  subject: "数学",
  grade: "高一",
  difficulty: 0.5,
  knowledgeTags: ["函数"],
  createdAt: "",
  updatedAt: "",
  content: {
    stem: "$x^2$ <script>alert(1)</script>",
    answers: ["2"],
    options: [],
    parts: [],
    images: [],
    explanation: "",
    rubric: "",
  },
};
const paper: Paper = {
  id: "p",
  ownerId: "t",
  name: "练习册",
  kind: "HOMEWORK",
  subject: "数学",
  grade: "高一",
  instructions: "独立完成",
  createdAt: "",
  updatedAt: "",
  layout: {
    paperSize: "A4",
    columns: 1,
    marginMm: 20,
    fontSizePt: 12,
    lineHeight: 2,
    questionLayouts: { q: { answerSpaceMm: 42, pageBreakBefore: true, spaceAfterMm: 10 } },
  },
  items: [{ id: "i", questionId: "q", position: 0, score: 5, section: "练习", snapshot: question }],
};

describe("persisted document layout and module boundaries", () => {
  it("uses writing space defaults and honors explicit heights, including zero", () => {
    expect(documentAnswerSpaceMm(DOCUMENT_DEFAULTS, question)).toBe(35);
    expect(documentAnswerSpaceMm(DOCUMENT_DEFAULTS, { ...question, type: "SINGLE" })).toBe(0);
    expect(documentAnswerSpaceMm(DOCUMENT_DEFAULTS, { ...question, type: "BLANK" })).toBe(0);
    for (const height of [0, 20, 60.5]) {
      const layout = { ...DOCUMENT_DEFAULTS, questionLayouts: { q: { answerSpaceMm: height } } };
      expect(documentAnswerSpaceMm(layout, question)).toBe(height);
      const html = renderPaperHtml({ ...paper, layout });
      if (height === 0) expect(html).not.toContain('class="p-workbook-answer-space"');
      else expect(html).toContain(`class="p-workbook-answer-space" style="height:${height}mm"`);
    }
  });
  it("pairs four choices for the main question and subquestions in printable HTML", () => {
    const choices = ["$a>b>c$", "$b>c>a$", "$b>a>c$", "$c>a>b$"].map((text, index) => ({
      label: String.fromCharCode(65 + index),
      text,
    }));
    const html = renderPaperHtml({
      ...paper,
      items: [
        {
          ...paper.items[0],
          snapshot: {
            ...question,
            content: {
              ...question.content,
              options: choices,
              parts: [
                {
                  id: "part",
                  type: "SINGLE",
                  stem: "选择",
                  score: 1,
                  options: choices,
                  answers: ["A"],
                  rubric: "",
                  explanation: "",
                  knowledgeTags: [],
                },
              ],
            },
          },
        },
      ],
    });
    expect(html.match(/class="p-document-option-pair"/g)).toHaveLength(4);
    expect(html.match(/class="p-document-option"/g)).toHaveLength(8);
  });
  it("defaults to compact divided columns and reserves blank space for written responses", () => {
    const layout = { ...DOCUMENT_DEFAULTS };
    expect(layout).toMatchObject({ columns: 2, marginMm: 12, fontSizePt: 11, lineHeight: 1.35 });
    expect(documentAnswerSpaceMm(layout, question)).toBe(35);
    const html = renderPaperHtml({ ...paper, layout });
    expect(html).toContain("margin:12mm 12mm 20mm");
    expect(html).toContain("column-count:2;column-gap:6mm;column-rule:0.5pt solid #666");
    expect(html).toContain('class="p-workbook-answer-space" style="height:35mm"');
    expect(html).not.toContain("作答：");
    expect(html).toContain(
      '<strong class="p-document-question-number">1.</strong><div class="p-document-text">',
    );
    expect(html).not.toContain("5 分");
    expect(html).not.toContain('class="p-document-question-heading"');
  });
  it("accepts a named local font and safely quotes the family in printable CSS", () => {
    const layout = { ...DOCUMENT_DEFAULTS, fontFamily: "霞鹜文楷 Screen" };
    expect(
      commandSchema.safeParse({
        type: "paper.save",
        paper: {
          ...paper,
          layout,
          items: [{ questionId: "q", score: 5, section: "", content: question.content }],
        },
      }).success,
    ).toBe(true);
    expect(documentFont(layout.fontFamily).startsWith('"霞鹜文楷 Screen",')).toBe(true);
    expect(
      commandSchema.safeParse({
        type: "paper.save",
        paper: {
          ...paper,
          layout: { ...layout, fontFamily: 'foo"; color:red' },
          items: [{ questionId: "q", score: 5, section: "", content: question.content }],
        },
      }).success,
    ).toBe(false);
  });
  it("prints the saved typography, page breaks and workbook answer space with safe mathematics", () => {
    const html = renderPaperHtml(paper);
    expect(html).toContain("margin:20mm 20mm");
    expect(html).toContain("font-size:12pt;line-height:2");
    expect(html).toContain("练习");
    expect(html).toContain("padding-bottom:10mm");
    expect(html).toContain('class="p-workbook-answer-space" style="height:42mm"');
    expect(html).toContain("<math");
    expect(html).toContain('class="katex-html" aria-hidden="true"');
    expect(html).toContain('href="/print-fonts/katex/katex.min.css"');
    expect(html).not.toContain("<script>");
    expect(renderPaperHtml({ ...paper, kind: "EXAM" })).not.toContain(
      'class="p-workbook-answer-space"',
    );
  });
  it("rejects invalid document sizes, excessive answer space and empty edited questions", () => {
    const base = {
      type: "paper.save",
      paper: {
        ...paper,
        items: [{ questionId: "q", score: 5, section: "", content: question.content }],
      },
    };
    expect(commandSchema.safeParse(base).success).toBe(true);
    expect(
      commandSchema.safeParse({
        ...base,
        paper: { ...base.paper, layout: { ...paper.layout, marginMm: 0 } },
      }).success,
    ).toBe(false);
    expect(
      commandSchema.safeParse({
        ...base,
        paper: {
          ...base.paper,
          layout: { ...paper.layout, questionLayouts: { q: { answerSpaceMm: 1000 } } },
        },
      }).success,
    ).toBe(false);
    expect(
      commandSchema.safeParse({
        ...base,
        paper: {
          ...base.paper,
          items: [
            { questionId: "q", score: 5, section: "", content: { ...question.content, stem: "" } },
          ],
        },
      }).success,
    ).toBe(false);
  });
  it("keeps homework out of exam pages and excludes answer-card tools from homework", () => {
    const state = {
      actor: { id: "t", name: "t", role: "TEACHER" },
      questions: [question],
      papers: [paper, { ...paper, id: "ep", kind: "EXAM" }],
      classrooms: [],
      assessments: [],
      submissions: [],
      reviews: [],
      users: [],
      templates: [{ id: "card" }],
      analytics: { results: [], knowledge: [], students: [], classrooms: [] },
    } as unknown as PlatformState;
    expect(scopePageState(state, "homework").papers.map((p) => p.kind)).toEqual(["HOMEWORK"]);
    expect(scopePageState(state, "homework").templates).toEqual([]);
    expect(scopePageState(state, "exams").papers.map((p) => p.kind)).toEqual(["EXAM"]);
    expect(() =>
      scopePageState({ ...state, actor: { id: "s", name: "s", role: "STUDENT" } }, "exams"),
    ).toThrow("教师权限");
    expect(() => scopePageState(state, "admin")).toThrow("管理员权限");
  });
});
