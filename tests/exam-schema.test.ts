import { describe, expect, it } from "vitest";
import {
  parsedExamSchema,
  examAnswerSchema,
  submissionSchema,
  materialSchema,
  questionSchema,
  sectionSchema,
  examQuestionCount,
  examLayoutSchema,
  resolveExamLayout,
} from "@/contracts/exams";
const question = {
  number: 15,
  description: "**求解** $x^2=4$（2 分）",
  materials: [],
  score: 2,
  subquestions: [],
};
const section = {
  number: "四",
  title: "解答题",
  description: "解答应写出演算步骤。",
  score: 2,
  questions: [question],
};
const exam = { name: "数学", totalScore: 2, sections: [section] };
describe("hierarchical exam contracts", () => {
  it("validates paper and column metadata while preserving old records without layout", () => {
    expect(resolveExamLayout()).toEqual({ paperSize: "A4", columns: 1, orientation: "portrait" });
    for (const columns of [1, 2, 3, 4])
      expect(examLayoutSchema.parse({ paperSize: "A3", columns }).columns).toBe(columns);
    for (const layout of [
      { paperSize: "A5", columns: 1 },
      { paperSize: "A4", columns: 0 },
      { paperSize: "A4", columns: 5 },
      { paperSize: "A4", columns: 1.5 },
    ])
      expect(parsedExamSchema.safeParse({ ...exam, layout }).success).toBe(false);
    expect(parsedExamSchema.parse(exam).layout).toBeUndefined();
  });
  it("accepts only numbered sections, questions and subquestions with source content", () => {
    expect(parsedExamSchema.parse(exam).sections[0].questions[0]).toEqual(question);
    for (const extra of ["verification", "annotations", "template", "solution", "confidence"])
      expect(
        parsedExamSchema.safeParse({
          ...exam,
          sections: [{ ...section, questions: [{ ...question, [extra]: {} }] }],
        }).success,
      ).toBe(false);
    expect(
      parsedExamSchema.safeParse({
        ...exam,
        verification: {},
      }).success,
    ).toBe(false);
  });
  it("preserves zero and fractional scores and represents unknown scores with null", () => {
    for (const score of [0, 2.5, null])
      expect(
        parsedExamSchema.parse({
          ...exam,
          totalScore: score,
          sections: [{ ...section, score, questions: [{ ...question, score }] }],
        }).totalScore,
      ).toBe(score);
    for (const score of [-1, Infinity, NaN])
      expect(parsedExamSchema.safeParse({ ...exam, totalScore: score }).success).toBe(false);
  });
  it("rejects empty exams and boxes outside a page", () => {
    expect(parsedExamSchema.safeParse({ ...exam, sections: [] }).success).toBe(false);
    expect(sectionSchema.safeParse({ ...section, questions: [] }).success).toBe(false);
    const box = { page: 1, x: 0.1, y: 0.2, width: 0.5, height: 0.5 };
    expect(materialSchema.parse(box)).toEqual(box);
    for (const change of [{ page: 0 }, { x: -0.1 }, { width: 0 }, { width: 1 }, { y: 1 }])
      expect(materialSchema.safeParse({ ...box, ...change }).success).toBe(false);
  });
  it("distinguishes Chinese section labels, Arabic question numbers and parenthesized part labels", () => {
    for (const number of ["1", "一、", "(1)"])
      expect(sectionSchema.safeParse({ ...section, number }).success).toBe(false);
    for (const number of ["15", 0, 1.5])
      expect(questionSchema.safeParse({ ...question, number }).success).toBe(false);
    const part = { number: "(1)", description: "证明。", materials: [], score: null };
    const withParts = {
      ...question,
      subquestions: [part, { ...part, number: "(2)", description: "(i) 证明甲；(ii) 证明乙。" }],
    };
    expect(questionSchema.parse(withParts).subquestions[1].description).toContain("(ii)");
    expect(questionSchema.parse({ ...withParts, description: "" }).description).toBe("");
    expect(questionSchema.safeParse({ ...question, description: "" }).success).toBe(false);
    for (const number of ["1", "（1）", "(0)", "(i)"])
      expect(
        questionSchema.safeParse({ ...question, subquestions: [{ ...part, number }] }).success,
      ).toBe(false);
    expect(questionSchema.safeParse({ ...question, subquestions: [part, part] }).success).toBe(
      false,
    );
    expect(sectionSchema.safeParse({ ...section, questions: [question, question] }).success).toBe(
      false,
    );
    expect(parsedExamSchema.safeParse({ ...exam, sections: [section, section] }).success).toBe(
      false,
    );
  });
  it("keeps identical type headings as separate sections and preserves original Arabic numbering", () => {
    const grouped = parsedExamSchema.parse({
      ...exam,
      sections: [
        {
          ...section,
          number: "一",
          title: "选择题",
          description: "只有一项符合题目要求。",
          questions: [{ ...question, number: 8 }],
        },
        {
          ...section,
          number: "二",
          title: "选择题",
          description: "有多项符合题目要求。",
          questions: [{ ...question, number: 9 }],
        },
        {
          ...section,
          questions: [
            {
              ...question,
              subquestions: [
                { number: "(1)", description: "求证。", materials: [], score: null },
                { number: "(2)", description: "求和。", materials: [], score: null },
              ],
            },
          ],
        },
      ],
    });
    expect(grouped.sections.map((section) => section.questions[0].number)).toEqual([8, 9, 15]);
    expect(examQuestionCount(grouped)).toBe(3);
    expect(grouped.sections[2].questions[0].subquestions.map((part) => part.score)).toEqual([
      null,
      null,
    ]);
  });
  it("keeps solutions and submissions separate and prevents duplicate question references", () => {
    const examId = "10000000-0000-4000-8000-000000000001",
      questionId = "10000000-0000-4000-8000-000000000002";
    const answer = { questionId, solution: "$x=\\pm 2$", gradingCriteria: "每个根 1 分。" };
    expect(
      examAnswerSchema.parse({ examId, questions: [{ questionId, solution: "A" }] }).questions[0],
    ).not.toHaveProperty("gradingCriteria");
    expect(examAnswerSchema.parse({ examId, questions: [answer] }).questions[0]).toEqual(answer);
    expect(examAnswerSchema.safeParse({ examId, questions: [answer, answer] }).success).toBe(false);
    const submitted = { questionId, answer: "$x=2$", correct: false, score: 1 };
    expect(
      submissionSchema.parse({
        id: "10000000-0000-4000-8000-000000000003",
        examId,
        studentId: null,
        answers: [submitted],
      }).answers[0],
    ).toEqual(submitted);
  });
});
