import { describe, expect, it } from "vitest";
import type { ExamInventory, QuestionTranscription } from "@/contracts/exams";
import { validateInventory } from "@/server/exams/parser";
import { solutionIssues } from "@/server/exams/solutions";
const r1 = { page: 1, x: 0.1, y: 0.1, width: 0.5, height: 0.5 };
const inventory: ExamInventory = {
  title: "跨页试卷",
  subject: "数学",
  grade: null,
  instructions: [],
  totalQuestions: 1,
  totalPoints: 10,
  pages: [1, 2].map((page) => ({ page, documentType: "question_paper" })),
  sections: [{ title: "填空", points: 10 }],
  questions: [
    {
      number: "1",
      section: "填空",
      points: 10,
      pointsOrigin: "inferred",
      pointsReason: "本节一题共10分",
      pages: [1, 2],
    },
  ],
  findings: [],
};
const transcription: QuestionTranscription = {
  type: "fill_blank",
  blocks: [
    { type: "text", text: "根据数据表填两个空：____、____。" },
    { type: "figure", figureId: "figure-1", caption: "数据表" },
    { type: "text", text: "表后条件。" },
  ],
  options: [],
  parts: [],
  answerTargets: [1, 2].map((blankIndex) => ({
    key: `blank-${blankIndex}`,
    blankIndex,
    partLabel: null,
    parentLabel: null,
  })),
  findings: [],
};
describe("paper compatibility validation", () => {
  it("rejects a sufficient solution that omits one blank or its explanation", () => {
    const question = {
      id: "q",
      number: "1",
      section: "填空",
      type: "fill_blank" as const,
      points: 10,
      blocks: [],
      parts: [],
      options: [],
      materialRefs: [],
      regions: [r1],
      status: "ready" as const,
      answerTargets: transcription.answerTargets,
    };
    const solution = {
      answer: "10",
      selectedOptions: [],
      explanation: "计算。",
      rubric: "",
      sufficient: true,
      issues: [],
      model: "fixture",
      origin: "ai" as const,
      units: [{ targetKey: "blank-1", answer: "10", selectedOptions: [], explanation: "计算。" }],
    };
    expect(solutionIssues(question, solution)).toContain("标准答案未完整覆盖每个小问或填空。");
  });
  it("checks numeric score totals and refuses an empty inventory when stems are visible", () => {
    const pages = [1, 2].map((page) => ({
      page,
      key: "",
      path: "",
      width: 100,
      height: 100,
      rotation: 0,
      text: "",
      isPhotograph: false,
    }));
    expect(() => validateInventory({ ...inventory, totalPoints: 20 }, pages)).toThrow(
      /declared paper total/,
    );
    expect(() =>
      validateInventory({ ...inventory, sections: [{ title: "填空", points: 20 }] }, pages),
    ).toThrow(/Section/);
    expect(() =>
      validateInventory(
        {
          ...inventory,
          questions: [],
          totalQuestions: 0,
          pages: inventory.pages.map((p) => ({
            ...p,
            documentType: "mixed",
            hasQuestionStems: true,
          })),
        },
        pages,
      ),
    ).toThrow(/printed question stems/);
  });
});
