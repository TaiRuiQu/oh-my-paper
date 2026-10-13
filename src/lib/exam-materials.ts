import type { Material, ParsedExam } from "@/contracts/exams";

export function materialKey(position: number, index: number, subquestionPosition?: number) {
  return subquestionPosition === undefined
    ? `materials/${position + 1}-${index + 1}.jpg`
    : `materials/${position + 1}-${subquestionPosition + 1}-${index + 1}.jpg`;
}

export function examMaterials(exam: Pick<ParsedExam, "sections">) {
  const result: {
    key: string;
    box: Material;
    questionNumber: number;
    subquestionNumber?: string;
  }[] = [];
  let position = 0;
  for (const section of exam.sections) {
    for (const question of section.questions) {
      question.materials.forEach((box, index) => {
        result.push({ key: materialKey(position, index), box, questionNumber: question.number });
      });
      question.subquestions.forEach((part, partPosition) => {
        part.materials.forEach((box, index) => {
          result.push({
            key: materialKey(position, index, partPosition),
            box,
            questionNumber: question.number,
            subquestionNumber: part.number,
          });
        });
      });
      position++;
    }
  }
  return result;
}
