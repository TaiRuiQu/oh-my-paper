import { describe, expect, it } from "vitest";
import { isWrong, mastery } from "@/server/learning/projection";
import { publicPracticeQuestions } from "@/server/learning/serialization";
import { applyGradeReview } from "@/server/grading/score";
import { gradeResultSchema, type GradeQuestionResult } from "@/contracts/grading";
const q: GradeQuestionResult = {
  questionId: "q1",
  number: "1",
  section: "",
  studentAnswer: "4",
  questionText: "2+3=?",
  sourcePage: 1,
  expectedAnswer: "5",
  referenceOrigin: "supplied",
  rubric: "答对得5分",
  maxPoints: 5,
  score: 0,
  suggestedScore: 0,
  verdict: "incorrect",
  feedback: "加法有误",
  criteria: [],
  needsReview: false,
  reviewReasons: [],
  failed: false,
  review: null,
  reviewHistory: [],
};
describe("learning uses valid current evidence", () => {
  it("archives mistakes, partial marks and blanks but excludes unjudged/failed evidence", () => {
    expect(isWrong(q)).toBe(true);
    expect(isWrong({ ...q, score: 2 })).toBe(true);
    expect(isWrong({ ...q, verdict: "unanswered" })).toBe(true);
    for (const item of [
      { ...q, needsReview: true },
      { ...q, failed: true },
      { ...q, score: null },
      { ...q, maxPoints: null },
      { ...q, score: 5 },
      { ...q, score: 0, maxPoints: 0 },
    ])
      expect(isWrong(item)).toBe(false);
  });
  it("teacher correction removes a mistake despite the previous AI verdict", () => {
    const result = gradeResultSchema.parse({
      schemaVersion: "1.0",
      examId: "e",
      model: "fixture",
      promptVersion: "test",
      questions: [q],
      totals: {
        awardedPoints: 0,
        gradedMaxPoints: 5,
        totalMaxPoints: 5,
        totalQuestions: 1,
        scoredQuestions: 1,
        pendingQuestions: 0,
        failedQuestions: 0,
      },
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        calls: 0,
      },
    });
    const updated = applyGradeReview(
      result,
      { questionId: "q1", score: 5, maxPoints: 5, note: "核对正确" },
      "teacher",
      "2026-10-12T00:00:00Z",
    );
    expect(isWrong(updated.questions[0])).toBe(false);
    expect(updated.questions[0].reviewHistory).toHaveLength(1);
  });
  it("requires two consecutive correct attempts and revokes mastery after a mistake", () => {
    expect(mastery([])).toBe(false);
    expect(mastery([{ correct: true }])).toBe(false);
    expect(mastery([{ correct: true }, { correct: true }])).toBe(true);
    expect(mastery([{ correct: true }, { correct: true }, { correct: false }])).toBe(false);
    expect(mastery([{ correct: false }, { correct: true }, { correct: true }])).toBe(true);
  });
  it("practice payload never contains reference answers, explanations or rubrics", () => {
    const result = publicPracticeQuestions({
      questions: [
        {
          id: "p1",
          stem: "2+3=?",
          answer: "PRIVATE_ANSWER",
          explanation: "PRIVATE_EXPLANATION",
          rubric: "PRIVATE_RUBRIC",
          maxPoints: 5,
          topicId: "arithmetic",
        },
      ],
    });
    const json = JSON.stringify(result);
    expect(json).not.toContain("PRIVATE");
    expect(result[0].stem).toBe("2+3=?");
    expect(Object.keys(result[0])).toEqual(["id", "stem", "maxPoints", "topicId"]);
  });
});
