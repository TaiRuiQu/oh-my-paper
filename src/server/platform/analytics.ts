import type {
  Analytics,
  Assessment,
  AssessmentPaper,
  BankQuestion,
  Classroom,
  FinalGrade,
  GradeConversion,
  KnowledgeStat,
  LearningReport,
  Paper,
  PartScore,
  Review,
  ScanSubmission,
  StudentResult,
  SubjectResult,
} from "./types";
import { reviewRule, scoresNearlyEqual, exceedsReviewDifference } from "@/lib/document-layout";
export function finalGrades(
  paper: Paper,
  config: AssessmentPaper,
  submission: ScanSubmission | undefined,
  reviews: Review[],
): FinalGrade[] {
  return paper.items.map((item) => {
    const rows = submission
      ? reviews.filter((r) => r.submissionId === submission.id && r.itemId === item.id)
      : [];
    const first = rows.find((r) => r.round === "FIRST"),
      second = rows.find((r) => r.round === "SECOND"),
      third = rows.find((r) => r.round === "ARBITRATION");
    let score: number | null = null,
      status: FinalGrade["status"] = "PENDING",
      feedback = "";
    let partScores: PartScore[] = [];
    const policy = reviewRule(config, item.id);
    let counted: Review[] = [];
    let calculation = "";
    if (policy.doubleReview && first?.source === "AI") feedback = "AI 首评建议待教师确认";
    else if (first && !policy.doubleReview) counted = [first];
    else if (first && second) {
      if (
        policy.arbitrationEnabled &&
        exceedsReviewDifference(first.score, second.score, policy.maxDifference)
      ) {
        if (!third) status = "ARBITRATION";
        else {
          const d1 = Math.abs(first.score - third.score),
            d2 = Math.abs(second.score - third.score);
          // A tie uses the mean of the two equally close original scores.
          counted = scoresNearlyEqual(d1, d2)
            ? [
                third,
                {
                  ...first,
                  score: (first.score + second.score) / 2,
                  partScores: first.partScores?.map((part) => ({
                    ...part,
                    score:
                      (part.score +
                        (second.partScores?.find((p) => p.partId === part.partId)?.score ??
                          part.score)) /
                      2,
                  })),
                },
              ]
            : [third, d1 < d2 ? first : second];
        }
      } else counted = [first, second];
    } else if (first) status = "SECOND";
    if (counted.length) {
      score = counted.reduce((sum, row) => sum + row.score, 0) / counted.length;
      calculation =
        counted.length === 1
          ? `单评 ${counted[0].score}`
          : third &&
              policy.arbitrationEnabled &&
              first &&
              second &&
              exceedsReviewDifference(first.score, second.score, policy.maxDifference)
            ? `仲裁 ${counted[0].score} 与较近原评分 ${counted[1].score} 的平均分`
            : `双评 (${counted[0].score} + ${counted[1].score}) ÷ 2`;
      if (item.snapshot.type === "MIXED" && counted.every((row) => row.partScores?.length)) {
        partScores = counted[0].partScores!.map((part) => ({
          partId: part.partId,
          score:
            counted.reduce(
              (sum, row) =>
                sum + (row.partScores!.find((p) => p.partId === part.partId)?.score ?? 0),
              0,
            ) / counted.length,
          feedback: counted
            .map((row) => row.partScores!.find((p) => p.partId === part.partId)?.feedback)
            .filter(Boolean)
            .join("；"),
        }));
        score = partScores.reduce((sum, part) => sum + part.score, 0);
      }
      status = "FINAL";
      feedback = counted
        .map((row) => row.feedback)
        .filter(Boolean)
        .join("；");
    }
    return {
      itemId: item.id,
      score,
      maxScore: item.score,
      status,
      feedback,
      partScores,
      calculation,
    };
  });
}
function setRanks<T>(rows: T[], value: (r: T) => number | null, set: (r: T, rank: number) => void) {
  const sorted = rows.filter((r) => value(r) !== null).sort((a, b) => value(b)! - value(a)!);
  let rank = 0,
    last: number | null = null;
  sorted.forEach((r, i) => {
    const v = value(r)!;
    if (v !== last) rank = i + 1;
    set(r, rank);
    last = v;
  });
}
export function convertRankScores(
  scores: { id: string; raw: number }[],
  conversion: GradeConversion,
): Map<string, number> {
  if (!conversion.enabled) return new Map(scores.map((s) => [s.id, s.raw]));
  const sorted = [...scores].sort((a, b) => b.raw - a.raw),
    groups = new Map<number, typeof scores>();
  let rank = 0,
    last: number | null = null;
  sorted.forEach((s, i) => {
    if (s.raw !== last) rank = i + 1;
    last = s.raw;
    const percentile = ((rank - 1) / Math.max(1, sorted.length)) * 100;
    let index = conversion.bands.findIndex((b) => percentile < b.upperPercent);
    if (index < 0) index = conversion.bands.length - 1;
    const g = groups.get(index) ?? [];
    g.push(s);
    groups.set(index, g);
  });
  const result = new Map<string, number>();
  for (const [index, group] of groups) {
    const band = conversion.bands[index];
    if (!band) continue;
    const hi = Math.max(...group.map((s) => s.raw)),
      lo = Math.min(...group.map((s) => s.raw));
    for (const s of group)
      result.set(
        s.id,
        Math.round(
          hi === lo ? band.max : band.min + ((s.raw - lo) / (hi - lo)) * (band.max - band.min),
        ),
      );
  }
  return result;
}
export function mergeKnowledgeStats(rows: KnowledgeStat[]): KnowledgeStat[] {
  const combined = new Map<string, KnowledgeStat>();
  for (const row of rows) {
    const current = combined.get(row.tag) ?? {
      tag: row.tag,
      earned: 0,
      maximum: 0,
      attempts: 0,
      accuracy: 0,
    };
    current.earned += row.earned;
    current.maximum += row.maximum;
    current.attempts += row.attempts;
    current.accuracy = current.maximum ? current.earned / current.maximum : 0;
    combined.set(row.tag, current);
  }
  return [...combined.values()].sort(
    (a, b) => a.accuracy - b.accuracy || a.tag.localeCompare(b.tag),
  );
}
function stats(
  entries: { question: BankQuestion; score: number; maximum: number }[],
): KnowledgeStat[] {
  const map = new Map<string, KnowledgeStat>();
  for (const e of entries) {
    const tags = [
      ...new Set([
        ...e.question.knowledgeTags,
        ...e.question.content.parts.flatMap((p) => p.knowledgeTags),
      ]),
    ];
    for (const tag of tags) {
      const row = map.get(tag) ?? { tag, earned: 0, maximum: 0, accuracy: 0, attempts: 0 };
      row.earned += e.score / tags.length;
      row.maximum += e.maximum / tags.length;
      row.attempts++;
      row.accuracy = row.maximum ? row.earned / row.maximum : 0;
      map.set(tag, row);
    }
  }
  return [...map.values()].sort((a, b) => a.accuracy - b.accuracy || a.tag.localeCompare(b.tag));
}
export function buildAnalytics(input: {
  questions: BankQuestion[];
  papers: Paper[];
  classrooms: Classroom[];
  assessments: Assessment[];
  submissions: ScanSubmission[];
  reviews: Review[];
  canReadSubject?: (classroomId: string, subject: string, assessment?: Assessment) => boolean;
}): Analytics {
  const results: StudentResult[] = [];
  for (const a of input.assessments) {
    const rows: StudentResult[] = [];
    for (const c of input.classrooms.filter((c) => a.classroomIds.includes(c.id)))
      for (const student of c.students) {
        const subjects: SubjectResult[] = a.papers
          .filter(
            (config) => !input.canReadSubject || input.canReadSubject(c.id, config.subject, a),
          )
          .map((config) => {
            const paper = input.papers.find((p) => p.id === config.paperId);
            if (!paper)
              return {
                paperId: config.paperId,
                subject: config.subject,
                rawScore: null,
                score: null,
                maxScore: 0,
                rank: null,
                grades: [],
              };
            const submission = input.submissions.find(
              (s) =>
                s.assessmentId === a.id && s.paperId === paper.id && s.studentId === student.id,
            );
            const grades = finalGrades(paper, config, submission, input.reviews);
            const rawScore =
              grades.length && grades.every((g) => g.status === "FINAL")
                ? Math.round(grades.reduce((n, g) => n + g.score!, 0) * 100) / 100
                : null;
            return {
              paperId: paper.id,
              subject: config.subject,
              rawScore,
              score: rawScore,
              maxScore: paper.items.reduce((n, i) => n + i.score, 0),
              rank: null,
              grades,
            };
          });
        if (!subjects.length) continue;
        rows.push({
          assessmentId: a.id,
          studentId: student.id,
          studentName: student.name,
          studentNumber: student.studentNumber,
          classroomId: c.id,
          classroomName: c.name,
          total: null,
          rank: null,
          classRank: null,
          subjects,
        });
      }
    for (const config of a.papers) {
      const pairs = rows
        .filter((row) => row.subjects.some((s) => s.paperId === config.paperId))
        .map((row) => ({
          row,
          subject: row.subjects.find((s) => s.paperId === config.paperId)!,
        }));
      setRanks(
        pairs,
        (r) => r.subject.rawScore,
        (r, rank) => {
          r.subject.rank = rank;
        },
      );
      // Rank-based conversion is provisional until every participant has a final score.
      const allFinal = pairs.length > 0 && pairs.every((p) => p.subject.rawScore !== null);
      if (config.conversion.enabled) {
        const converted = allFinal
          ? convertRankScores(
              pairs.map((p) => ({ id: p.row.studentId, raw: p.subject.rawScore! })),
              config.conversion,
            )
          : new Map<string, number>();
        for (const p of pairs) p.subject.score = converted.get(p.row.studentId) ?? null;
      }
    }
    for (const row of rows)
      row.total =
        row.subjects.length && row.subjects.every((s) => s.score !== null)
          ? Math.round(row.subjects.reduce((n, s) => n + s.score!, 0) * 100) / 100
          : null;
    setRanks(
      rows,
      (r) => r.total,
      (r, rank) => {
        r.rank = rank;
      },
    );
    for (const c of input.classrooms)
      setRanks(
        rows.filter((r) => r.classroomId === c.id),
        (r) => r.total,
        (r, rank) => {
          r.classRank = rank;
        },
      );
    results.push(...rows);
  }
  const entries: {
    studentId: string;
    classroomId: string;
    question: BankQuestion;
    score: number;
    maximum: number;
  }[] = [];
  const students: LearningReport[] = [];
  for (const c of input.classrooms)
    for (const student of c.students) {
      const wrongQuestions: LearningReport["wrongQuestions"] = [],
        subjectMap = new Map<
          string,
          { subject: string; earned: number; maximum: number; accuracy: number }
        >(),
        attempted = new Set<string>();
      for (const result of results.filter((r) => r.studentId === student.id))
        for (const subject of result.subjects) {
          const paper = input.papers.find((p) => p.id === subject.paperId);
          const submission = input.submissions.find(
            (s) =>
              s.assessmentId === result.assessmentId &&
              s.paperId === subject.paperId &&
              s.studentId === student.id,
          );
          if (!paper || !submission) continue;
          for (const g of subject.grades) {
            if (g.score === null) continue;
            const item = paper.items.find((i) => i.id === g.itemId)!;
            attempted.add(item.questionId);
            const parts = item.snapshot.content.parts;
            const weight = parts.reduce((n, part) => n + part.score, 0);
            if (item.snapshot.type === "MIXED" && g.partScores?.length && weight > 0) {
              for (const part of parts) {
                const actual = g.partScores.find((p) => p.partId === part.id);
                if (!actual) continue;
                entries.push({
                  studentId: student.id,
                  classroomId: c.id,
                  question: {
                    ...item.snapshot,
                    knowledgeTags: part.knowledgeTags.length
                      ? part.knowledgeTags
                      : item.snapshot.knowledgeTags,
                    content: { ...item.snapshot.content, parts: [] },
                  },
                  score: actual.score,
                  maximum: (g.maxScore * part.score) / weight,
                });
              }
            } else
              entries.push({
                studentId: student.id,
                classroomId: c.id,
                question: item.snapshot,
                score: g.score,
                maximum: g.maxScore,
              });
            const ss = subjectMap.get(subject.subject) ?? {
              subject: subject.subject,
              earned: 0,
              maximum: 0,
              accuracy: 0,
            };
            ss.earned += g.score;
            ss.maximum += g.maxScore;
            ss.accuracy = ss.maximum ? ss.earned / ss.maximum : 0;
            subjectMap.set(subject.subject, ss);
            if (g.score < g.maxScore)
              wrongQuestions.push({
                assessmentId: result.assessmentId,
                paperId: paper.id,
                itemId: item.id,
                question: item.snapshot,
                score: g.score,
                maximum: g.maxScore,
                answer: submission.answers.find((a) => a.itemId === item.id) ?? {
                  itemId: item.id,
                  text: "",
                  images: [],
                },
                feedback: g.feedback,
                partScores: g.partScores,
                wrongPartIds:
                  item.snapshot.type === "MIXED" && g.partScores?.length
                    ? parts
                        .filter(
                          (part) =>
                            (g.partScores!.find((p) => p.partId === part.id)?.score ?? 0) <
                            (g.maxScore * part.score) / weight - 0.000001,
                        )
                        .map((part) => part.id)
                    : undefined,
              });
          }
        }
      const knowledge = stats(entries.filter((e) => e.studentId === student.id)),
        weak = new Set(knowledge.filter((k) => k.accuracy < 0.7).map((k) => k.tag));
      const recommendations = input.questions
        .filter(
          (q) =>
            (!input.canReadSubject || input.canReadSubject(c.id, q.subject)) &&
            !attempted.has(q.id) &&
            [...q.knowledgeTags, ...q.content.parts.flatMap((p) => p.knowledgeTags)].some((t) =>
              weak.has(t),
            ),
        )
        .sort((a, b) => {
          const overlap = (q: BankQuestion) => q.knowledgeTags.filter((t) => weak.has(t)).length;
          return overlap(b) - overlap(a) || a.difficulty - b.difficulty;
        })
        .slice(0, 6);
      students.push({
        studentId: student.id,
        subjects: [...subjectMap.values()],
        knowledge,
        wrongQuestions,
        recommendations,
      });
    }
  return {
    results,
    knowledge: stats(entries),
    students,
    classrooms: input.classrooms.map((c) => {
      const rows = results.filter((r) => r.classroomId === c.id && r.total !== null);
      return {
        id: c.id,
        name: c.name,
        average: rows.length
          ? Math.round((rows.reduce((n, r) => n + r.total!, 0) / rows.length) * 100) / 100
          : null,
        participantCount: new Set(rows.map((r) => r.studentId)).size,
        knowledge: stats(entries.filter((e) => e.classroomId === c.id)),
      };
    }),
  };
}

export function applyOfficialResults(analytics: Analytics, official: Analytics["results"]) {
  analytics.results = analytics.results.map((row) => {
    const original = official.find(
      (r) => r.assessmentId === row.assessmentId && r.studentId === row.studentId,
    );
    if (!original) return row;
    const subjects = original.subjects.filter((s) =>
      row.subjects.some((visible) => visible.paperId === s.paperId),
    );
    const complete = subjects.length === original.subjects.length && !original.totalRestricted;
    return {
      ...row,
      subjects,
      totalRestricted: !complete,
      total: complete ? original.total : null,
      rank: complete ? original.rank : null,
      classRank: complete ? original.classRank : null,
    };
  });
  analytics.classrooms = analytics.classrooms.map((classroom) => {
    const rows = analytics.results.filter(
      (row) => row.classroomId === classroom.id && row.total !== null,
    );
    return {
      ...classroom,
      average: rows.length
        ? Math.round((rows.reduce((sum, row) => sum + row.total!, 0) / rows.length) * 100) / 100
        : null,
      participantCount: new Set(
        analytics.results
          .filter((row) => row.classroomId === classroom.id)
          .map((row) => row.studentId),
      ).size,
    };
  });
  return analytics;
}
