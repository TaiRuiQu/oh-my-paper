import { type GradeQuestionResult } from "@/contracts/grading";
// A review's effective score takes precedence over the original model verdict.
export function isWrong(q: GradeQuestionResult) {
  return !q.failed && !q.needsReview && q.score !== null && q.maxPoints !== null && q.maxPoints > 0 && q.score < q.maxPoints;
}
export function mastery(results: { correct: boolean }[]) {
  return results.length >= 2 && results.slice(-2).every((r) => r.correct);
}
