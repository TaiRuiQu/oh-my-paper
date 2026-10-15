import "server-only";
import { getDb } from "@/server/db/client";
import { AccessError } from "@/server/http/errors";
import { getActor, toTeachingAssignment, visibleClassrooms, type Db } from "./access";
import { canReadSubject, canReviewSubject } from "@/contracts/permissions";
import { defaultCardPresets } from "./cards";
import { applyOfficialResults, buildAnalytics } from "./analytics";
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
export async function loadState(
  actor: Actor,
  db: Db = getDb(),
  options: { questionLimit?: number; reviewing?: boolean } = {},
): Promise<PlatformState> {
  const a = await getActor(actor.id, db);
  if (options.reviewing && a.role === "STUDENT") throw new AccessError(403, "需要教师权限。");
  const classes = await db.classroom.findMany({
    where: options.reviewing ? {} : visibleClassrooms(a),
    include: { students: true },
    orderBy: { name: "asc" },
  });
  const allowedClassIds = classes.map((c) => c.id);
  const ownStudentIds = classes.flatMap((c) =>
    c.students.filter((s) => s.userId === a.id).map((s) => s.id),
  );
  const assessmentRows = await db.assessment.findMany({
    where:
      a.role === "ADMIN" || options.reviewing
        ? {}
        : a.role === "STUDENT"
          ? { published: true, studentIds: { hasSome: ownStudentIds } }
          : { classroomIds: { hasSome: allowedClassIds } },
    include: { papers: true },
    orderBy: { createdAt: "desc" },
  });
  const fullAssessments = assessmentRows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    papers: row.papers.map((p) => ({
      paperId: p.paperId,
      subject: p.subject,
      gradingMode: p.gradingMode,
      arbitrationThreshold: p.arbitrationThreshold,
      conversion: p.conversion,
      questionRules: p.questionRules,
    })),
  })) as Assessment[];
  const readsSubject = (classroomId: string, subject: string, assessment?: Assessment) => {
    const classroom = classes.find((c) => c.id === classroomId);
    if (options.reviewing)
      return (
        !!classroom && !!assessment && canReviewSubject(a, assessment, classroom, subject, classes)
      );
    return !!classroom && (a.role === "STUDENT" || canReadSubject(a, classroom, subject));
  };
  const assessments = fullAssessments
    .map((row) => ({
      ...row,
      papers: row.papers.filter((p) =>
        classes.some((c) => row.classroomIds.includes(c.id) && readsSubject(c.id, p.subject, row)),
      ),
    }))
    .filter((row) => row.papers.length);
  const paperIds = assessments.flatMap((a) => a.papers.map((p) => p.paperId));
  const paperRows = await db.paper.findMany({
    where:
      a.role === "ADMIN"
        ? {}
        : a.role === "STUDENT" || options.reviewing
          ? { id: { in: paperIds } }
          : { OR: [{ ownerId: a.id }, { id: { in: paperIds } }] },
    include: { items: { orderBy: { position: "asc" } } },
    orderBy: { updatedAt: "desc" },
  });
  const papers = paperRows.map((p) => ({
    ...p,
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
      students:
        a.role === "STUDENT"
          ? c.students.filter((s) => s.userId === a.id)
          : options.reviewing
            ? c.students.filter((s) =>
                assessments.some(
                  (exam) =>
                    exam.studentIds?.includes(s.id) &&
                    exam.papers.some((p) => readsSubject(c.id, p.subject, exam)),
                ),
              )
            : c.students,
    })) as Classroom[];
  const studentIds = classroomDTO.flatMap((c) => c.students.map((s) => s.id));
  const candidateSubmissions = await db.scanSubmission.findMany({
    where: {
      assessmentId: { in: assessments.map((a) => a.id) },
      ...(a.role !== "ADMIN" ? { studentId: { in: studentIds } } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  const submissionRows = candidateSubmissions.filter((row) => {
    const classroom = classes.find((c) =>
      c.students.some((student) => student.id === row.studentId),
    );
    const exam = assessments.find((exam) => exam.id === row.assessmentId);
    const paper = exam?.papers.find((paper) => paper.paperId === row.paperId);
    return !!classroom && !!paper && readsSubject(classroom.id, paper.subject, exam);
  });
  const submissions = submissionRows.map((s) => ({
    ...s,
    createdAt: s.createdAt.toISOString(),
  })) as unknown as ScanSubmission[];
  const reviewRows = await db.review.findMany({
    where: { submissionId: { in: submissions.map((s) => s.id) } },
    orderBy: { createdAt: "asc" },
  });
  const reviews = reviewRows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
  })) as Review[];
  const reviewHistoryRows =
    a.role === "STUDENT"
      ? []
      : await db.reviewEvent.findMany({
          where: { submissionId: { in: submissions.map((s) => s.id) } },
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
  const users =
    a.role === "STUDENT"
      ? []
      : await db.user.findMany({
          where: options.reviewing
            ? { role: { in: ["ADMIN", "TEACHER"] } }
            : a.role === "ADMIN"
              ? { role: { in: ["ADMIN", "TEACHER", "STUDENT"] } }
              : {
                  OR: [
                    { role: { in: ["ADMIN", "TEACHER"] } },
                    {
                      studentRecords: {
                        some: { classroomId: { in: classroomDTO.map((c) => c.id) } },
                      },
                    },
                  ],
                },
          select: {
            id: true,
            name: true,
            email: true,
            username: true,
            role: true,
            ...(a.role === "ADMIN" ? { teachingAssignments: true } : {}),
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
      where: { assessmentId: { in: assessments.map((x) => x.id) } },
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
      const enrolled = new Set(
        classroomDTO
          .filter((c) => classroomIds.includes(c.id))
          .flatMap((c) => c.students.map((s) => s.id)),
      );
      return {
        ...exam,
        classroomIds,
        studentIds: exam.studentIds?.filter((id) => enrolled.has(id)),
      };
    }),
    templates,
    submissions,
    reviews: a.role === "STUDENT" ? [] : reviews,
    reviewHistory: reviewHistoryRows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    })) as Review[],
    analytics,
    users: users.map((user) => ({
      ...user,
      ...(a.role === "ADMIN" && "teachingAssignments" in user
        ? { teachingAssignments: user.teachingAssignments.map(toTeachingAssignment) }
        : {}),
    })) as PlatformState["users"],
  };
}
