import "server-only";
import { paperRecord, assessmentRecord } from "./records";
import { getDb } from "@/server/db/client";
import { AccessError } from "@/server/http/errors";
import { getActor, toTeachingAssignment, visibleClassrooms, type Db } from "./access";
import { canReadSubject, canReviewSubject } from "@/contracts/permissions";
import { defaultCardPresets } from "./cards";
import { applyOfficialResults, buildAnalytics } from "./analytics";
import { projectReviewVisibility } from "./review-visibility";
import type {
  Actor,
  Assessment,
  BankQuestion,
  CardTemplate,
  Classroom,
  Paper,
  PlatformState,
  Review,
  ScanSubmission,
} from "./types";
export async function loadInternalState(
  actor: Actor,
  db: Db = getDb(),
  options: { questionLimit?: number; reviewing?: boolean; requestedSubmissionId?: string } = {},
): Promise<PlatformState> {
  const a = await getActor(actor.id, db);
  if (options.reviewing && a.role === "STUDENT") throw new AccessError(403, "需要教师权限。");
  const classes = await db.classroom.findMany({
    where: options.reviewing ? {} : visibleClassrooms(a),
    include: { students: true },
    orderBy: { name: "asc" },
  });
  const allowedClassIds = classes.map((c) => c.id);
  const ownStudentIds = classes.flatMap((classroom) =>
    classroom.students.filter((student) => student.userId === a.id).map((student) => student.id),
  );
  const assessmentRows = await db.assessment.findMany({
    where:
      a.role === "ADMIN" || options.reviewing
        ? {}
        : a.role === "STUDENT"
          ? {
              published: true,
              rosterStatus: "CONFIRMED",
              participants: { some: { student: { userId: a.id } } },
            }
          : { classroomIds: { hasSome: allowedClassIds } },
    orderBy: { createdAt: "desc" },
    include: {
      participants: { include: { subjects: true } },
      homeworkAssignment: { select: { id: true, status: true } },
    },
  });
  const fullAssessments = assessmentRows.map((row) => {
    const { homeworkAssignment, ...record } = row;
    return {
      ...assessmentRecord(record),
      ...(homeworkAssignment ? { homeworkCollection: homeworkAssignment } : {}),
      createdAt: row.createdAt.toISOString(),
      papers: assessmentRecord(record).papers.map((p) => ({
        paperId: p.paperId,
        subject: p.subject,
        gradingMode: p.gradingMode,
        arbitrationThreshold: p.arbitrationThreshold,
        conversion: p.conversion,
        questionRules: p.questionRules,
      })),
    };
  }) as Assessment[];
  const readsSubject = (classroomId: string, subject: string, assessment?: Assessment) => {
    const classroom = classes.find((c) => c.id === classroomId);
    if (options.reviewing)
      return (
        !!classroom && !!assessment && canReviewSubject(a, assessment, classroom, subject, classes)
      );
    return !!classroom && (a.role === "STUDENT" || canReadSubject(a, classroom, subject));
  };
  const assessments = fullAssessments
    .map((row) => {
      const papers = row.papers.filter((p) =>
        classes.some((c) => row.classroomIds.includes(c.id) && readsSubject(c.id, p.subject, row)),
      );
      return {
        ...row,
        canManage:
          a.role === "ADMIN" ||
          (a.role === "TEACHER" &&
            row.ownerId === a.id &&
            [
              ...new Set([
                ...row.classroomIds,
                ...row.participants.map((participant) => participant.classroomId),
              ]),
            ].every((id) => {
              const classroom = classes.find((entry) => entry.id === id);
              return (
                !!classroom &&
                row.papers.every((paper) => canReadSubject(a, classroom, paper.subject))
              );
            })),
        papers,
        participants: row.participants
          .filter(
            (participant) =>
              allowedClassIds.includes(participant.classroomId) &&
              (a.role !== "STUDENT" || ownStudentIds.includes(participant.studentId)),
          )
          .map((participant) => ({
            ...participant,
            subjects: participant.subjects.filter((subject) =>
              papers.some(
                (paper) =>
                  paper.paperId === subject.paperId &&
                  readsSubject(participant.classroomId, paper.subject, row),
              ),
            ),
          }))
          .filter((participant) => participant.subjects.length),
      };
    })
    .filter((row) => row.papers.length);
  const paperIds = assessments.flatMap((a) => a.papers.map((p) => p.paperId));
  const paperRows = await db.paper.findMany({
    where:
      a.role === "ADMIN"
        ? {}
        : options.reviewing
          ? { id: { in: paperIds } }
          : { OR: [{ ownerId: a.id }, { id: { in: paperIds } }] },
    orderBy: { updatedAt: "desc" },
  });
  const papers = paperRows.map((p) => ({
    ...paperRecord(p),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  })) as unknown as Paper[];
  const questionRows = await db.question.findMany({
    take: options.reviewing ? 0 : options.questionLimit,
    where:
      a.role === "ADMIN"
        ? {}
        : a.role === "STUDENT"
          ? { ownerId: { in: assessmentRows.map((a) => a.ownerId) } }
          : { ownerId: a.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  const questions = questionRows.map((q) => ({
    ...q,
    createdAt: q.createdAt.toISOString(),
    updatedAt: q.updatedAt.toISOString(),
  })) as unknown as BankQuestion[];
  const classroomDTO = classes
    .filter(
      (c) =>
        !options.reviewing ||
        assessments.some(
          (exam) =>
            exam.classroomIds.includes(c.id) &&
            exam.papers.some((p) => readsSubject(c.id, p.subject, exam)),
        ),
    )
    .map((c) => ({
      ...c,
      students: a.role === "STUDENT" ? c.students.filter((s) => s.userId === a.id) : c.students,
    })) as Classroom[];
  // Resolve bound login names inside the server: the state users payload carries
  // staff only, so roster labels cannot depend on the account directory.
  const boundUserIds = [
    ...new Set(
      classroomDTO.flatMap((c) => c.students.flatMap((s) => (s.userId ? [s.userId] : []))),
    ),
  ];
  const boundLogins = new Map(
    boundUserIds.length
      ? (
          await db.user.findMany({
            where: { id: { in: boundUserIds } },
            select: { id: true, username: true, email: true },
          })
        ).map((user) => [user.id, user.username ?? user.email])
      : [],
  );
  for (const classroom of classroomDTO)
    for (const student of classroom.students)
      if (student.userId) student.userLogin = boundLogins.get(student.userId) ?? null;
  const studentIds = [
    ...new Set(
      assessments.flatMap((assessment) =>
        assessment.participants.map((participant) => participant.studentId),
      ),
    ),
  ];
  const candidateSubmissions = await db.scanSubmission.findMany({
    where: {
      ...(options.reviewing && options.requestedSubmissionId
        ? { OR: [{ active: true }, { id: options.requestedSubmissionId }] }
        : { active: true }),
      assessmentId: { in: assessments.map((a) => a.id) },
      ...(a.role !== "ADMIN" ? { studentId: { in: studentIds } } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  const submissionRows = candidateSubmissions.filter((row) => {
    const exam = assessments.find((exam) => exam.id === row.assessmentId);
    const participant = exam?.participants.find(
      (participant) => participant.studentId === row.studentId,
    );
    const paper = exam?.papers.find((paper) => paper.paperId === row.paperId);
    return !!participant && !!paper && readsSubject(participant.classroomId, paper.subject, exam);
  });
  const submissions = (options.reviewing && options.requestedSubmissionId
    ? submissionRows.filter((row) => row.active)
    : submissionRows
  ).map((s) => ({
    ...s,
    createdAt: s.createdAt.toISOString(),
  })) as unknown as ScanSubmission[];
  const reviewRows = await db.review.findMany({
    where: { submissionId: { in: submissionRows.map((s) => s.id) } },
    orderBy: { createdAt: "asc" },
  });
  const allReviews = reviewRows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
  })) as Review[];
  const activeIds = new Set(submissions.map((submission) => submission.id));
  const reviews = allReviews.filter((review) => activeIds.has(review.submissionId));
  const requested =
    options.reviewing && options.requestedSubmissionId
      ? submissionRows.find((row) => row.id === options.requestedSubmissionId && !row.active)
      : undefined;
  const reviewHistoryRows =
    a.role === "STUDENT"
      ? []
      : await db.reviewEvent.findMany({
          where: { submissionId: { in: submissionRows.map((s) => s.id) } },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        });
  const templateRows =
    a.role === "STUDENT"
      ? []
      : await db.cardTemplate.findMany({
          where:
            a.role === "ADMIN"
              ? {}
              : { OR: [{ preset: true }, { ownerId: a.id }, { paperId: { in: paperIds } }] },
          orderBy: { name: "asc" },
        });
  const templates = (a.role === "STUDENT"
    ? []
    : [
        ...defaultCardPresets(),
        ...templateRows.filter((t) => !t.preset),
      ]) as unknown as CardTemplate[];
  // The state users payload stays bounded by staff size: student accounts and the
  // searchable directory are read on demand via /api/platform/users, and roster
  // labels use the per-student userLogin resolved above.
  const users =
    a.role === "STUDENT"
      ? []
      : await db.user.findMany({
          where: { role: { in: ["ADMIN", "TEACHER"] } },
          select: {
            id: true,
            name: true,
            email: true,
            username: true,
            role: true,
            ...(a.role === "ADMIN" ? { teachingAssignments: true, permissionsVersion: true } : {}),
          },
          orderBy: { name: "asc" },
        });
  // Compute ranks over complete class rosters before filtering individual student visibility.
  let analytics = buildAnalytics({
    questions,
    papers,
    classrooms: classroomDTO,
    assessments,
    submissions,
    reviews,
    canReadSubject: readsSubject,
  });
  if (a.role !== "ADMIN" && !options.reviewing) {
    // Load peer scores solely inside the server to calculate authentic ranks, without exposing peers.
    const allSubs = await db.scanSubmission.findMany({
      where: { assessmentId: { in: assessments.map((x) => x.id) }, active: true },
    });
    const allReviews = await db.review.findMany({
      where: { submissionId: { in: allSubs.map((s) => s.id) } },
    });
    const allClasses = await db.classroom.findMany({
      where: { id: { in: [...new Set(assessments.flatMap((x) => x.classroomIds))] } },
      include: { students: true },
    });
    const official = buildAnalytics({
      questions,
      papers,
      classrooms: allClasses as Classroom[],
      assessments: fullAssessments,
      submissions: allSubs.map((s) => ({
        ...s,
        createdAt: s.createdAt.toISOString(),
      })) as unknown as ScanSubmission[],
      reviews: allReviews.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })) as Review[],
    });
    analytics = applyOfficialResults(analytics, official.results);
    if (a.role === "STUDENT") analytics.classrooms = [];
  }
  if (options.reviewing) {
    // A marking assignment exposes answer-level progress, not cross-class learning reports.
    analytics.results = analytics.results.map((row) => ({
      ...row,
      total: null,
      rank: null,
      classRank: null,
      totalRestricted: true,
      subjects: row.subjects.map((s) => ({ ...s, rank: null })),
    }));
    analytics.students = [];
    analytics.knowledge = [];
    analytics.classrooms = [];
  }
  return {
    ...(options.reviewing ? { reviewing: true } : {}),
    actor: a,
    questions: a.role === "STUDENT" ? [] : questions,
    questionCount:
      a.role === "STUDENT"
        ? 0
        : await db.question.count({ where: a.role === "ADMIN" ? {} : { ownerId: a.id } }),
    papers,
    classrooms: classroomDTO,
    assessments: assessments.map((exam) => {
      const classroomIds = exam.classroomIds.filter(
        (id) =>
          allowedClassIds.includes(id) &&
          exam.papers.some((p) => readsSubject(id, p.subject, exam)),
      );
      return { ...exam, classroomIds };
    }),
    templates,
    submissions,
    ...(requested
      ? {
          requestedReview: {
            submission: {
              ...requested,
              createdAt: requested.createdAt.toISOString(),
            } as unknown as ScanSubmission,
            reviews: allReviews.filter((review) => review.submissionId === requested.id),
            reviewHistory: reviewHistoryRows
              .filter((review) => review.submissionId === requested.id)
              .map((review) => ({
                ...review,
                createdAt: review.createdAt.toISOString(),
              })) as Review[],
          },
        }
      : {}),
    reviews: a.role === "STUDENT" ? [] : reviews,
    reviewHistory: reviewHistoryRows
      .filter((row) => activeIds.has(row.submissionId))
      .map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
      })) as Review[],
    analytics,
    ...(a.role === "ADMIN" ? { usersTotal: await db.user.count() } : {}),
    users: users.map((user) => ({
      ...user,
      ...(a.role === "ADMIN" && "teachingAssignments" in user
        ? { teachingAssignments: user.teachingAssignments.map(toTeachingAssignment) }
        : {}),
    })) as PlatformState["users"],
  };
}

export async function loadState(
  actor: Actor,
  db: Db = getDb(),
  options: { questionLimit?: number; reviewing?: boolean; requestedSubmissionId?: string } = {},
): Promise<PlatformState> {
  return projectReviewVisibility(await loadInternalState(actor, db, options));
}
