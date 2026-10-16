import "server-only";
import type { PlatformState, ReviewAssignment } from "@/contracts/platform";
import { canReadSubject, canReviewSubject } from "@/contracts/permissions";
import { reviewRule } from "@/lib/document-layout";
import { reviewRoundAvailability } from "@/lib/review-round-availability";
import { applyOfficialResults, buildAnalytics } from "./analytics";
import { assessmentReviewBlockReason, findAssessmentParticipant } from "@/lib/assessment-roster";

const key = (submissionId: string, itemId: string) => `${submissionId}/${itemId}`;

function assignmentsFor(state: PlatformState): ReviewAssignment[] {
  const existing = new Map(
    state.reviewAssignments?.map((assignment) => [
      key(assignment.submissionId, assignment.itemId),
      assignment,
    ]),
  );
  const byItem = new Map<string, PlatformState["reviews"]>();
  for (const review of state.reviews) {
    const itemKey = key(review.submissionId, review.itemId);
    const rows = byItem.get(itemKey) ?? [];
    rows.push(review);
    byItem.set(itemKey, rows);
  }
  const assessments = new Map(state.assessments.map((entry) => [entry.id, entry]));
  const papers = new Map(state.papers.map((entry) => [entry.id, entry]));
  const classesByStudent = new Map(
    state.classrooms.flatMap((classroom) =>
      classroom.students.map((student) => [student.id, classroom] as const),
    ),
  );
  return state.submissions.flatMap((submission) => {
    const assessment = assessments.get(submission.assessmentId);
    const config = assessment?.papers.find((entry) => entry.paperId === submission.paperId);
    const paper = papers.get(submission.paperId);
    if (!assessment || !config || !paper) return [];
    const participant = findAssessmentParticipant(assessment, submission.studentId);
    const classroom = participant
      ? state.classrooms.find((entry) => entry.id === participant.classroomId)
      : classesByStudent.get(submission.studentId);
    const participationBlock = assessmentReviewBlockReason(
      assessment,
      submission.studentId,
      submission.paperId,
    );
    const canReview =
      state.reviewing ||
      (!!classroom &&
        canReviewSubject(state.actor, assessment, classroom, config.subject, state.classrooms));
    return paper.items.map((item): ReviewAssignment => {
      // A public state can be scoped again, but hidden scores must never be used to
      // infer that an occupied round is empty or that independent marking is over.
      const previous = existing.get(key(submission.id, item.id));
      if (previous)
        return participationBlock
          ? {
              ...previous,
              availableRounds: previous.availableRounds.map((choice) => ({
                ...choice,
                reason: participationBlock,
              })),
            }
          : previous;
      const rows = byItem.get(key(submission.id, item.id)) ?? [];
      const first = rows.find((review) => review.round === "FIRST");
      const second = rows.find((review) => review.round === "SECOND");
      const bothHuman =
        !!first &&
        first.source !== "AI" &&
        !!second &&
        second.source !== "AI" &&
        first.reviewerId !== second.reviewerId;
      const policy = reviewRule(config, item.id);
      return {
        submissionId: submission.id,
        itemId: item.id,
        blind: !assessment.published && policy.doubleReview && !bothHuman,
        rounds: rows.map(({ round, reviewerId, source }) => ({ round, reviewerId, source })),
        availableRounds: reviewRoundAvailability({
          reviewerId: state.actor.id,
          reviews: rows,
          policy,
          published: assessment.published,
        }).map((choice) =>
          participationBlock
            ? { ...choice, reason: participationBlock }
            : canReview
              ? choice
              : { ...choice, reason: "当前教学身份无本题阅卷权限" },
        ),
      };
    });
  });
}

