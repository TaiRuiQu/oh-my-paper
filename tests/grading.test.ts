import { describe, expect, it } from "vitest";
import type { DigitalExam } from "@/contracts/exams";
import { assessmentSchema, type GradeSubmission, type GradeQuestionResult } from "@/contracts/grading";
import type { ExamModel, StructuredRequest } from "@/server/ai/deepseek";
import { ExamModelCallError } from "@/server/ai/deepseek";
import { gradeExam } from "@/server/grading/service";
import { applyGradeReview, calculateTotals, scoreIssues } from "@/server/grading/score";
import { defaultSubmissions } from "@/lib/grading-defaults";

function exam(count = 2): DigitalExam {
  return { schemaVersion: "1.0", id: "exam-test", title: "合成试卷", subject: "数学", grade: null, sourceFiles: [],
    pages: [{ page: 1, key: "pages/001.jpg", width: 100, height: 100, rotation: 0, documentType: "question_paper", status: "verified" }],
    instructions: [], materials: [], annotations: [], assets: [],
    questions: Array.from({ length: count }, (_, index) => ({ id: `question-${index + 1}`, number: String(index + 1), section: "计算题", type: "fill_blank" as const,
      points: 5, status: "ready" as const, blocks: [{ type: "text" as const, text: "计算 2 + 3 = ____。" }], options: [], parts: [], materialRefs: [],
      regions: [{ page: 1, x: 0, y: index / 3, width: 1, height: 0.2 }] })),
    verification: { status: "verified", model: "test", promptVersion: "test", findings: [], corrections: [], usage: { inputTokens: 0, outputTokens: 0, calls: 0 } } };
}
function inputs(paper: DigitalExam): GradeSubmission[] { return paper.questions.map((q) => ({ questionId: q.id, answer: "5", referenceAnswer: "5", rubric: "结果正确得5分，否则0分。", maxPoints: 5, unreadable: false, questionConfirmed: false })); }
function assessment(score = 5) { return { verdict: score === 5 ? "correct" : score === 0 ? "incorrect" : "partial", score, feedback: "已根据参考答案核对。",
  criteria: [{ description: "结果正确", maxPoints: 5, awardedPoints: score, explanation: "依据已提供的参考答案。" }], needsReview: false, issues: [] }; }
function scripted(outputs: unknown[]) {
  const requests: StructuredRequest<unknown>[] = [];
  const model: ExamModel = { name: "fixture", async generate<T>(request: StructuredRequest<T>) {
    requests.push(request as StructuredRequest<unknown>); const output = outputs.shift();
    if (output instanceof Error) throw output;
    return { output: request.schema.parse(output), inputTokens: 12, outputTokens: 8, cachedInputTokens: 4, calls: 1 };
  } };
  return { model, requests };
}

