import { describe, expect, it } from "vitest";
import {
  buildAnalytics,
  convertRankScores,
  finalGrades,
  mergeKnowledgeStats,
} from "@/server/platform/analytics";
import { commandSchema } from "@/server/platform/schemas";
import type {
  Assessment,
  AssessmentPaper,
  BankQuestion,
  Classroom,
  Paper,
  Review,
  ScanSubmission,
} from "@/server/platform/types";
const q: BankQuestion = {
  id: "q",
  ownerId: "teacher",
  type: "BLANK",
  subject: "数学",
  grade: "高一",
  difficulty: 0.5,
  knowledgeTags: ["代数"],
  content: {
    stem: "1+1=___",
    options: [],
    answers: ["2"],
    explanation: "加法",
    rubric: "填2得10分",
    parts: [],
    images: [],
  },
  createdAt: "",
  updatedAt: "",
};
const paper: Paper = {
  id: "paper",
  ownerId: "teacher",
  name: "数学",
  kind: "EXAM",
  subject: "数学",
  grade: "高一",
  instructions: "",
  layout: { paperSize: "A4", columns: 1 },
  items: [{ id: "item", questionId: q.id, position: 0, score: 10, section: "填空", snapshot: q }],
  createdAt: "",
  updatedAt: "",
};
const config: AssessmentPaper = {
  paperId: paper.id,
  subject: paper.subject,
  gradingMode: "DOUBLE",
  arbitrationThreshold: 2,
  conversion: { enabled: false, bands: [] },
};
const submission: ScanSubmission = {
  id: "s",
  ownerId: "teacher",
  assessmentId: "exam",
  paperId: paper.id,
  studentId: "student",
  templateId: null,
  kind: "WORKBOOK",
  status: "PENDING",
  sourceFiles: [],
  answers: [{ itemId: "item", text: "2", images: [] }],
  alignment: null,
  createdAt: "",
};
function review(round: Review["round"], score: number, reviewerId = round): Review {
  return {
    id: round,
    submissionId: "s",
    itemId: "item",
    round,
    score,
    reviewerId,
    feedback: round,
    createdAt: "",
  };
}
const classroom: Classroom = {
  id: "class",
  ownerId: "teacher",
  name: "一班",
  stage: "高中",
  cohort: "2027届",

  students: [
    {
      id: "student",
      classroomId: "class",
      userId: "account",
      name: "小明",
      studentNumber: "000001",
    },
    { id: "student2", classroomId: "class", userId: null, name: "小红", studentNumber: "000002" },
  ],
};
const assessment: Assessment = {
  id: "exam",
  ownerId: "teacher",
  name: "联考",
  kind: "EXAM",
  reviewScope: "CLASSROOM",
  classroomIds: ["class"],
  papers: [config],
  published: false,
  createdAt: "",
};
describe("platform domain grading and analytics", () => {
  it("aggregates mixed subpart reviews independently and keeps mastered parts out of weaknesses", () => {
    const mixed: Paper = {
      ...paper,
      items: [
        {
          ...paper.items[0],
          snapshot: {
            ...q,
            type: "MIXED",
            knowledgeTags: [],
            content: {
              ...q.content,
              parts: [
                {
                  id: "1",
                  type: "BLANK",
                  stem: "填空",
                  options: [],
                  answers: ["2"],
                  explanation: "",
                  rubric: "",
                  knowledgeTags: ["代数"],
                  score: 4,
                },
                {
                  id: "2",
                  type: "SUBJECTIVE",
                  stem: "证明",
                  options: [],
                  answers: ["证明"],
                  explanation: "",
                  rubric: "",
                  knowledgeTags: ["几何"],
                  score: 6,
                },
              ],
            },
          },
        },
      ],
    };
    const first = {
      ...review("FIRST", 5),
      partScores: [
        { partId: "1", score: 4, feedback: "正确" },
        { partId: "2", score: 1, feedback: "有错" },
      ],
    };
    const second = {
      ...review("SECOND", 7),
      partScores: [
        { partId: "1", score: 4, feedback: "正确" },
        { partId: "2", score: 3, feedback: "部分正确" },
      ],
    };
    const grades = finalGrades(mixed, config, submission, [first, second]);
    expect(grades[0].partScores?.map((p) => p.score)).toEqual([4, 2]);
    expect(grades[0].score).toBe(6);
    const result = buildAnalytics({
      questions: [q],
      papers: [mixed],
      classrooms: [classroom],
      assessments: [assessment],
      submissions: [submission],
      reviews: [first, second],
    });
    expect(result.students[0].knowledge.find((k) => k.tag === "代数")?.accuracy).toBe(1);
    expect(result.students[0].knowledge.find((k) => k.tag === "几何")?.accuracy).toBeCloseTo(1 / 3);
    expect(result.students[0].wrongQuestions[0].wrongPartIds).toEqual(["2"]);
    const arbitrate = {
      ...review("ARBITRATION", 6),
      partScores: [
        { partId: "1", score: 4, feedback: "正确" },
        { partId: "2", score: 2, feedback: "第三评" },
      ],
    };
    const divergent = {
      ...second,
      score: 9,
      partScores: [
        { partId: "1", score: 4, feedback: "正确" },
        { partId: "2", score: 5, feedback: "步骤完整" },
      ],
    };
    expect(
      finalGrades(mixed, config, submission, [first, divergent, arbitrate])[0].partScores,
    ).toMatchObject([
      { partId: "1", score: 4 },
      { partId: "2", score: 1.5 },
    ]);
  });

  it("aggregates authorized knowledge statistics rather than duplicating each student's tag", () => {
    expect(
      mergeKnowledgeStats([
        { tag: "代数", earned: 8, maximum: 10, accuracy: 0.8, attempts: 1 },
        { tag: "代数", earned: 2, maximum: 10, accuracy: 0.2, attempts: 1 },
      ]),
    ).toEqual([{ tag: "代数", earned: 10, maximum: 20, accuracy: 0.5, attempts: 2 }]);
  });
  it("requires two reviews, averages within tolerance and requires arbitration outside it", () => {
    expect(finalGrades(paper, config, submission, [])[0].status).toBe("PENDING");
    expect(finalGrades(paper, config, submission, [review("FIRST", 8)])[0].status).toBe("SECOND");
    expect(
      finalGrades(paper, config, submission, [review("FIRST", 8), review("SECOND", 6)])[0].score,
    ).toBe(7);
    const rows = [review("FIRST", 8), review("SECOND", 3)];
    expect(finalGrades(paper, config, submission, rows)[0]).toMatchObject({
      score: null,
      status: "ARBITRATION",
    });
    expect(
      finalGrades(paper, config, submission, [...rows, review("ARBITRATION", 5)])[0],
    ).toMatchObject({ score: 4, status: "FINAL" });
  });
  it("supports single grading and does not grade missing students or missing subjects", () => {
    const single = { ...assessment, papers: [{ ...config, gradingMode: "SINGLE" as const }] };
    const analytics = buildAnalytics({
      questions: [q],
      papers: [paper],
      classrooms: [classroom],
      assessments: [single],
      submissions: [submission],
      reviews: [review("FIRST", 7)],
    });
    expect(analytics.results).toHaveLength(2);
    expect(analytics.results.find((r) => r.studentId === "student")).toMatchObject({
      total: 7,
      rank: 1,
      classRank: 1,
    });
    expect(analytics.results.find((r) => r.studentId === "student2")).toMatchObject({
      total: null,
      rank: null,
    });
    expect(analytics.students[0].knowledge[0]).toMatchObject({ tag: "代数", accuracy: 0.7 });
    expect(analytics.students[0].wrongQuestions[0]).toMatchObject({ score: 7, maximum: 10 });
    expect(analytics.classrooms[0].average).toBe(7);
  });
  it("ranks tied totals equally and computes union totals across multiple papers", () => {
    const biology: Paper = {
      ...paper,
      id: "biology",
      subject: "生物",
      items: [
        { ...paper.items[0], id: "biology-item", snapshot: { ...q, id: "bio", subject: "生物" } },
      ],
    };
    const exam = {
      ...assessment,
      papers: [
        { ...config, gradingMode: "SINGLE" as const },
        { ...config, paperId: "biology", subject: "生物", gradingMode: "SINGLE" as const },
      ],
    };
    const subs = [
      submission,
      { ...submission, id: "s2", studentId: "student2" },
      {
        ...submission,
        id: "b1",
        paperId: "biology",
        answers: [{ itemId: "biology-item", text: "", images: [] }],
      },
      {
        ...submission,
        id: "b2",
        paperId: "biology",
        studentId: "student2",
        answers: [{ itemId: "biology-item", text: "", images: [] }],
      },
    ];
    const reviews = subs.map((s, i) => ({
      ...review("FIRST", [6, 8, 8, 6][i]),
      id: `r${i}`,
      submissionId: s.id,
      itemId: s.paperId === "biology" ? "biology-item" : "item",
    }));
    const analytics = buildAnalytics({
      questions: [q],
      papers: [paper, biology],
      classrooms: [classroom],
      assessments: [exam],
      submissions: subs,
      reviews,
    });
    expect(analytics.results.map((r) => r.total)).toEqual([14, 14]);
    expect(analytics.results.map((r) => r.rank)).toEqual([1, 1]);
    expect(analytics.results[0].subjects.map((s) => s.rank)).toEqual([2, 1]);
  });
  it("keeps grade conversion provisional until every student final, preserves tied raw scores", () => {
    const conversion = {
      enabled: true,
      bands: [
        { upperPercent: 50, min: 86, max: 100 },
        { upperPercent: 100, min: 40, max: 85 },
      ],
    };
    const converted = convertRankScores(
      [
        { id: "a", raw: 90 },
        { id: "b", raw: 90 },
        { id: "c", raw: 50 },
        { id: "d", raw: 20 },
      ],
      conversion,
    );
    expect(converted.get("a")).toBe(converted.get("b"));
    expect(converted.get("a")).toBe(100);
    expect(converted.get("d")).toBe(40);
    const exam = {
      ...assessment,
      papers: [{ ...config, gradingMode: "SINGLE" as const, conversion }],
    };
    const analytics = buildAnalytics({
      questions: [q],
      papers: [paper],
      classrooms: [classroom],
      assessments: [exam],
      submissions: [submission],
      reviews: [review("FIRST", 9)],
    });
    expect(analytics.results[0].subjects[0]).toMatchObject({ rawScore: 9, score: null });
    expect(analytics.results[0].total).toBeNull();
  });
  it("recommends different questions on genuinely weak points and preserves snapshots", () => {
    const suggestion = {
      ...q,
      id: "other",
      content: { ...q.content, stem: "2+2=___", answers: ["4"] },
    };
    const analytics = buildAnalytics({
      questions: [q, suggestion],
      papers: [paper],
      classrooms: [classroom],
      assessments: [{ ...assessment, papers: [{ ...config, gradingMode: "SINGLE" }] }],
      submissions: [submission],
      reviews: [review("FIRST", 3)],
    });
    expect(analytics.students[0].recommendations.map((q) => q.id)).toEqual(["other"]);
    expect(analytics.students[0].wrongQuestions[0].question.content.answers).toEqual(["2"]);
  });
});
describe("platform command contracts", () => {
  it("accepts structured mixed questions with per-part answers and scores", () => {
    const mixed = {
      ...q,
      type: "MIXED",
      content: {
        ...q.content,
        parts: [
          {
            id: "1",
            type: "SINGLE",
            stem: "选择",
            options: [
              { label: "A", text: "1" },
              { label: "B", text: "2" },
            ],
            answers: ["B"],
            explanation: "",
            rubric: "",
            knowledgeTags: ["计算"],
            score: 2,
          },
          {
            id: "2",
            type: "BLANK",
            stem: "两个空",
            options: [],
            answers: ["3", "4"],
            explanation: "",
            rubric: "每空1分",
            knowledgeTags: ["代数"],
            score: 2,
          },
        ],
      },
    };
    expect(commandSchema.safeParse({ type: "question.save", question: mixed }).success).toBe(true);
  });
  it("requires student cohorts on classes while retaining fixed grades on questions", () => {
    for (const cohort of ["2027届", "2024级"]) {
      expect(
        commandSchema.safeParse({
          type: "classroom.save",
          classroom: { name: "1班", stage: "高中", cohort },
        }).success,
      ).toBe(true);
    }
    for (const classroom of [
      { name: "1班", grade: "高一" },
      { name: "1班", stage: "高中", cohort: "  " },
    ]) {
      expect(commandSchema.safeParse({ type: "classroom.save", classroom }).success).toBe(false);
    }
    expect(commandSchema.safeParse({ type: "question.save", question: q }).success).toBe(true);
  });
  it("rejects invalid choices, duplicate question order and overlapping grade bands", () => {
    expect(
      commandSchema.safeParse({
        type: "question.save",
        question: {
          ...q,
          type: "SINGLE",
          content: {
            ...q.content,
            options: [
              { label: "A", text: "a" },
              { label: "B", text: "b" },
            ],
            answers: ["C"],
          },
        },
      }).success,
    ).toBe(false);
    expect(
      commandSchema.safeParse({
        type: "paper.save",
        paper: {
          ...paper,
          items: [
            { questionId: "q", score: 10, section: "" },
            { questionId: "q", score: 2, section: "" },
          ],
        },
      }).success,
    ).toBe(false);
    expect(
      commandSchema.safeParse({
        type: "assessment.save",
        assessment: {
          ...assessment,
          papers: [
            {
              ...config,
              conversion: {
                enabled: true,
                bands: [
                  { upperPercent: 50, min: 70, max: 100 },
                  { upperPercent: 100, min: 40, max: 90 },
                ],
              },
            },
          ],
        },
      }).success,
    ).toBe(false);
  });
  it("accepts complete answer card regions and rejects off-page coordinates", () => {
    const template = {
      paperId: "paper",
      subject: "数学",
      name: "模板",
      layout: {
        width: 794,
        height: 1123,
        pageCount: 1,
        markers: [
          { x: 0.02, y: 0.02 },
          { x: 0.98, y: 0.02 },
          { x: 0.02, y: 0.98 },
          { x: 0.98, y: 0.98 },
        ],
        studentNumber: { digits: 6, x: 0.1, y: 0.1, cellWidth: 0.02, cellHeight: 0.02 },
        regions: [
          { itemId: "item", page: 1, x: 0.1, y: 0.3, width: 0.8, height: 0.1, kind: "BLANK" },
        ],
      },
    };
    expect(commandSchema.safeParse({ type: "template.save", template }).success).toBe(true);
    template.layout.regions[0].x = 0.5;
    expect(commandSchema.safeParse({ type: "template.save", template }).success).toBe(false);
  });
});
