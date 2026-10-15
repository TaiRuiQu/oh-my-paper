import type {
  DocumentLayout,
  DocumentFont,
  QuestionReviewRule,
  AssessmentPaper,
} from "@/contracts/platform";
export const DOCUMENT_DEFAULTS = {
  paperSize: "A4",
  orientation: "portrait",
  columns: 2,
  marginMm: 12,
  fontSizePt: 11,
  lineHeight: 1.35,
  fontFamily: "NSimSun",
} as const satisfies DocumentLayout;
export const DOCUMENT_COLUMN_GAP_MM = 6;
export const DOCUMENT_FOOTER_MM = 8;
export const DOCUMENT_PX_PER_MM = 96 / 25.4;

/** Separate answer rules are opt-in; blanks already printed in the stem remain intact. */
export function documentAnswerLines(layout: DocumentLayout, questionId: string) {
  return layout.questionLayouts?.[questionId]?.answerLines ?? 0;
}
export function pageDimensions(
  size: "A4" | "A3" = "A4",
  orientation: "portrait" | "landscape" = "portrait",
) {
  const [short, long] = size === "A3" ? [1123, 1587] : [794, 1123];
  return orientation === "landscape"
    ? { width: long, height: short }
    : { width: short, height: long };
}
export function documentFont(font: DocumentFont = "NSimSun") {
  return `${JSON.stringify(font)}, "新宋体", "SimSun", "Noto Serif SC", "Noto Serif CJK SC", "Noto Sans SC Variable", serif`;
}
export function reviewRule(
  config: Pick<AssessmentPaper, "gradingMode" | "arbitrationThreshold" | "questionRules">,
  itemId: string,
): QuestionReviewRule {
  return (
    config.questionRules?.[itemId] ?? {
      doubleReview: config.gradingMode === "DOUBLE",
      arbitrationEnabled: config.gradingMode === "DOUBLE",
      maxDifference: config.arbitrationThreshold,
    }
  );
}
export function orderedDocumentBlocks<T extends { key: string }>(
  questions: T[],
  layout: DocumentLayout,
  text: (block: NonNullable<DocumentLayout["textBlocks"]>[number]) => T,
): T[] {
  const blocks = layout.textBlocks ?? [];
  const keys = new Set(questions.map((q) => q.key));
  return [
    ...questions.flatMap((q) => [
      ...blocks.filter((b) => b.beforeQuestionId === q.key).map(text),
      q,
    ]),
    ...blocks.filter((b) => !b.beforeQuestionId || !keys.has(b.beforeQuestionId)).map(text),
  ];
}

export function scoresNearlyEqual(a: number, b: number) {
  return Math.abs(a - b) <= Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b)) * 8;
}
export function exceedsReviewDifference(first: number, second: number, threshold: number) {
  const difference = Math.abs(first - second);
  return difference > threshold && !scoresNearlyEqual(difference, threshold);
}
