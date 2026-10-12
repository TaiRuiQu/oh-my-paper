import "server-only";
import type { DigitalExam, SourceRegion } from "@/contracts/exams";
import type { PageImage } from "../documents";
import { containsRegion, validRegion } from "../evidence";
import type {
  RecognitionQuestion,
  RecognitionAnnotation,
  RecognitionMetadata,
  RecognitionFigure,
} from "./types";

export function createRecognitionValidation(pages: Pick<PageImage, "page">[]) {
  const regionErrors = (regions: SourceRegion[]) =>
    regions
      .filter(
        (r) =>
          !validRegion(
            r,
            pages.map((p) => p.page),
          ),
      )
      .map((r) => `Region exceeds page ${r.page}.`);
  const evidenceErrors = (record: { regions: SourceRegion[]; figures: RecognitionFigure[] }) => [
    ...regionErrors([...record.regions, ...record.figures.map((f) => f.region)]),
    ...record.figures
      .filter((f) => !record.regions.some((r) => containsRegion(r, f.region)))
      .map(
        (f) =>
          `Figure ${f.id} lies outside its source regions. Include the complete source evidence, including column/page continuations.`,
      ),
  ];
  const questionErrors = (q: RecognitionQuestion) => [
    ...evidenceErrors(q),
    ...markdownErrors(
      [q.markdown, ...q.options.map((o) => o.markdown), ...q.parts.map((p) => p.markdown)].join(
        "\n",
      ),
      q.figures,
    ),
    ...((q.points === null) !== (q.pointsOrigin === "unknown")
      ? ["Null scores must have unknown provenance."]
      : []),
    ...(q.pointsOrigin === "inferred" && !q.pointsReason.trim()
      ? ["Inferred scores need a reason."]
      : []),
  ];
  function markdownErrors(markdown: string, figures: RecognitionFigure[]) {
    const ids = [...markdown.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1]);
    return [
      ...ids
        .filter((id) => !figures.some((f) => f.id === id))
        .map((id) => `Unknown Markdown figure ${id}.`),
      ...(markdown.includes("\\n\\n") || /\\n(?=[(（#|!])/.test(markdown)
        ? [
            "Markdown contains literal \\n instead of line breaks. Use JSON newline escapes so decoded text has real newlines; preserve LaTeX backslashes.",
          ]
        : []),
      ...(/\\u[0-9a-fA-F]{4}/.test(markdown)
        ? [
            "Markdown contains literal Unicode escapes. Use the decoded characters in text; preserve LaTeX backslashes.",
          ]
        : []),
      ...(new Set(ids).size !== ids.length ||
      new Set(figures.map((f) => f.id)).size !== figures.length
        ? ["Figure identities must be unique."]
        : []),
    ];
  }
  function submissionErrors({
    metadata,
    questions,
    annotations,
    inspected,
    questionCount,
    template,
  }: {
    metadata: RecognitionMetadata | undefined;
    questions: Map<string, RecognitionQuestion>;
    annotations: Map<string, RecognitionAnnotation>;
    inspected: Set<number>;
    questionCount: number;
    template?: DigitalExam;
  }) {
    const errors: string[] = [];
    if (!metadata) errors.push("Document metadata has not been saved.");
    if (pages.some((p) => !inspected.has(p.page)))
      errors.push(
        `Inspect remaining pages: ${pages
          .filter((p) => !inspected.has(p.page))
          .map((p) => p.page)
          .join(", ")}.`,
      );
    const expected = template?.questions.length ?? questions.size;
    if (questionCount !== expected)
      errors.push(`Saved ${expected} questions, submitted count ${questionCount}.`);
    for (const p of metadata?.pages ?? [])
      for (const kind of p.annotationKinds) {
        if (
          ![...annotations.values()].some(
            (a) => a.kind === kind && a.regions.some((r) => r.page === p.page),
          )
        )
          errors.push(
            `Page ${p.page} has ${kind} evidence but none has been saved. Transcribe it separately, including blank/unreadable/unmatched evidence.`,
          );
      }
    errors.push(
      ...[...questions.values()].flatMap(questionErrors),
      ...[...annotations.values(), ...(metadata?.materials ?? [])].flatMap(evidenceErrors),
    );
    if (!template) {
      if (new Set([...questions.values()].map((q) => q.order)).size !== questions.size)
        errors.push("Question order values must be unique across sections.");
      for (const p of metadata?.pages ?? []) {
        const onPage = [...questions.values()].filter((q) =>
          q.regions.some((r) => r.page === p.page),
        );
        if (p.hasQuestionStems && !onPage.length)
          errors.push(`Page ${p.page} has stems but no saved questions.`);
        if (p.documentType === "question_paper" && !p.hasQuestionStems)
          errors.push(`Question-paper page ${p.page} must declare its question stems.`);
        if (["answer_key", "answer_sheet"].includes(p.documentType) && onPage.length)
          errors.push(`Page ${p.page} is an answer-only page but has question stems saved.`);
        if (
          p.documentType === "answer_key" &&
          ![...annotations.values()].some(
            (a) => a.kind === "reference_answer" && a.regions.some((r) => r.page === p.page),
          )
        )
          errors.push(`Answer-key page ${p.page} has no reference entries.`);
      }
      for (const q of questions.values()) {
        if (!q.markdown.trim() && !q.parts.length && !q.materialRefs.length)
          errors.push(`Question ${q.number} is empty.`);
        if (["single_choice", "multiple_choice"].includes(q.type) && q.options.length < 2)
          errors.push(`Question ${q.number} has missing options.`);
        if (new Set(q.options.map((o) => o.label)).size !== q.options.length)
          errors.push(`Question ${q.number} has duplicate options.`);
        if (new Set(q.answerTargets.map((t) => t.key)).size !== q.answerTargets.length)
          errors.push(`Question ${q.number} has duplicate answer targets.`);
        if (q.materialRefs.some((ref) => !metadata?.materials.some((m) => m.key === ref)))
          errors.push(`Question ${q.number} references a missing shared material.`);
      }
      for (const section of metadata?.sections ?? []) {
        const items = [...questions.values()].filter((q) => q.section === section.title);
        if (
          section.points !== null &&
          items.length &&
          items.every((q) => q.points !== null) &&
          Math.abs(items.reduce((sum, q) => sum + q.points!, 0) - section.points) > 0.01
        )
          errors.push(
            `Scores in section ${section.title} do not sum to its printed total ${section.points}.`,
          );
      }
    }

    return errors;
  }
  return { regionErrors, evidenceErrors, questionErrors, markdownErrors, submissionErrors };
}
