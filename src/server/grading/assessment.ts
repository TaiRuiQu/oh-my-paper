import "server-only";
import type { z } from "zod";
import {
  assessmentSchema,
  matchedAssessmentSchema,
  type GradeSubmission,
  type GradeQuestionResult,
} from "@/contracts/grading";
import type { DigitalExam } from "@/contracts/exams";
import { blocksToText } from "@/lib/grading-defaults";
import { findFigureAsset, regionsEqual } from "@/lib/figure-assets";
import { scoreIssues } from "./score";

// Validate a model assessment against question targets and saved answer evidence before accepting a score.
export function applyAssessment({
  assessment,
  question,
  submission,
  item,
  exam,
  answerDocument,
  hasAnswerImages,
}: {
  assessment: z.infer<typeof assessmentSchema>;
  question: DigitalExam["questions"][number];
  submission: GradeSubmission;
  item: GradeQuestionResult;
  exam: DigitalExam;
  answerDocument: DigitalExam["answerDocument"];
  hasAnswerImages: boolean;
}) {
  const invalid = scoreIssues(assessment, submission.maxPoints);
  const targets = question.answerTargets ?? [];
  if (
    targets.length > 1 &&
    (targets.some(
      (target) => !assessment.criteria.some((criterion) => criterion.targetKey === target.key),
    ) ||
      assessment.criteria.some(
        (criterion) => !targets.some((target) => target.key === criterion.targetKey),
      ))
  )
    invalid.push("评分点未完整对应每个小问或填空，请核对逐项评分。");
  if (answerDocument) {
    const identified = matchedAssessmentSchema.parse(assessment);
    const matched = answerDocument!.responses.filter((r) =>
      identified.matchedSourceIds.includes(r.sourceId),
    );
    item.matchedSourceIds = identified.matchedSourceIds;
    item.studentAnswerBlocks = identified.studentAnswerBlocks;
    item.studentAnswer = identified.studentAnswer || blocksToText(identified.studentAnswerBlocks);
    if (matched[0]?.regions[0]) item.sourcePage = matched[0].regions[0].page;
    if (
      !identified.matchedSourceIds.length ||
      new Set(identified.matchedSourceIds).size !== identified.matchedSourceIds.length ||
      identified.matchedSourceIds.some(
        (id) => !answerDocument!.responses.some((r) => r.sourceId === id),
      )
    )
      invalid.push("模型未提供有效的本题作答证据。");
    if (
      ["unreadable", "ambiguous", "missing_evidence"].includes(identified.answerStatus) ||
      matched.some((r) => r.unreadable)
    )
      invalid.push("本题作答证据无法辨认或归属不明确。");
    if (
      identified.answerStatus === "unanswered" &&
      (!matched.length || matched.some((r) => !r.blank) || !answerDocument!.complete)
    )
      invalid.push("未作答判定缺少完整的空白区域证据。");
    if (identified.verdict === "unanswered" && identified.answerStatus !== "unanswered")
      invalid.push("未作答判定与作答证据不一致。");
    if (identified.answerStatus === "answered" && !item.studentAnswer.trim())
      invalid.push("本题作答未完成电子化。");
    const studentFigures = matched.flatMap((r) => r.blocks).filter((b) => b.type === "figure");
    if (
      identified.studentAnswerBlocks.some(
        (b) =>
          b.type === "figure" &&
          !studentFigures.some(
            (source) => source.assetId === b.assetId && regionsEqual(source.region, b.region),
          ),
      )
    )
      invalid.push("模型引用了本题证据以外的作答图片。");
    // A source may contain answers to multiple questions (e.g. a table).
    // The agent selects the relevant images; all originals remain in the
    // complete answer document, so it need not reproduce unrelated figures.
    if (studentFigures.length && !identified.studentAnswerBlocks.some((b) => b.type === "figure"))
      invalid.push("非文字作答证据没有保留到本题结果中。");
    if (studentFigures.length && !hasAnswerImages) invalid.push("非文字作答图片不可用。");
    if (
      studentFigures.some(
        (figure) =>
          !findFigureAsset(exam.assets, figure, figure.assetId ? "student_answer" : undefined),
      )
    )
      invalid.push("非文字作答图片文件缺失。");
  } else if (assessment.verdict === "unanswered")
    invalid.push("学生已有作答，但模型判为未作答，请核对。");
  if (
    assessment.verdict === "partial" &&
    ["single_choice", "multiple_choice"].includes(question.type) &&
    !item.rubric.trim()
  )
    invalid.push("选择题未提供部分给分标准，需核对分数。");
  item.verdict = assessment.verdict;
  item.feedback = assessment.feedback;
  item.criteria = assessment.criteria;
  item.reviewReasons.push(...invalid, ...assessment.issues);
  if (assessment.needsReview || assessment.verdict === "needs_review")
    item.reviewReasons.push("模型标记本题需要人工核对。");
  if (!item.rubric.trim() && ["essay", "short_answer", "unknown"].includes(question.type))
    item.reviewReasons.push("主观题评分需核对评分标准与评分点。");
  item.suggestedScore = invalid.length ? null : assessment.score;
  item.needsReview = item.reviewReasons.length > 0;
  item.score = item.needsReview ? null : assessment.score;
}
