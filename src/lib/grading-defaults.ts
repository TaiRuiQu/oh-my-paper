import type { DigitalExam, ContentBlock, ExamQuestion } from "@/contracts/exams";
// Pure helpers shared by the browser form and server-side grading tests.
import type { GradeSubmission } from "@/contracts/grading";

export function blocksToText(blocks: ContentBlock[]) {
  return blocks.map((block) => block.type === "text" ? block.text : block.type === "math" ? `$${block.latex}$`
    : block.type === "table" ? block.rows.map((row) => row.join(" | ")).join("\n") : `[图：${block.caption}]`).join("\n");
}

export function questionToText(question: ExamQuestion) {
  return [blocksToText(question.blocks), ...question.options.map((option) => `${option.label}. ${blocksToText(option.blocks)}`),
    ...question.parts.map((part) => `${part.parentLabel ?? ""}${part.label} ${blocksToText(part.blocks)}`)].filter(Boolean).join("\n");
}

export function defaultSubmissions(exam: DigitalExam): GradeSubmission[] {
  return exam.questions.map((question) => {
    const annotations = exam.annotations.filter((annotation) => annotation.questionNumber === question.number &&
      (annotation.section === question.section || (!annotation.section && exam.questions.filter((q) => q.number === question.number).length === 1)));
    const content = (kind: "student_answer" | "reference_answer" | "rubric") => annotations.filter((a) => a.kind === kind)
      .map((a) => `${a.partLabel ? `${a.partLabel} ` : ""}${blocksToText(a.blocks)}`).join("\n");
    const answer = content("student_answer");
    return { questionId: question.id, answer, referenceAnswer: content("reference_answer"), rubric: content("rubric"),
      maxPoints: question.points, unreadable: /\[unreadable\]/i.test(answer), questionConfirmed: false };
  });
}
