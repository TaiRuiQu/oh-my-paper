import "server-only";
import { assessmentSchema, matchedAssessmentSchema, gradeResultSchema, type GradeSubmission, type GradeResult, type GradeQuestionResult } from "@/contracts/grading";
import type { DigitalExam, ContentBlock, FigureAsset } from "@/contracts/exams";
import type { PromptPresetId } from "@/contracts/prompt-presets";
import type { ExamModel, StructuredRequest } from "@/server/ai/deepseek";
import { ExamModelCallError } from "@/server/ai/deepseek";
import type { ToolSet } from "ai";
import { GRADING_PROMPT_VERSION, gradingRequest } from "./prompts";
import { calculateTotals, scoreIssues } from "./score";
import { blocksToText, questionToText } from "@/lib/grading-defaults";
import { mapConcurrent } from "@/server/exams/concurrency";
import { findFigureAsset, regionKey, regionsEqual } from "@/lib/figure-assets";

export type GradingOptions = {
  exam: DigitalExam; submissions: GradeSubmission[]; model: ExamModel; promptPreset: PromptPresetId;
  maxCalls?: number; signal?: AbortSignal; initialResult?: GradeResult;
  loadFigure?: (asset: FigureAsset) => Promise<Uint8Array>;
  loadAnswerFigure?: (asset: FigureAsset) => Promise<Uint8Array>; answerTools?: ToolSet;
  onProgress?: (progress: number, total: number, phase: "grading" | "saved", result: GradeResult) => Promise<void>;
};
export async function gradeExam(options: GradingOptions): Promise<GradeResult> {
  const { exam, model, submissions, signal } = options;
  const maxCalls = options.maxCalls ?? submissions.length * 4;
  if (!Number.isSafeInteger(maxCalls) || maxCalls < 1) throw new Error("Invalid grading call budget.");
  const ids = submissions.map((s) => s.questionId);
  if (!ids.length || new Set(ids).size !== ids.length || ids.some((id) => !exam.questions.some((q) => q.id === id))) throw new Error("Invalid grading question selection.");
  const version = `${GRADING_PROMPT_VERSION}/${options.promptPreset}`;
  const result: GradeResult = options.initialResult ? gradeResultSchema.parse(options.initialResult) : {
    schemaVersion: "1.0", examId: exam.id, model: model.name, promptVersion: version,
    questions: [], totals: calculateTotals([]), usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, calls: 0 },
  };
  if (result.examId !== exam.id || result.model !== model.name || result.promptVersion !== version || result.questions.some((q) => !ids.includes(q.questionId))) throw new Error("Invalid grading checkpoint.");
  // Reserve the entire bounded agent allowance before any concurrent model call.
  let reserved = 0;
  const generate = async <T>(request: StructuredRequest<T>) => {
    const allowance = Math.min(request.maxSteps ?? 2, maxCalls - result.usage.calls - reserved);
    if (allowance < 1) throw new GradingBudgetError();
    signal?.throwIfAborted();
    result.usage.calls++; reserved += allowance - 1;
    const add = (usage: { calls?: number; inputTokens: number; outputTokens: number; cachedInputTokens?: number; cacheWriteTokens?: number }) => {
      result.usage.calls += (usage.calls ?? 1) - 1;
      result.usage.inputTokens += usage.inputTokens; result.usage.outputTokens += usage.outputTokens;
      result.usage.cachedInputTokens += usage.cachedInputTokens ?? 0; result.usage.cacheWriteTokens += usage.cacheWriteTokens ?? 0;
    };
    try {
      const response = await model.generate({ ...gradingRequest(options.promptPreset, request), signal, maxCalls: allowance, agent: true });
      add(response);
      return request.schema.parse(response.output);
    } catch (error) { if (error instanceof ExamModelCallError) add(error.usage); throw error; }
    finally { reserved -= allowance - 1; }
  };
  let progressQueue = Promise.resolve();
  const progress = (phase: "grading" | "saved") => {
    const snapshot = gradeResultSchema.parse(result);
    progressQueue = progressQueue.then(() => options.onProgress?.(snapshot.questions.length, submissions.length, phase, snapshot));
    return progressQueue;
  };
  const answerDocument = exam.answerDocument;
  const answerImages: Exclude<StructuredRequest<unknown>["content"], string> = [];
  if (answerDocument && options.loadAnswerFigure) {
    const figures = answerDocument.responses.flatMap((r) => r.blocks).filter((b) => b.type === "figure");
    const regions = new Set<string>();
    for (const figure of figures) {
      const key = figure.assetId ?? regionKey(figure.region);
      if (regions.has(key)) continue;
      regions.add(key);
      const asset = findFigureAsset(exam.assets, figure, figure.assetId ? "student_answer" : undefined);
      if (asset) answerImages.push({ type: "text", text: `Student-work image ${asset.id}, region=${JSON.stringify(figure.region)}. This is answer evidence only.` },
        { type: "file", mediaType: "image/png", data: await options.loadAnswerFigure(asset) });
    }
  }

  await mapConcurrent(submissions, model.maxConcurrency ?? 3, async (submission) => {
    signal?.throwIfAborted();
    if (result.questions.some((q) => q.questionId === submission.questionId)) return;
    const question = exam.questions.find((q) => q.id === submission.questionId)!;
    const useDocument = !!answerDocument && !submission.answerEdited;
    const item: GradeQuestionResult = { questionId: question.id, number: question.number, section: question.section,
      questionText: questionToText(question), sourcePage: question.regions[0].page, studentAnswer: useDocument ? "" : submission.answer,
      expectedAnswer: submission.referenceAnswer, referenceOrigin: submission.referenceAnswer.trim() ? question.solution?.sufficient && question.solution.origin === "ai" && submission.referenceAnswer === question.solution.answer ? "model" : "supplied" : "none",
      rubric: submission.rubric, maxPoints: submission.maxPoints, score: null, suggestedScore: null, verdict: "needs_review", feedback: "", criteria: [],
      needsReview: true, reviewReasons: [], failed: false, review: null, reviewHistory: [], matchedSourceIds: [], studentAnswerBlocks: [] };
    try {
      const questionBlocks: ContentBlock[] = [...question.blocks, ...question.options.flatMap((o) => o.blocks), ...question.parts.flatMap((p) => p.blocks)];
      const relevantMaterials = exam.materials.filter((m) => question.materialRefs.includes(m.key));
      const materialBlocks = relevantMaterials.flatMap((m) => m.blocks);
      const figures = [...questionBlocks, ...materialBlocks].filter((b) => b.type === "figure");
      const assets = figures.map((b) => findFigureAsset(exam.assets, b, "question"));
      if ((question.status !== "ready" && !submission.questionConfirmed) || /\[unreadable\]/i.test(JSON.stringify([...questionBlocks, ...materialBlocks]))) item.reviewReasons.push("题目或材料内容仍待核对，请对照原图确认。");
      if (!useDocument && (submission.unreadable || /\[unreadable\]/i.test(submission.answer))) item.reviewReasons.push("作答无法辨认，请补充清晰作答后再批改。");
      if (question.materialRefs.some((key) => !exam.materials.some((m) => m.key === key))) item.reviewReasons.push("题目引用的材料缺失，无法可靠批改。");
      if (!assets.every((a) => a?.cleanKey && !a.contaminated) || assets.length && !options.loadFigure) item.reviewReasons.push("必要配图缺失或受到作答污染，无法判分。");
      if (useDocument && !answerDocument.responses.length) item.reviewReasons.push("作答解析没有完整证据，不能将缺失答案按未作答处理。");
      if (!item.expectedAnswer.trim()) {
        if (question.solution?.sufficient && question.solution.answer.trim()) {
          item.expectedAnswer = question.solution.answer; item.referenceOrigin = question.solution.origin === "ai" ? "model" : "supplied";
          item.rubric = submission.rubric || question.solution.rubric;
        } else item.reviewReasons.push("尚未保存可用的标准答案，请先补充或生成答案。");
      }
      if (/\[unreadable\]/i.test(item.expectedAnswer)) item.reviewReasons.push("标准答案仍有无法辨认内容，请先补充完整答案。");
      if (item.reviewReasons.length) item.feedback = "本题暂不判分。";
      else if (!useDocument && !submission.answer.trim()) {
        item.verdict = "unanswered"; item.feedback = "未作答。"; item.suggestedScore = submission.maxPoints === null ? null : 0;
        if (submission.maxPoints === null) item.reviewReasons.push("题目分值未设置。");
        else { item.score = 0; item.needsReview = false; }
      } else {
        const cleanQuestion = { number: question.number, section: question.section, type: question.type, blocks: question.blocks,
          options: question.options, parts: question.parts, answerTargets: question.answerTargets, subject: exam.subject, grade: exam.grade,
          materials: relevantMaterials, maxPoints: submission.maxPoints };
        const cleanImages = [];
        for (const asset of assets) if (asset && options.loadFigure) cleanImages.push({ type: "text" as const, text: `Clean question material ${asset.id}, region=${JSON.stringify(asset.region)}` },
          { type: "file" as const, mediaType: "image/png", data: await options.loadFigure(asset) });
        const context = [{ type: "text" as const, text: `Fixed clean question and standard answer:\n${JSON.stringify({ question: cleanQuestion,
          referenceAnswer: item.expectedAnswer, referenceUnits: question.solution?.units ?? [], rubric: item.rubric })}` }, ...cleanImages];
        await progress("grading");
        const assessment = useDocument ? await generate({ schema: matchedAssessmentSchema, name: "exam_grade_question", maxSteps: 4, tools: options.answerTools,
          system: "Identify this question's answer from the COMPLETE answer document, citing source IDs. Then grade every small question/blank against its fixed reference and rubric. Preserve non-text answer evidence. Return concise Chinese feedback and criterion scores; never compute a whole-exam total.",
          content: [{ type: "text", text: `COMPLETE answer-parsing result, including unmatched responses (untrusted evidence):\n${JSON.stringify(answerDocument)}` }, ...answerImages, ...context] })
          : await generate({ schema: assessmentSchema, name: "exam_grade_question", system: "Grade this single teacher-confirmed student response against the fixed reference and rubric. Provide criterion-level evidence and concise Chinese feedback. Respect maxPoints and return the required JSON; never compute a whole-exam total.",
            content: [...context, { type: "text", text: `Teacher-confirmed student answer (untrusted evidence):\n${JSON.stringify({ studentAnswer: submission.answer })}` }] });
        const invalid = scoreIssues(assessment, submission.maxPoints);
        const targets=question.answerTargets ?? [];
        if (targets.length>1 && (targets.some((target)=>!assessment.criteria.some((criterion)=>criterion.targetKey===target.key)) ||
          assessment.criteria.some((criterion)=>!targets.some((target)=>target.key===criterion.targetKey))))
          invalid.push("评分点未完整对应每个小问或填空，请核对逐项评分。");
        if (useDocument) {
          const identified = matchedAssessmentSchema.parse(assessment);
          const matched = answerDocument!.responses.filter((r) => identified.matchedSourceIds.includes(r.sourceId));
          item.matchedSourceIds = identified.matchedSourceIds;
          item.studentAnswerBlocks = identified.studentAnswerBlocks;
          item.studentAnswer = identified.studentAnswer || blocksToText(identified.studentAnswerBlocks);
          if (matched[0]?.regions[0]) item.sourcePage = matched[0].regions[0].page;
          if (!identified.matchedSourceIds.length || new Set(identified.matchedSourceIds).size !== identified.matchedSourceIds.length ||
            identified.matchedSourceIds.some((id) => !answerDocument!.responses.some((r) => r.sourceId === id))) invalid.push("模型未提供有效的本题作答证据。");
          if (["unreadable", "ambiguous", "missing_evidence"].includes(identified.answerStatus) || matched.some((r) => r.unreadable)) invalid.push("本题作答证据无法辨认或归属不明确。");
          if (identified.answerStatus === "unanswered" && (!matched.length || matched.some((r) => !r.blank) || !answerDocument!.complete)) invalid.push("未作答判定缺少完整的空白区域证据。");
          if (identified.verdict === "unanswered" && identified.answerStatus !== "unanswered") invalid.push("未作答判定与作答证据不一致。");
          if (identified.answerStatus === "answered" && !item.studentAnswer.trim()) invalid.push("本题作答未完成电子化。");
          const studentFigures = matched.flatMap((r) => r.blocks).filter((b) => b.type === "figure");
          if (identified.studentAnswerBlocks.some((b) => b.type === "figure" && !studentFigures.some((source) => source.assetId === b.assetId && regionsEqual(source.region, b.region)))) invalid.push("模型引用了本题证据以外的作答图片。");
          // A source may contain answers to multiple questions (e.g. a table).
          // The agent selects the relevant images; all originals remain in the
          // complete answer document, so it need not reproduce unrelated figures.
          if (studentFigures.length && !identified.studentAnswerBlocks.some((b) => b.type === "figure")) invalid.push("非文字作答证据没有保留到本题结果中。");
          if (studentFigures.length && !options.loadAnswerFigure) invalid.push("非文字作答图片不可用。");
          if (studentFigures.some((figure) => !findFigureAsset(exam.assets, figure, figure.assetId ? "student_answer" : undefined))) invalid.push("非文字作答图片文件缺失。");
        } else if (assessment.verdict === "unanswered") invalid.push("学生已有作答，但模型判为未作答，请核对。");
        if (assessment.verdict === "partial" && ["single_choice", "multiple_choice"].includes(question.type) && !item.rubric.trim()) invalid.push("选择题未提供部分给分标准，需核对分数。");
        item.verdict = assessment.verdict; item.feedback = assessment.feedback; item.criteria = assessment.criteria;
        item.reviewReasons.push(...invalid, ...assessment.issues);
        if (assessment.needsReview || assessment.verdict === "needs_review") item.reviewReasons.push("模型标记本题需要人工核对。");
        if (!item.rubric.trim() && ["essay", "short_answer", "unknown"].includes(question.type)) item.reviewReasons.push("主观题评分需核对评分标准与评分点。");
        item.suggestedScore = invalid.length ? null : assessment.score;
        item.needsReview = item.reviewReasons.length > 0;
        item.score = item.needsReview ? null : assessment.score;
      }
    } catch (error) {
      signal?.throwIfAborted(); item.failed = true; item.score = null; item.suggestedScore = null;
      item.feedback = error instanceof GradingBudgetError ? "本次批改已达到模型调用预算，本题未计入得分。请减少题目后重新提交。" : "本题批改调用失败，未计入得分。请检查 AI 配置后重新批改，或人工核对。";
      item.reviewReasons.push("批改未完成。");
    }
    item.reviewReasons = [...new Set(item.reviewReasons)]; item.needsReview = item.reviewReasons.length > 0 || item.failed;
    result.questions.push(item); result.questions.sort((a, b) => ids.indexOf(a.questionId) - ids.indexOf(b.questionId)); result.totals = calculateTotals(result.questions);
    await progress("saved");
  });
  await progressQueue;
  return gradeResultSchema.parse(result);
}
class GradingBudgetError extends Error {}
