// Minimal structural annotations from visual inspection of the user's six real files.
// These are development samples, not a held-out accuracy benchmark.
export const examSamples = [
  { id: "math", file: "数学_仅试题.pdf", pages: 2,
    numbers: Array.from({ length: 19 }, (_, i) => String(i + 1)), minFigures: 2, annotationKinds: [] },
  { id: "chemistry", file: "化学_试题_学生作答.pdf", pages: 4,
    numbers: Array.from({ length: 20 }, (_, i) => String(i + 1)), minFigures: 10, annotationKinds: ["student_answer"] },
  { id: "physics", file: "物理_试题_学生作答_答题卡_答案.pdf", pages: 11,
    numbers: Array.from({ length: 15 }, (_, i) => String(i + 1)), minFigures: 10,
    annotationKinds: ["student_answer", "reference_answer"], answerOnlyPages: [5, 6, 7, 8, 9, 10, 11] },
  { id: "biology", file: "生物_试题_学生作答_照片.jpg", pages: 1,
    numbers: ["1", "2", "3", "4"], minFigures: 6, annotationKinds: ["student_answer"], rotation: 270 },
  { id: "teacher", file: "数学_教师教案.pdf", pages: 10,
    // Section II intentionally has no question 2. Optional exercises restart at 1.
    numbers: ["1", "2", "3", "4", "5", "6", "7", "8", "1", "3", "4", "5", "6", "1", "2"],
    minFigures: 10, annotationKinds: ["reference_answer"] },
  { id: "chinese", file: "语文_仅参考答案.pdf", pages: 4,
    numbers: [], minFigures: 0, annotationKinds: ["reference_answer"], answerOnlyPages: [1, 2, 3, 4] },
] as const;