/** The only outbound review projection; internal writes and official calculations use full state. */
export function projectReviewVisibility(state: PlatformState): PlatformState {
  if (state.requestedReview) {
    const { requestedReview, ...activeState } = state;
    const visible = projectReviewVisibility(activeState);
    if (state.actor.role === "STUDENT") return visible;
    // Reuse exactly the same blind-round projection on the separately authorized
    // inactive record; it never participates in active queues or aggregate scores.
    const historical = projectReviewVisibility({
      ...activeState,
      submissions: [requestedReview.submission],
      reviews: requestedReview.reviews,
      reviewHistory: requestedReview.reviewHistory,
      reviewAssignments: requestedReview.reviewAssignments,
      analytics: buildAnalytics({ ...activeState, submissions: [], reviews: [] }),
    });
    return {
      ...visible,
      requestedReview: {
        submission: requestedReview.submission,
        reviews: historical.reviews,
        reviewHistory: historical.reviewHistory ?? [],
        reviewAssignments: historical.reviewAssignments?.map((assignment) => ({
          ...assignment,
          availableRounds: assignment.availableRounds.map((choice) => ({
            ...choice,
            reason: "这份作答已退回或被新提交替代，旧轮次仅供查看。",
          })),
        })),
      },
    };
  }
  if (state.actor.role === "STUDENT")
    return { ...state, reviews: [], reviewHistory: [], reviewAssignments: [] };
  const reviewAssignments = assignmentsFor(state);
  const blind = new Set(
    reviewAssignments
      .filter((assignment) => assignment.blind)
      .map((assignment) => key(assignment.submissionId, assignment.itemId)),
  );
  const visible = (review: PlatformState["reviews"][number]) =>
    !blind.has(key(review.submissionId, review.itemId)) || review.reviewerId === state.actor.id;
  const result = {
    ...state,
    reviews: state.reviews.filter(visible),
    reviewHistory: state.reviewHistory?.filter(visible),
    reviewAssignments,
  };
  if (!blind.size) return result;
  const submissions = new Map(state.submissions.map((submission) => [submission.id, submission]));
  const hiddenGrades = new Set(
    reviewAssignments
      .filter((assignment) => assignment.blind)
      .flatMap((assignment) => {
        const submission = submissions.get(assignment.submissionId);
        return submission
          ? [
              `${submission.assessmentId}/${submission.studentId}/${submission.paperId}/${assignment.itemId}`,
            ]
          : [];
      }),
  );
  // Rebuild learning aggregates without blind items, including the actor's own
  // score. Retaining only raw reviews is insufficient: means and knowledge scores
  // can reveal an otherwise hidden mark through subtraction.
  const analytics = buildAnalytics({
    ...state,
    reviews: state.reviews.filter((review) => !blind.has(key(review.submissionId, review.itemId))),
    canReadSubject: (classroomId, subject) => {
      const classroom = state.classrooms.find((entry) => entry.id === classroomId);
      return !!classroom && (state.reviewing || canReadSubject(state.actor, classroom, subject));
    },
  });
  const safeOfficial = state.analytics.results.map((row) => {
    let rowBlind = false;
    const subjects = row.subjects.map((subject) => {
      let subjectBlind = false;
      const grades = subject.grades.map((grade) => {
        if (
          !hiddenGrades.has(
            `${row.assessmentId}/${row.studentId}/${subject.paperId}/${grade.itemId}`,
          )
        )
          return grade;
        subjectBlind = rowBlind = true;
        return {
          itemId: grade.itemId,
          maxScore: grade.maxScore,
          status: grade.status,
          score: null,
          feedback: "",
        };
      });
      return subjectBlind
        ? { ...subject, grades, score: null, rawScore: null, rank: null }
        : subject;
    });
    return rowBlind ? { ...row, subjects, total: null, rank: null, classRank: null } : row;
  });
  applyOfficialResults(analytics, safeOfficial);
  if (state.reviewing) {
    analytics.results = analytics.results.map((row) => ({
      ...row,
      total: null,
      rank: null,
      classRank: null,
      totalRestricted: true,
      subjects: row.subjects.map((subject) => ({ ...subject, rank: null })),
    }));
    analytics.students = [];
    analytics.knowledge = [];
    analytics.classrooms = [];
  }
  return { ...result, analytics };
}
