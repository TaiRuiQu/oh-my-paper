import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { renderMathText } from "@/server/exams/math";
import { getDb } from "@/server/db/client";
import { TOPICS, type LearningOverview } from "@/contracts/learning";
import { gradeTaskResult } from "@/server/grading/tasks";
import { isWrong, mastery } from "./projection";
import { gradeResultSchema } from "@/contracts/grading";

export async function learningOverview(userId: string): Promise<LearningOverview> {
  // Use only the latest completed report for each source version. Changes to a
  // teacher's score therefore remove obsolete errors without duplicate counters.
  const grades = await getDb().gradeTask.findMany({ where: { status: "COMPLETED", examTask: { OR: [{ userId, studentId: null }, { student: { accountId: userId } }] } }, include: { examTask: true }, orderBy: { createdAt: "desc" }, take: 500 });
  const [tags, sessions] = await Promise.all([getDb().learningTag.findMany({ where: { userId } }), getDb().practiceSession.findMany({ where: { userId, result: { not: Prisma.DbNull } }, orderBy: { updatedAt: "asc" } })]);
  const seen = new Set<string>(); let pending = 0;
  const entries: LearningOverview["entries"] = [];
  for (const grade of grades) {
    const version = `${grade.examTaskId}:${grade.examOutputKey}`;
    if (seen.has(version) || grade.examOutputKey !== grade.examTask.outputKey) continue;
    seen.add(version);
    const result = gradeTaskResult(grade);
    if (!result) continue;
    pending += result.questions.filter((q) => q.needsReview || q.failed).length;
    for (const q of result.questions.filter(isWrong)) {
      const key = `${version}:${q.questionId}`;
      const attempts = sessions.filter((s) => s.entryKey === key && s.mode === "original").flatMap((s) => {
        const r = gradeResultSchema.safeParse(s.result);
        return r.success && r.data.questions.every((i) => !i.needsReview && !i.failed && i.score !== null) ? [{ correct: r.data.questions.every((i) => i.score === i.maxPoints) }] : [];
      });
      entries.push({ key, gradeTaskId: grade.id, questionId: q.questionId, examTaskId: grade.examTaskId, title: grade.examTask.name, number: q.number, stem: q.questionText, subject: (grade.input as unknown as { exam: { subject: string | null } }).exam.subject ?? "其他", topicId: tags.find((t) => t.entryKey === key)?.topicId ?? null,
        verdict: q.score === 0 ? q.verdict === "unanswered" ? "未作答" : "错误" : "部分正确", feedback: q.feedback, lastErrorAt: grade.createdAt.toISOString(), attempts: attempts.length, correctAttempts: attempts.filter((a) => a.correct).length, mastered: mastery(attempts) });
    }
  }
  return { entries, pending, mathImages: await renderMathText(entries.map((e) => e.stem)), topics: TOPICS.map((t) => ({ id: t.id, name: t.name, count: entries.filter((e) => e.topicId === t.id && !e.mastered).length, practiced: entries.filter((e) => e.topicId === t.id && e.attempts > 0).length })).filter((t) => t.count || t.practiced) };
}
