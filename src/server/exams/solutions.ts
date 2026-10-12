import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DigitalExam, ExamQuestion, QuestionSolution } from "@/contracts/exams";
import { questionSolutionSchema } from "@/contracts/exams";
import { blocksToText } from "@/lib/grading-defaults";
import { allQuestionBlocks } from "./assemble";
import { mapConcurrent } from "./concurrency";
import { SOLVE_SYSTEM } from "./prompts";
import type { Generate } from "./runtime";
import { findFigureAsset } from "@/lib/figure-assets";

export function solutionIssues(
  question: ExamQuestion,
  solution: QuestionSolution,
  requireExplanation = solution.origin === "ai",
) {
  const issues: string[] = [];
  if (solution.sufficient && !solution.answer.trim()) issues.push("标准答案为空。");
  const units = solution.units ?? [];
  const targets = question.answerTargets ?? [];
  if (
    targets.length &&
    (new Set(units.map((u) => u.targetKey)).size !== units.length ||
      units.length !== targets.length ||
      targets.some(
        (t) =>
          !units.some(
            (u) =>
              u.targetKey === t.key &&
              u.answer.trim() &&
              (!requireExplanation || u.explanation.trim()),
          ),
      ))
  )
    issues.push("标准答案未完整覆盖每个小问或填空。");
  const labels = question.options.map((o) => o.label);
  if (
    solution.selectedOptions.some((label) => !labels.includes(label)) ||
    units.some((unit) =>
      unit.selectedOptions.some((label) =>
        ["single_choice", "multiple_choice"].includes(question.type)
          ? !labels.includes(label)
          : !/^[A-H]$/.test(label),
      ),
    )
  )
    issues.push("标准答案包含不存在的选项。");
  if (
    ["single_choice", "multiple_choice"].includes(question.type) &&
    !solution.selectedOptions.length
  )
    issues.push("客观题缺少正确选项。");
  if (question.type === "single_choice" && solution.selectedOptions.length !== 1)
    issues.push("单选题必须恰好有一个正确选项。");
  if (
    [solution.selectedOptions, ...units.map((u) => u.selectedOptions)].some(
      (labels) => new Set(labels).size !== labels.length,
    )
  )
    issues.push("标准答案的选项重复。");
  if (
    ["single_choice", "multiple_choice"].includes(question.type) &&
    targets.length === 1 &&
    units.length === 1 &&
    [...solution.selectedOptions].sort().join("|") !==
      [...units[0].selectedOptions].sort().join("|")
  )
    issues.push("客观题整体答案与小问选项不一致。");
  if (solution.sufficient && requireExplanation && !solution.explanation.trim())
    issues.push("缺少解题过程解析。");
  return issues;
}

export async function solveExamQuestions(options: {
  exam: DigitalExam;
  outputDir: string;
  generate: Generate;
  modelName: string;
  concurrency: number;
  generateAnswers: boolean;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => Promise<void> | void;
}) {
  const { exam, outputDir } = options;
  // Re-generating solutions must not leave stale failure notices on a saved question.
  exam.verification.findings = exam.verification.findings.filter(
    (f) => f.code !== "solution_unavailable",
  );
  let done = 0;
  await mapConcurrent(exam.questions, options.concurrency, async (question) => {
    options.signal?.throwIfAborted();
    if (question.solution?.sufficient && !solutionIssues(question, question.solution).length)
      return;
    const exact = exam.annotations.filter(
      (a) =>
        ["reference_answer", "rubric"].includes(a.kind) &&
        a.questionNumber === question.number &&
        a.section === question.section,
    );
    const refs = exact.length
      ? exact
      : exam.questions.filter((q) => q.number === question.number).length === 1
        ? exam.annotations.filter(
            (a) =>
              a.questionNumber === question.number &&
              ["reference_answer", "rubric"].includes(a.kind),
          )
        : [];
    const reference = refs.filter((a) => a.kind === "reference_answer");
    if (!options.generateAnswers && !reference.length) return;
    try {
      if (
        question.status !== "ready" ||
        /\[unreadable\]/i.test(JSON.stringify(allQuestionBlocks(question)))
      )
        throw new Error("Question evidence incomplete.");
      const materials = exam.materials.filter((m) => question.materialRefs.includes(m.key));
      const figures = [
        ...allQuestionBlocks(question),
        ...materials.flatMap((m) => m.blocks),
      ].filter((b) => b.type === "figure");
      const content = [
        {
          type: "text" as const,
          text: JSON.stringify({
            subject: exam.subject,
            grade: exam.grade,
            question: {
              number: question.number,
              section: question.section,
              type: question.type,
              blocks: question.blocks,
              options: question.options,
              parts: question.parts,
              points: question.points,
              answerTargets: question.answerTargets,
            },
            materials,
            authorizedReference: refs.map((a) => ({
              kind: a.kind,
              partLabel: a.partLabel,
              text: blocksToText(a.blocks),
            })),
          }),
        },
      ];
      const images = [];
      for (const figure of figures) {
        const asset = findFigureAsset(exam.assets, figure, "question");
        if (!asset?.cleanKey || asset.contaminated)
          throw new Error("Clean material image unavailable.");
        images.push(
          {
            type: "text" as const,
            text: `Material image ${asset.id}: ${figure.caption}, region=${JSON.stringify(figure.region)}`,
          },
          {
            type: "file" as const,
            mediaType: "image/png",
            data: await readFile(join(outputDir, asset.cleanKey)),
          },
        );
      }
      const output = await options.generate("solution", {
        schema: questionSolutionSchema,
        name: "exam_solution",
        system:
          SOLVE_SYSTEM +
          (!options.generateAnswers
            ? "\nReference-import mode: do not solve missing answers. Format the supplied references only. If a target answer is absent, sufficient=false. If all answers are supplied, sufficient may be true with empty explanation fields when the source contains no explanation; never invent an explanation."
            : ""),
        content: [...content, ...images],
      });
      const solution: QuestionSolution = {
        ...output,
        model: options.modelName,
        origin: reference.length ? "teacher" : "ai",
      };
      const issues = solutionIssues(question, solution, options.generateAnswers);
      if (issues.length) {
        solution.sufficient = false;
        solution.issues.push(...issues);
      }
      question.solution = solution;
    } catch {
      options.signal?.throwIfAborted();
      question.solution = {
        answer: "",
        selectedOptions: [],
        explanation: "",
        rubric: "",
        units: [],
        sufficient: false,
        issues: ["本题未完成标准答案整理，请核对题目或补充标准答案。"],
        model: options.modelName,
        origin: "ai",
      };
    }
    if (!question.solution.sufficient)
      exam.verification.findings.push({
        page: question.regions[0].page,
        severity: "warning",
        code: "solution_unavailable",
        message: question.solution.issues.join(" "),
        questionNumber: question.number,
      });
    done++;
    await options.onProgress?.(done, exam.questions.length);
  });
}
