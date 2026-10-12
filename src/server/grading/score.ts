import { gradeReviewSchema, type GradeQuestionResult, type GradeResult, type GradeReviewInput } from "@/contracts/grading";
import type { z } from "zod";
import type { assessmentSchema } from "@/contracts/grading";

const cents = (value: number) => Math.round(value * 100);
const sum = (values: number[]) => values.reduce((total, value) => total + cents(value), 0) / 100;

export function scoreIssues(assessment: z.infer<typeof assessmentSchema>, maxPoints: number | null) {
  const issues: string[] = [];
  if (maxPoints === null) return ["题目分值未设置，无法汇总得分。"];
  const score = assessment.score;
  if (score === null) return ["模型未给出可验证的分数。"];
  if (score > maxPoints) issues.push("模型分数超出题目满分。");
  if (!assessment.criteria.length || cents(sum(assessment.criteria.map((c) => c.maxPoints))) !== cents(maxPoints)) issues.push("评分点满分之和与题目分值不一致。");
  if (cents(sum(assessment.criteria.map((c) => c.awardedPoints))) !== cents(score)) issues.push("评分点得分之和与模型分数不一致。");
  if (assessment.criteria.some((c) => c.awardedPoints > c.maxPoints)) issues.push("评分点得分超出该点满分。");
  if (assessment.verdict === "correct" && cents(score) !== cents(maxPoints)) issues.push("正确判定与分数不一致。");
  if (["incorrect", "unanswered"].includes(assessment.verdict) && score !== 0) issues.push("错误或未作答判定与分数不一致。");
  if (assessment.verdict === "partial" && (score <= 0 || score >= maxPoints)) issues.push("部分正确判定与分数不一致。");
  return issues;
}

export function calculateTotals(questions: GradeQuestionResult[]) {
  const scored = questions.filter((q) => q.score !== null && q.maxPoints !== null && !q.needsReview);
  return { awardedPoints: sum(scored.map((q) => q.score!)), gradedMaxPoints: sum(scored.map((q) => q.maxPoints!)),
    totalMaxPoints: questions.every((q) => q.maxPoints !== null) ? sum(questions.map((q) => q.maxPoints!)) : null,
    totalQuestions: questions.length, scoredQuestions: scored.length, pendingQuestions: questions.filter((q) => q.needsReview).length,
    failedQuestions: questions.filter((q) => q.failed).length };
}

export function applyGradeReview(result: GradeResult, input: GradeReviewInput, reviewerId: string, reviewedAt: string): GradeResult {
  const data = gradeReviewSchema.parse(input);
  if (data.score > data.maxPoints) throw new Error("确认分数不能超过满分。");
  const target = result.questions.find((q) => q.questionId === data.questionId);
  if (!target) throw new Error("批改题目不存在。");
  const review = { score: data.score, maxPoints: data.maxPoints, note: data.note, reviewerId, reviewedAt };
  const questions = result.questions.map((q) => q !== target ? q : { ...q, maxPoints: data.maxPoints, score: data.score,
    needsReview: false, review, reviewHistory: [...q.reviewHistory, review] });
  return { ...result, questions, totals: calculateTotals(questions) };
}
