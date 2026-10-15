import "server-only";
import { getDb } from "@/server/db/client";
import { AccessError } from "@/server/http/errors";
import type { Actor, Analytics, Review } from "@/contracts/platform";
import { loadState } from "./service";
import { applyOfficialResults, buildAnalytics, mergeKnowledgeStats } from "./analytics";
import { canReadSubject } from "@/contracts/permissions";

export async function loadScopedAnalytics(
  actor: Actor,
  scope: {
    assessmentId?: string;
    classroomId?: string;
    studentId?: string;
    kind?: "EXAM" | "HOMEWORK";
  },
): Promise<Analytics> {
  const state = await loadState(actor);
  if (scope.assessmentId && !state.assessments.some((exam) => exam.id === scope.assessmentId))
    throw new AccessError(404, "考试不存在。");
  if (
    scope.classroomId &&
    !state.classrooms.some((classroom) => classroom.id === scope.classroomId)
  )
    throw new AccessError(404, "班级不存在。");
  if (
    scope.studentId &&
    !state.classrooms.some((classroom) =>
      classroom.students.some((student) => student.id === scope.studentId),
    )
  )
    throw new AccessError(404, "学生不存在。");
  const assessments = state.assessments.filter(
    (exam) =>
      (!scope.assessmentId || exam.id === scope.assessmentId) &&
      (!scope.kind || exam.kind === scope.kind),
  );
  const assessmentIds = new Set(assessments.map((exam) => exam.id));
  const classrooms = state.classrooms
    .filter((classroom) => !scope.classroomId || classroom.id === scope.classroomId)
    .map((classroom) => ({
      ...classroom,
      students: classroom.students.filter(
        (student) => !scope.studentId || student.id === scope.studentId,
      ),
    }));
  const studentIds = new Set(
    classrooms.flatMap((classroom) => classroom.students.map((student) => student.id)),
  );
  const submissions = state.submissions.filter(
    (submission) =>
      assessmentIds.has(submission.assessmentId) && studentIds.has(submission.studentId),
  );
  const submissionIds = new Set(submissions.map((submission) => submission.id));
  const rows =
    state.actor.role === "STUDENT"
      ? await getDb().review.findMany({ where: { submissionId: { in: [...submissionIds] } } })
      : [];
  const reviews =
    state.actor.role === "STUDENT"
      ? (rows.map((review) => ({
          ...review,
          createdAt: review.createdAt.toISOString(),
        })) as Review[])
      : state.reviews.filter((review) => submissionIds.has(review.submissionId));
  const questions =
    state.actor.role === "STUDENT"
      ? [
          ...new Map(
            state.analytics.students
              .flatMap((report) => report.recommendations)
              .map((question) => [question.id, question]),
          ).values(),
        ]
      : state.questions;
  const analytics = buildAnalytics({
    questions,
    papers: state.papers,
    classrooms,
    assessments,
    submissions,
    reviews,
    canReadSubject: (id, subject) => {
      const classroom = classrooms.find((c) => c.id === id);
      return (
        !!classroom &&
        (state.actor.role === "STUDENT" || canReadSubject(state.actor, classroom, subject))
      );
    },
  });
  // Preserve official conversion and joint ranks calculated across the full assessment roster.
  applyOfficialResults(analytics, state.analytics.results);
  analytics.knowledge = mergeKnowledgeStats(
    analytics.students.flatMap((report) => report.knowledge),
  );
  if (state.actor.role === "STUDENT") analytics.classrooms = [];
  return analytics;
}