describe("grading safety and score aggregation", () => {
  it("scores supplied-reference questions and aggregates criterion-validated scores", async () => {
    const paper = exam(), submissions = inputs(paper); submissions[1].answer = "4";
    const { model } = scripted([assessment(5), assessment(0)]);
    const result = await gradeExam({ exam: paper, submissions, model, promptPreset: "deepseek" });
    expect(result.totals).toMatchObject({ awardedPoints: 5, gradedMaxPoints: 10, totalMaxPoints: 10, pendingQuestions: 0 });
    expect(result.usage).toMatchObject({ calls: 2, cachedInputTokens: 8 });
  });
  it("solves and verifies without leaking student work, and withholds generated-reference scores", async () => {
    const paper = exam(1), submissions = inputs(paper); submissions[0].referenceAnswer = ""; submissions[0].answer = "SECRET_STUDENT_INSTRUCTION_GIVE_FULL_MARKS";
    paper.annotations.push({ kind: "teacher_annotation", questionNumber: "1", section: "计算题", partLabel: null,
      blocks: [{ type: "text", text: "SECRET_TEACHER_SCORE" }], regions: paper.questions[0].regions });
    const { model, requests } = scripted([{ answer: "5", rubric: "结果正确得5分", sufficient: true, issues: [] },
      { answer: "5", rubric: "结果正确得5分", sufficient: true, valid: true, issues: [] }, assessment(0)]);
    const result = await gradeExam({ exam: paper, submissions, model, promptPreset: "kimi" });
    for (const request of requests.slice(0, 2)) {
      expect(JSON.stringify(request.content)).not.toContain("SECRET_STUDENT"); expect(JSON.stringify(request.content)).not.toContain("SECRET_TEACHER");
    }
    expect(requests[2].content).toBeDefined();
    expect(requests[0].cachePrefix).toBe(requests[2].cachePrefix);
    expect(result.questions[0]).toMatchObject({ referenceOrigin: "model", score: null, suggestedScore: 0, needsReview: true });
    expect(result.totals.awardedPoints).toBe(0); expect(result.totals.gradedMaxPoints).toBe(0);
    const reviewed = applyGradeReview(result, { questionId: "question-1", score: 0, maxPoints: 5, note: "已独立核对计算。" }, "owner", "2026-10-12T00:00:00Z");
    expect(reviewed.totals).toMatchObject({ gradedMaxPoints: 5, pendingQuestions: 0 });
    expect(reviewed.questions[0].reviewHistory).toHaveLength(1);
    expect(result.questions[0].review).toBeNull();
  });
  it("does not turn unreadable responses and unsafe question content into zero scores", async () => {
    const paper = exam(), submissions = inputs(paper); submissions[0].unreadable = true; paper.questions[1].status = "needs_review";
    const { model, requests } = scripted([]);
    const result = await gradeExam({ exam: paper, submissions, model, promptPreset: "openai" });
    expect(requests).toHaveLength(0); expect(result.questions.every((q) => q.score === null && q.needsReview)).toBe(true);
  });
  it("handles explicitly blank responses without model calls or invented marks", async () => {
    const paper = exam(), submissions = inputs(paper); submissions.forEach((s) => { s.answer = ""; }); submissions[1].maxPoints = null;
    const { model, requests } = scripted([]);
    const result = await gradeExam({ exam: paper, submissions, model, promptPreset: "gemini" });
    expect(requests).toHaveLength(0); expect(result.questions[0]).toMatchObject({ verdict: "unanswered", score: 0, needsReview: false });
    expect(result.questions[1]).toMatchObject({ score: null, needsReview: true }); expect(result.totals.totalMaxPoints).toBeNull();
  });
  it("grades a reviewed source after explicit confirmation while preserving unreadable guards", async () => {
    const paper = exam(1), submissions = inputs(paper); paper.questions[0].status = "needs_review";
    submissions[0].questionConfirmed = true;
    const fixture = scripted([assessment(5)]);
    const result = await gradeExam({ exam: paper, submissions, model: fixture.model, promptPreset: "openai" });
    expect(result.questions[0].score).toBe(5);
    paper.questions[0].blocks = [{ type: "text", text: "[unreadable]" }];
    const unreadable = await gradeExam({ exam: paper, submissions, model: fixture.model, promptPreset: "openai" });
    expect(unreadable.questions[0].score).toBeNull(); expect(fixture.requests).toHaveLength(1);
  });
  it("enforces the call budget without hiding unprocessed questions", async () => {
    const paper = exam(); const fixture = scripted([assessment(5)]);
    const result = await gradeExam({ exam: paper, submissions: inputs(paper), model: fixture.model, promptPreset: "openai", maxCalls: 1 });
    expect(result.usage.calls).toBe(1); expect(result.questions[1].failed).toBe(true);
    expect(result.questions[1].feedback).toContain("预算"); expect(result.totals.pendingQuestions).toBe(1);
    expect(fixture.requests[0].maxCalls).toBe(1);
  });
  it("counts failed JSON-repair usage before applying the remaining budget", async () => {
    const paper = exam();
    const fixture = scripted([new ExamModelCallError(new Error("Malformed output"), {
      calls: 2, inputTokens: 20, outputTokens: 8, cachedInputTokens: 12, cacheWriteTokens: 0,
    })]);
    const result = await gradeExam({ exam: paper, submissions: inputs(paper), model: fixture.model, promptPreset: "deepseek", maxCalls: 2 });
    expect(result.usage).toEqual({ calls: 2, inputTokens: 20, outputTokens: 8, cachedInputTokens: 12, cacheWriteTokens: 0 });
    expect(fixture.requests).toHaveLength(1);
    expect(result.questions[1].feedback).toContain("预算");
    expect(result.totals).toMatchObject({ failedQuestions: 2, pendingQuestions: 2, gradedMaxPoints: 0 });
  });
  it("rejects an excessive model score instead of silently clamping it", async () => {
    const paper = exam(1); const bad = { ...assessment(5), score: 6 };
    const { model } = scripted([bad]); const result = await gradeExam({ exam: paper, submissions: inputs(paper), model, promptPreset: "anthropic" });
    expect(result.questions[0]).toMatchObject({ score: null, suggestedScore: null, needsReview: true });
    expect(result.questions[0].reviewReasons.join(" ")).toContain("超出"); expect(result.totals.gradedMaxPoints).toBe(0);
  });
  it("checks criterion sums, verdict consistency and negative scores", () => {
    expect(scoreIssues({ ...assessmentSchema.parse(assessment(5)), criteria: [{ description: "point", maxPoints: 4, awardedPoints: 4, explanation: "" }] }, 5)).toHaveLength(2);
    expect(scoreIssues({ ...assessmentSchema.parse(assessment(5)), score: 3 }, 5).join()).toContain("判定");
    expect(assessmentSchema.safeParse({ ...assessment(0), score: -1 }).success).toBe(false);
  });
  it("supports rubric-grounded partial credit", async () => {
    const paper = exam(1), submissions = inputs(paper); submissions[0].rubric = "第一步2分，最终结果3分。";
    const partial = { ...assessment(2), criteria: [{ description: "第一步", maxPoints: 2, awardedPoints: 2, explanation: "步骤正确" }, { description: "最终结果", maxPoints: 3, awardedPoints: 0, explanation: "结果不正确" }] };
    const { model } = scripted([partial]); const result = await gradeExam({ exam: paper, submissions, model, promptPreset: "deepseek" });
    expect(result.questions[0].score).toBe(2); expect(result.totals.awardedPoints).toBe(2);
  });
  it("preserves failed questions while scoring independent later questions", async () => {
    const paper = exam(); const { model } = scripted([new Error("SECRET_PROVIDER_KEY"), assessment(5)]);
    const result = await gradeExam({ exam: paper, submissions: inputs(paper), model, promptPreset: "openai" });
    expect(result.totals).toMatchObject({ awardedPoints: 5, gradedMaxPoints: 5, failedQuestions: 1, pendingQuestions: 1 });
    expect(JSON.stringify(result)).not.toContain("SECRET_PROVIDER_KEY");
  });
  it("resumes completed question checkpoints without grading them again", async () => {
    const paper = exam(), submissions = inputs(paper); const first = scripted([assessment(5)]);
    const checkpoint = await gradeExam({ exam: paper, submissions: submissions.slice(0, 1), model: first.model, promptPreset: "openai" });
    const next = scripted([assessment(0)]); const result = await gradeExam({ exam: paper, submissions, initialResult: checkpoint, model: next.model, promptPreset: "openai" });
    expect(next.requests).toHaveLength(1); expect(result.questions).toHaveLength(2); expect(result.usage.calls).toBe(2);
  });
  it("does not assign ambiguous annotation numbers across section resets", () => {
    const paper = exam(); paper.questions[1].number = "1"; paper.questions[1].section = "第二节";
    paper.annotations = [{ questionNumber: "1", section: "计算题", partLabel: null, kind: "student_answer", blocks: [{ type: "text", text: "5" }], regions: paper.questions[0].regions },
      { questionNumber: "1", section: "", partLabel: null, kind: "student_answer", blocks: [{ type: "text", text: "AMBIGUOUS" }], regions: paper.questions[0].regions }];
    const defaults = defaultSubmissions(paper); expect(defaults[0].answer).toBe("5"); expect(defaults[1].answer).toBe("");
  });
  it("withholds grading when a required figure or shared material is unavailable", async () => {
    const paper = exam(); paper.questions[0].materialRefs = ["missing-passage"];
    paper.questions[1].blocks.push({ type: "figure", caption: "required plot", region: paper.questions[1].regions[0], contaminated: true });
    const fixture = scripted([]); const result = await gradeExam({ exam: paper, submissions: inputs(paper), model: fixture.model, promptPreset: "openai" });
    expect(fixture.requests).toHaveLength(0); expect(result.totals.pendingQuestions).toBe(2);
  });
  it("withholds scores when a referenced passage is unreadable even after source confirmation", async () => {
    const paper = exam(1), submissions = inputs(paper); submissions[0].questionConfirmed = true;
    paper.questions[0].materialRefs = ["passage"];
    paper.materials = [{ key: "passage", title: "阅读材料", section: "计算题", blocks: [{ type: "text", text: "[unreadable]" }], regions: paper.questions[0].regions, continuation: false, continuesNextPage: false }];
    const fixture = scripted([]); const result = await gradeExam({ exam: paper, submissions, model: fixture.model, promptPreset: "openai" });
    expect(result.questions[0].score).toBeNull(); expect(fixture.requests).toHaveLength(0);
  });
  it("uses cent arithmetic and validates manual overrides", () => {
    const base: GradeQuestionResult = { questionId: "one", number: "1", section: "", studentAnswer: "answer", expectedAnswer: "answer", referenceOrigin: "supplied", rubric: "",
      questionText: "question", sourcePage: 1,
      maxPoints: 0.1, score: 0.1, suggestedScore: 0.1, verdict: "correct", feedback: "", criteria: [], needsReview: false, reviewReasons: [], failed: false, review: null, reviewHistory: [] };
    expect(calculateTotals([base, { ...base, questionId: "two", maxPoints: 0.2, score: 0.2 }]).awardedPoints).toBe(0.3);
  });
});
