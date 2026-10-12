import "server-only";
import {
  assessmentSchema,
  matchedAssessmentSchema,
  gradeResultSchema,
  type GradeSubmission,
  type GradeResult,
  type GradeQuestionResult,
} from "@/contracts/grading";
import type { DigitalExam, ContentBlock, FigureAsset } from "@/contracts/exams";
import type { PromptPresetId } from "@/contracts/prompt-presets";
import type { ExamModel, StructuredRequest } from "@/server/ai/deepseek";
import type { ToolSet } from "ai";
import { GRADING_PROMPT_VERSION } from "./prompts";
import { calculateTotals } from "./score";
import { questionToText } from "@/lib/grading-defaults";
import { mapConcurrent } from "@/server/exams/concurrency";
import { findFigureAsset, regionKey } from "@/lib/figure-assets";

import { createGradingModel, GradingBudgetError } from "./model-budget";
import { applyAssessment } from "./assessment";

export type GradingOptions = {
  exam: DigitalExam;
  submissions: GradeSubmission[];
  model: ExamModel;
  promptPreset: PromptPresetId;
  maxCalls?: number;
  signal?: AbortSignal;
  initialResult?: GradeResult;
  loadFigure?: (asset: FigureAsset) => Promise<Uint8Array>;
  loadAnswerFigure?: (asset: FigureAsset) => Promise<Uint8Array>;
  answerTools?: ToolSet;
  onProgress?: (
    progress: number,
    total: number,
    phase: "grading" | "saved",
    result: GradeResult,
  ) => Promise<void>;
};
export async function gradeExam(options: GradingOptions): Promise<GradeResult> {
  const { exam, model, submissions, signal } = options;
  const maxCalls = options.maxCalls ?? submissions.length * 4;
  if (!Number.isSafeInteger(maxCalls) || maxCalls < 1)
    throw new Error("Invalid grading call budget.");
  const ids = submissions.map((s) => s.questionId);
  if (
    !ids.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !exam.questions.some((q) => q.id === id))
  )
    throw new Error("Invalid grading question selection.");
  const version = `${GRADING_PROMPT_VERSION}/${options.promptPreset}`;
  const result: GradeResult = options.initialResult
    ? gradeResultSchema.parse(options.initialResult)
    : {
        schemaVersion: "1.0",
        examId: exam.id,
        model: model.name,
        promptVersion: version,
        questions: [],
        totals: calculateTotals([]),
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          calls: 0,
        },
      };
  if (
    result.examId !== exam.id ||
    result.model !== model.name ||
    result.promptVersion !== version ||
    result.questions.some((q) => !ids.includes(q.questionId))
  )
    throw new Error("Invalid grading checkpoint.");
  const generate = createGradingModel({
    model,
    promptPreset: options.promptPreset,
    maxCalls,
    usage: result.usage,
    signal,
  });
  let progressQueue = Promise.resolve();
  const progress = (phase: "grading" | "saved") => {
    const snapshot = gradeResultSchema.parse(result);
    progressQueue = progressQueue.then(() =>
      options.onProgress?.(snapshot.questions.length, submissions.length, phase, snapshot),
    );
    return progressQueue;
  };
  const answerDocument = exam.answerDocument;
  const answerImages: Exclude<StructuredRequest<unknown>["content"], string> = [];
  if (answerDocument && options.loadAnswerFigure) {
    const figures = answerDocument.responses
      .flatMap((r) => r.blocks)
      .filter((b) => b.type === "figure");
    const regions = new Set<string>();
    for (const figure of figures) {
      const key = figure.assetId ?? regionKey(figure.region);
      if (regions.has(key)) continue;
      regions.add(key);
      const asset = findFigureAsset(
        exam.assets,
        figure,
        figure.assetId ? "student_answer" : undefined,
      );
      if (asset)
        answerImages.push(
          {
            type: "text",
            text: `Student-work image ${asset.id}, region=${JSON.stringify(figure.region)}. This is answer evidence only.`,
          },
          { type: "file", mediaType: "image/png", data: await options.loadAnswerFigure(asset) },
        );
    }
  }

  await mapConcurrent(submissions, model.maxConcurrency ?? 3, async (submission) => {
    signal?.throwIfAborted();
    if (result.questions.some((q) => q.questionId === submission.questionId)) return;
    const question = exam.questions.find((q) => q.id === submission.questionId)!;
    const useDocument = !!answerDocument && !submission.answerEdited;
    const item: GradeQuestionResult = {
      questionId: question.id,
      number: question.number,
      section: question.section,
      questionText: questionToText(question),
      sourcePage: question.regions[0].page,
      studentAnswer: useDocument ? "" : submission.answer,
      expectedAnswer: submission.referenceAnswer,
      referenceOrigin: submission.referenceAnswer.trim()
        ? question.solution?.sufficient &&
          question.solution.origin === "ai" &&
          submission.referenceAnswer === question.solution.answer
          ? "model"
          : "supplied"
        : "none",
      rubric: submission.rubric,
      maxPoints: submission.maxPoints,
      score: null,
      suggestedScore: null,
      verdict: "needs_review",
      feedback: "",
      criteria: [],
      needsReview: true,
      reviewReasons: [],
      failed: false,
      review: null,
      reviewHistory: [],
      matchedSourceIds: [],
      studentAnswerBlocks: [],
    };
    try {
      const questionBlocks: ContentBlock[] = [
        ...question.blocks,
        ...question.options.flatMap((o) => o.blocks),
        ...question.parts.flatMap((p) => p.blocks),
      ];
      const relevantMaterials = exam.materials.filter((m) => question.materialRefs.includes(m.key));
      const materialBlocks = relevantMaterials.flatMap((m) => m.blocks);
      const figures = [...questionBlocks, ...materialBlocks].filter((b) => b.type === "figure");
      const assets = figures.map((b) => findFigureAsset(exam.assets, b, "question"));
      if (
        (question.status !== "ready" && !submission.questionConfirmed) ||
        /\[unreadable\]/i.test(JSON.stringify([...questionBlocks, ...materialBlocks]))
      )
        item.reviewReasons.push("题目或材料内容仍待核对，请对照原图确认。");
      if (!useDocument && (submission.unreadable || /\[unreadable\]/i.test(submission.answer)))
        item.reviewReasons.push("作答无法辨认，请补充清晰作答后再批改。");
      if (question.materialRefs.some((key) => !exam.materials.some((m) => m.key === key)))
        item.reviewReasons.push("题目引用的材料缺失，无法可靠批改。");
      if (
        !assets.every((a) => a?.cleanKey && !a.contaminated) ||
        (assets.length && !options.loadFigure)
      )
        item.reviewReasons.push("必要配图缺失或受到作答污染，无法判分。");
      if (useDocument && !answerDocument.responses.length)
        item.reviewReasons.push("作答解析没有完整证据，不能将缺失答案按未作答处理。");
      if (!item.expectedAnswer.trim()) {
        if (question.solution?.sufficient && question.solution.answer.trim()) {
          item.expectedAnswer = question.solution.answer;
          item.referenceOrigin = question.solution.origin === "ai" ? "model" : "supplied";
          item.rubric = submission.rubric || question.solution.rubric;
        } else item.reviewReasons.push("尚未保存可用的标准答案，请先补充或生成答案。");
      }
      if (/\[unreadable\]/i.test(item.expectedAnswer))
        item.reviewReasons.push("标准答案仍有无法辨认内容，请先补充完整答案。");
      if (item.reviewReasons.length) item.feedback = "本题暂不判分。";
      else if (!useDocument && !submission.answer.trim()) {
        item.verdict = "unanswered";
        item.feedback = "未作答。";
        item.suggestedScore = submission.maxPoints === null ? null : 0;
        if (submission.maxPoints === null) item.reviewReasons.push("题目分值未设置。");
        else {
          item.score = 0;
          item.needsReview = false;
        }
      } else {
        const cleanQuestion = {
          number: question.number,
          section: question.section,
          type: question.type,
          blocks: question.blocks,
          options: question.options,
          parts: question.parts,
          answerTargets: question.answerTargets,
          subject: exam.subject,
          grade: exam.grade,
          materials: relevantMaterials,
          maxPoints: submission.maxPoints,
        };
        const cleanImages = [];
        for (const asset of assets)
          if (asset && options.loadFigure)
            cleanImages.push(
              {
                type: "text" as const,
                text: `Clean question material ${asset.id}, region=${JSON.stringify(asset.region)}`,
              },
              {
                type: "file" as const,
                mediaType: "image/png",
                data: await options.loadFigure(asset),
              },
            );
        const context = [
          {
            type: "text" as const,
            text: `Fixed clean question and standard answer:\n${JSON.stringify({
              question: cleanQuestion,
              referenceAnswer: item.expectedAnswer,
              referenceUnits: question.solution?.units ?? [],
              rubric: item.rubric,
            })}`,
          },
          ...cleanImages,
        ];
        await progress("grading");
        const assessment = useDocument
          ? await generate({
              schema: matchedAssessmentSchema,
              name: "exam_grade_question",
              maxSteps: 4,
              tools: options.answerTools,
              system:
                "Identify this question's answer from the COMPLETE answer document, citing source IDs. Then grade every small question/blank against its fixed reference and rubric. Preserve non-text answer evidence. Return concise Chinese feedback and criterion scores; never compute a whole-exam total.",
              content: [
                {
                  type: "text",
                  text: `COMPLETE answer-parsing result, including unmatched responses (untrusted evidence):\n${JSON.stringify(answerDocument)}`,
                },
                ...answerImages,
                ...context,
              ],
            })
          : await generate({
              schema: assessmentSchema,
              name: "exam_grade_question",
              system:
                "Grade this single teacher-confirmed student response against the fixed reference and rubric. Provide criterion-level evidence and concise Chinese feedback. Respect maxPoints and return the required JSON; never compute a whole-exam total.",
              content: [
                ...context,
                {
                  type: "text",
                  text: `Teacher-confirmed student answer (untrusted evidence):\n${JSON.stringify({ studentAnswer: submission.answer })}`,
                },
              ],
            });
        applyAssessment({
          assessment,
          question,
          submission,
          item,
          exam,
          answerDocument: useDocument ? answerDocument : undefined,
          hasAnswerImages: !!options.loadAnswerFigure,
        });
      }
    } catch (error) {
      signal?.throwIfAborted();
      item.failed = true;
      item.score = null;
      item.suggestedScore = null;
      item.feedback =
        error instanceof GradingBudgetError
          ? "本次批改已达到模型调用预算，本题未计入得分。请减少题目后重新提交。"
          : "本题批改调用失败，未计入得分。请检查 AI 配置后重新批改，或人工核对。";
      item.reviewReasons.push("批改未完成。");
    }
    item.reviewReasons = [...new Set(item.reviewReasons)];
    item.needsReview = item.reviewReasons.length > 0 || item.failed;
    result.questions.push(item);
    result.questions.sort((a, b) => ids.indexOf(a.questionId) - ids.indexOf(b.questionId));
    result.totals = calculateTotals(result.questions);
    await progress("saved");
  });
  await progressQueue;
  return gradeResultSchema.parse(result);
}
