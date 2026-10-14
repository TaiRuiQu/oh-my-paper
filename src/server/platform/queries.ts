import "server-only";
import { getDb } from "@/server/db/client";
import { getActor, type Db } from "./access";
import { defaultCardPresets } from "./cards";
import { buildAnalytics, mergeKnowledgeStats } from "./analytics";
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
  options: { questionLimit?: number } = {},
): Promise<PlatformState> {
  const a = await getActor(actor.id, db);
  const classes = await db.classroom.findMany({
    where:
      a.role === "ADMIN"
        ? {}
        : a.role === "STUDENT"
          ? { students: { some: { userId: a.id } } }
          : { OR: [{ ownerId: a.id }, { reviewerIds: { has: a.id } }] },
    include: { students: true },
    orderBy: { name: "asc" },
  });
  const allowedClassIds = classes.map((c) => c.id);
  const ownStudentIds = classes.flatMap((c) =>
    c.students.filter((s) => s.userId === a.id).map((s) => s.id),
  );
  const assessmentRows = await db.assessment.findMany({
    where:
      a.role === "ADMIN"
        ? {}
        : a.role === "STUDENT"
          ? { published: true, studentIds: { hasSome: ownStudentIds } }
          : { OR: [{ ownerId: a.id }, { classroomIds: { hasSome: allowedClassIds } }] },
    include: { papers: true },
    orderBy: { createdAt: "desc" },
  });
  const assessments = assessmentRows.map((row) => ({
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
  const paperIds = assessments.flatMap((a) => a.papers.map((p) => p.paperId));
  const paperRows = await db.paper.findMany({
    where:
      a.role === "ADMIN"
        ? {}
        : a.role === "STUDENT"
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
    take: options.questionLimit,
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
  const classroomDTO = classes.map((c) => ({
    ...c,
    students: a.role === "STUDENT" ? c.students.filter((s) => s.userId === a.id) : c.students,
  })) as Classroom[];
  const studentIds = classroomDTO.flatMap((c) => c.students.map((s) => s.id));
  const submissionRows = await db.scanSubmission.findMany({
    where: {
      assessmentId: { in: assessments.map((a) => a.id) },
      ...(a.role !== "ADMIN" ? { studentId: { in: studentIds } } : {}),
    },
    orderBy: { createdAt: "desc" },
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
          where: { role: { in: ["ADMIN", "TEACHER", "STUDENT"] } },
          select: { id: true, name: true, email: true, username: true, role: true },
          orderBy: { name: "asc" },
        });
  // Compute ranks over complete class rosters before filtering individual student visibility.
  let analytics = buildAnalytics({
    questions,
    papers,
    classrooms: classes as Classroom[],
    assessments,
    submissions,
    reviews,
  });
  if (a.role !== "ADMIN") {
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
    analytics = buildAnalytics({
      questions,
      papers,
      classrooms: allClasses as Classroom[],
      assessments,
      submissions: allSubs.map((s) => ({
        ...s,
        createdAt: s.createdAt.toISOString(),
      })) as unknown as ScanSubmission[],
      reviews: allReviews.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })) as Review[],
    });
    analytics.results = analytics.results.filter((r) => studentIds.includes(r.studentId));
    analytics.students = analytics.students.filter((r) => studentIds.includes(r.studentId));
    analytics.classrooms =
      a.role === "STUDENT"
        ? []
        : analytics.classrooms.filter((c) => allowedClassIds.includes(c.id));
    analytics.knowledge = mergeKnowledgeStats(analytics.students.flatMap((s) => s.knowledge));
  }
  return {
    actor: a,
    questions: a.role === "STUDENT" ? [] : questions,
    questionCount:
      a.role === "STUDENT"
        ? 0
        : await db.question.count({ where: a.role === "ADMIN" ? {} : { ownerId: a.id } }),
    papers,
    classrooms: classroomDTO,
    assessments:
      a.role === "STUDENT"
        ? assessments.map((exam) => ({
            ...exam,
            studentIds: exam.studentIds?.filter((id) => ownStudentIds.includes(id)),
            classroomIds: exam.classroomIds.filter((id) => allowedClassIds.includes(id)),
          }))
        : assessments,
    templates,
    submissions,
    reviews: a.role === "STUDENT" ? [] : reviews,
    reviewHistory: reviewHistoryRows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    })) as Review[],
    analytics,
    users: users as PlatformState["users"],
  };
}
