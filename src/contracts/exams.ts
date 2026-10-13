import { z } from "zod";

export const scoreSchema = z.number().nonnegative().nullable();
// Coordinates are fractions of the rendered page, measured from its top-left.
export const materialSchema = z
  .strictObject({
    page: z.number().int().positive(),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  })
  .refine((box) => box.x + box.width <= 1 && box.y + box.height <= 1, {
    message: "Material bounding box must fit within its page.",
  });
export const subquestionSchema = z.strictObject({
  number: z
    .string()
    .regex(/^\([1-9]\d*\)$/)
    .describe("Subquestion label, such as (1) or (2)."),
  description: z
    .string()
    .trim()
    .min(1)
    .describe("Subquestion text without its label; preserve deeper (i), (ii) labels."),
  materials: z.array(materialSchema),
  score: scoreSchema,
});
export const questionSchema = z
  .strictObject({
    number: z
      .number()
      .int()
      .positive()
      .describe("Original Arabic question number; do not restart numbering by section."),
    description: z
      .string()
      .trim()
      .describe(
        "Common stem and choices, without repeating section instructions or subquestion text.",
      ),
    materials: z.array(materialSchema),
    score: scoreSchema,
    subquestions: z.array(subquestionSchema).describe("Ordered subquestions; use [] when none."),
  })
  .refine((question) => question.description.length > 0 || question.subquestions.length > 0, {
    message: "A question must contain a stem or subquestions.",
  })
  .refine(
    (question) =>
      new Set(question.subquestions.map((part) => part.number)).size ===
      question.subquestions.length,
    { message: "Duplicate subquestion numbers.", path: ["subquestions"] },
  );
export const sectionSchema = z
  .strictObject({
    number: z
      .string()
      .regex(/^[一二三四五六七八九十百千]+$/)
      .describe("Chinese numeral section number without punctuation."),
    title: z.string().trim().min(1).describe("Original section title or question type."),
    description: z
      .string()
      .trim()
      .describe(
        "Shared section instructions, question counts and scoring rules; empty string if absent.",
      ),
    score: scoreSchema,
    questions: z.array(questionSchema).min(1),
  })
  .refine(
    (section) =>
      new Set(section.questions.map((question) => question.number)).size ===
      section.questions.length,
    { message: "Duplicate question numbers within a section.", path: ["questions"] },
  );
export const parsedExamSchema = z
  .strictObject({
    name: z.string().trim().min(1),
    totalScore: scoreSchema,
    sections: z.array(sectionSchema).min(1),
  })
  .refine(
    (exam) => new Set(exam.sections.map((section) => section.number)).size === exam.sections.length,
    { message: "Duplicate section numbers.", path: ["sections"] },
  );
export type Material = z.infer<typeof materialSchema>;
export type ParsedExam = z.infer<typeof parsedExamSchema>;
export type Subquestion = z.infer<typeof subquestionSchema>;
export type Question = z.infer<typeof questionSchema> & { id: string };
export type Section = Omit<z.infer<typeof sectionSchema>, "questions"> & {
  id: string;
  questions: Question[];
};
export type Exam = Omit<ParsedExam, "sections"> & { id: string; sections: Section[] };

export function examQuestionCount(exam: Pick<ParsedExam, "sections">) {
  return exam.sections.reduce((count, section) => count + section.questions.length, 0);
}

export const examAnswerSchema = z.strictObject({
  examId: z.uuid(),
  questions: z
    .array(
      z.strictObject({
        questionId: z.uuid(),
        solution: z.string(),
        gradingCriteria: z.string(),
      }),
    )
    .refine(
      (items) => new Set(items.map((item) => item.questionId)).size === items.length,
      "Duplicate question answers.",
    ),
});
export const submissionSchema = z.strictObject({
  id: z.uuid(),
  examId: z.uuid(),
  studentId: z.string().nullable(),
  answers: z
    .array(
      z.strictObject({
        questionId: z.uuid(),
        answer: z.string(),
        correct: z.boolean().nullable(),
        score: scoreSchema,
      }),
    )
    .refine(
      (items) => new Set(items.map((item) => item.questionId)).size === items.length,
      "Duplicate submitted answers.",
    ),
});
export type ExamAnswer = z.infer<typeof examAnswerSchema>;
export type Submission = z.infer<typeof submissionSchema>;
