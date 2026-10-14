import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { AccessError, RequestError } from "@/server/http/errors";
import { commandSchema } from "./schemas";
import { defaultCardPresets, validateCardTemplate } from "./cards";
import { buildAnalytics, finalGrades, mergeKnowledgeStats } from "./analytics";
import type {
  Actor,
  Assessment,
  BankQuestion,
  CardTemplate,
  Classroom,
  Paper,
  PlatformState,
  Review,
  Role,
  ScanSubmission,
} from "./types";
type Db = PrismaClient | Prisma.TransactionClient;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const missing = () => new AccessError(404, "记录不存在或无权访问。");
export async function getActor(userId: string, db: Db = getDb()): Promise<PlatformState["actor"]> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, role: true },
  });
  if (!user) throw new AccessError(401, "请先登录。");
  if (!["ADMIN", "TEACHER", "STUDENT"].includes(user.role))
    throw new AccessError(403, "账号角色无效，请联系管理员。");
  return { ...user, role: user.role as Role };
}
const teacher = (a: PlatformState["actor"]) => {
  if (a.role === "STUDENT") throw new AccessError(403, "需要教师权限。");
};
function owner(a: PlatformState["actor"], record: { ownerId: string } | null) {
  if (!record || (a.role !== "ADMIN" && record.ownerId !== a.id)) throw missing();
  return record;
}
export async function loadState(actor: Actor, db: Db = getDb()): Promise<PlatformState> {
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
    where:
      a.role === "ADMIN"
        ? {}
        : a.role === "STUDENT"
          ? { ownerId: { in: assessmentRows.map((a) => a.ownerId) } }
          : { ownerId: a.id },
    orderBy: { updatedAt: "desc" },
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
          select: { id: true, name: true, email: true, role: true },
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
    analytics,
    users: users as PlatformState["users"],
  };
}
async function canAssess(db: Db, a: PlatformState["actor"], id: string) {
  const assessment = await db.assessment.findUnique({ where: { id }, include: { papers: true } });
  if (!assessment) throw missing();
  if (a.role === "ADMIN" || assessment.ownerId === a.id) return assessment;
  const classes = await db.classroom.count({
    where: {
      id: { in: assessment.classroomIds },
      OR: [{ ownerId: a.id }, { reviewerIds: { has: a.id } }],
    },
  });
  if (!classes) throw missing();
  return assessment;
}
async function canUseStudent(db: Db, a: PlatformState["actor"], classroomId: string) {
  if (a.role === "ADMIN") return;
  const classroom = await db.classroom.findUnique({ where: { id: classroomId } });
  if (!classroom || (classroom.ownerId !== a.id && !classroom.reviewerIds.includes(a.id)))
    throw missing();
}
async function assertAssets(db: Db, a: PlatformState["actor"], urls: string[]) {
  for (const url of [...new Set(urls)]) {
    const match = /^\/api\/platform\/assets\/([\w-]+)$/.exec(url);
    if (!match) throw new RequestError(400, "图片和扫描件必须先上传到本站。");
    const asset = await db.platformAsset.findUnique({ where: { id: match[1] } });
    if (!asset || (a.role !== "ADMIN" && asset.ownerId !== a.id)) throw missing();
  }
}
export type CommandContext = {
  db?: Prisma.TransactionClient;
  source?: "HUMAN" | "AI";
  jobId?: string;
};
export async function executeCommand(
  actor: Actor,
  input: unknown,
  context: CommandContext = {},
): Promise<{ id: string }> {
  const parsed = commandSchema.safeParse(input);
  if (!parsed.success)
    throw new RequestError(400, parsed.error.issues.map((i) => i.message).join(" "));
  const command = parsed.data;
  const execute = async (db: Prisma.TransactionClient) => {
    const a = await getActor(actor.id, db);
    teacher(a);
    if (context.source === "AI") {
      if (!context.jobId) throw new RequestError(400, "AI评阅缺少任务来源。");
      const job = await db.aiJob.findUnique({ where: { id: context.jobId } });
      if (!job || job.userId !== a.id || job.status !== "RUNNING")
        throw new AccessError(403, "AI任务不属于当前账号或已结束。");
    }
    // Serialize domain writes globally: cross-account double reviews and publishing share one snapshot.
    await db.$queryRaw`SELECT pg_advisory_xact_lock(7240132026::bigint)::text`;
    switch (command.type) {
      case "question.save": {
        const { id, ...data } = command.question;
        if (id) owner(a, await db.question.findUnique({ where: { id } }));
        await assertAssets(db, a, data.content.images);
        const q = id
          ? await db.question.update({
              where: { id },
              data: { ...data, content: json(data.content) },
            })
          : await db.question.create({
              data: { ...data, ownerId: a.id, content: json(data.content) },
            });
        return { id: q.id };
      }
      case "question.delete": {
        owner(a, await db.question.findUnique({ where: { id: command.id } }));
        await db.question.delete({ where: { id: command.id } });
        return { id: command.id };
      }
      case "paper.save": {
        const { id, items, ...data } = command.paper;
        if (id) {
          owner(a, await db.paper.findUnique({ where: { id } }));
          if (await db.assessmentPaper.count({ where: { paperId: id } }))
            throw new RequestError(409, "试卷已用于考试或作业，请另存新卷以保留原始成绩依据。");
        }
        const rows = await db.question.findMany({
          where: {
            id: { in: items.map((i) => i.questionId) },
            ...(a.role === "ADMIN" ? {} : { ownerId: a.id }),
          },
        });
        if (rows.length !== items.length) throw missing();
        if (rows.some((q) => q.subject !== data.subject))
          throw new RequestError(400, "题目学科必须与试卷学科一致。");
        const nested = items.map((item, position) => {
          const q = rows.find((q) => q.id === item.questionId)!;
          return {
            ...item,
            position,
            snapshot: json({
              ...q,
              createdAt: q.createdAt.toISOString(),
              updatedAt: q.updatedAt.toISOString(),
            }),
          };
        });
        if (id) {
          await db.paperItem.deleteMany({ where: { paperId: id } });
          await db.cardTemplate.deleteMany({ where: { paperId: id } });
          const p = await db.paper.update({
            where: { id },
            data: { ...data, layout: json(data.layout), items: { create: nested } },
          });
          return { id: p.id };
        }
        const p = await db.paper.create({
          data: { ...data, ownerId: a.id, layout: json(data.layout), items: { create: nested } },
        });
        return { id: p.id };
      }
      case "paper.delete": {
        owner(a, await db.paper.findUnique({ where: { id: command.id } }));
        if (await db.assessmentPaper.count({ where: { paperId: command.id } }))
          throw new RequestError(409, "已布置的试卷不能删除。");
        await db.paper.delete({ where: { id: command.id } });
        return { id: command.id };
      }
      case "classroom.save": {
        const { id, reviewerIds = [], ...data } = command.classroom;
        if (id) owner(a, await db.classroom.findUnique({ where: { id } }));
        if (
          new Set(reviewerIds).size !== reviewerIds.length ||
          (await db.user.count({
            where: { id: { in: reviewerIds }, role: { in: ["ADMIN", "TEACHER"] } },
          })) !== reviewerIds.length
        )
          throw new RequestError(400, "评阅教师账号无效。");
        const c = id
          ? await db.classroom.update({ where: { id }, data: { ...data, reviewerIds } })
          : await db.classroom.create({ data: { ...data, reviewerIds, ownerId: a.id } });
        return { id: c.id };
      }
      case "student.save": {
        const { id, email, userId, ...data } = command.student;
        owner(a, await db.classroom.findUnique({ where: { id: data.classroomId } }));
        const previous = id ? await db.classroomStudent.findUnique({ where: { id } }) : null;
        if (id && (!previous || previous.classroomId !== data.classroomId)) throw missing();
        let binding = userId;
        if (email) {
          const account = await db.user.findUnique({ where: { email } });
          if (!account || account.role !== "STUDENT")
            throw new RequestError(400, "邮箱必须对应已注册的学生账号。");
          binding = account.id;
        }
        if (binding) {
          const account = await db.user.findUnique({ where: { id: binding } });
          if (!account || account.role !== "STUDENT")
            throw new RequestError(400, "只能绑定学生账号。");
        }
        if (previous) {
          const hasHistory =
            (await db.scanSubmission.count({ where: { studentId: previous.id } })) > 0 ||
            (await db.assessment.count({ where: { studentIds: { has: previous.id } } })) > 0;
          if (hasHistory) {
            const unchangedIdentity =
              previous.name === data.name &&
              previous.studentNumber === data.studentNumber &&
              previous.classroomId === data.classroomId;
            const unchangedBinding = binding === undefined || binding === previous.userId;
            const firstBinding = previous.userId === null && !!binding;
            if (!unchangedIdentity || (!unchangedBinding && !firstBinding))
              throw new RequestError(
                409,
                "已参与考试的学生身份不能更改；尚未绑定账号的学生可补绑定本人账号。",
              );
          }
        }
        if (
          await db.classroomStudent.findFirst({
            where: {
              classroomId: data.classroomId,
              OR: [
                { studentNumber: data.studentNumber },
                ...(binding ? [{ userId: binding }] : []),
              ],
              ...(id ? { id: { not: id } } : {}),
            },
          })
        )
          throw new RequestError(409, "该班级已有相同卡号或账号。");
        const s = id
          ? await db.classroomStudent.update({
              where: { id },
              data: { ...data, ...(binding !== undefined ? { userId: binding } : {}) },
            })
          : await db.classroomStudent.create({ data: { ...data, userId: binding ?? null } });
        return { id: s.id };
      }
      case "student.delete": {
        const s = await db.classroomStudent.findUnique({ where: { id: command.id } });
        if (!s) throw missing();
        owner(a, await db.classroom.findUnique({ where: { id: s.classroomId } }));
        if (await db.assessment.count({ where: { studentIds: { has: s.id } } }))
          throw new RequestError(409, "已列入考试名单的学生不能删除。");
        if (await db.scanSubmission.count({ where: { studentId: s.id } }))
          throw new RequestError(409, "已有答卷的学生不能删除。");
        await db.classroomStudent.delete({ where: { id: s.id } });
        return { id: s.id };
      }
      case "assessment.save": {
        const { id, papers, ...data } = command.assessment;
        if (id) {
          owner(a, await db.assessment.findUnique({ where: { id } }));
          if (await db.scanSubmission.count({ where: { assessmentId: id } }))
            throw new RequestError(409, "已有答卷的考试不能调整班级或科目。");
        }
        if (
          (await db.classroom.count({
            where: {
              id: { in: data.classroomIds },
              ...(a.role === "ADMIN" ? {} : { ownerId: a.id }),
            },
          })) !== data.classroomIds.length
        )
          throw missing();
        const paperRows = await db.paper.findMany({
          where: {
            id: { in: papers.map((p) => p.paperId) },
            ...(a.role === "ADMIN" ? {} : { ownerId: a.id }),
          },
        });
        if (paperRows.length !== papers.length) throw missing();
        if (
          papers.some(
            (p) =>
              paperRows.find((row) => row.id === p.paperId)?.subject !== p.subject ||
              paperRows.find((row) => row.id === p.paperId)?.kind !== data.kind,
          )
        )
          throw new RequestError(400, "考试科目和用途必须与试卷一致。");
        const enrolled = await db.classroomStudent.findMany({
          where: { classroomId: { in: data.classroomIds } },
          select: { id: true },
        });
        if (!enrolled.length) throw new RequestError(400, "请先录入参试学生。");
        const studentIds = enrolled.map((s) => s.id);
        const create = papers.map((p) => ({ ...p, conversion: json(p.conversion) }));
        if (id) {
          await db.assessmentPaper.deleteMany({ where: { assessmentId: id } });
          await db.assessment.update({
            where: { id },
            data: { ...data, studentIds, published: false, papers: { create } },
          });
          return { id };
        }
        const exam = await db.assessment.create({
          data: { ...data, studentIds, ownerId: a.id, papers: { create } },
        });
        return { id: exam.id };
      }
      case "assessment.publish": {
        const exam = await db.assessment.findUnique({ where: { id: command.id } });
        owner(a, exam);
        if (command.published) {
          const state = await loadState(a, db);
          const target = state.assessments.find((e) => e.id === command.id)!;
          const rosters = state.classrooms
            .filter((c) => target.classroomIds.includes(c.id))
            .flatMap((c) => c.students)
            .filter((s) => !target.studentIds || target.studentIds.includes(s.id));
          const result = state.analytics.results.filter((r) => r.assessmentId === target.id);
          if (
            !rosters.length ||
            result.length !== rosters.length ||
            result.some((r) => r.total === null)
          )
            throw new RequestError(409, "所有参试学生的每科评阅完成后才能发布成绩。");
        }
        await db.assessment.update({
          where: { id: command.id },
          data: { published: command.published },
        });
        return { id: command.id };
      }
      case "template.save": {
        const { id, layout, ...data } = command.template;
        const paper = await db.paper.findUnique({
          where: { id: data.paperId },
          include: { items: true },
        });
        owner(a, paper);
        if (!paper) throw missing();
        if (id) {
          const previous = await db.cardTemplate.findUnique({ where: { id } });
          if (!previous || previous.preset || !previous.ownerId) throw missing();
          owner(a, { ownerId: previous.ownerId });
          if (await db.scanSubmission.count({ where: { templateId: id } }))
            throw new RequestError(409, "已扫描使用的模板不能更改，请另存。");
        }
        if (data.subject !== paper.subject) throw new RequestError(400, "模板学科与试卷不一致。");
        if (
          layout.regions.some((r) => !paper.items.some((i) => i.id === r.itemId)) ||
          paper.items.some((i) => !layout.regions.some((r) => r.itemId === i.id))
        )
          throw new RequestError(400, "模板必须完整覆盖当前试卷题目。");
        try {
          validateCardTemplate({ id: id ?? "new", ownerId: a.id, preset: false, ...data, layout }, {
            ...paper,
            createdAt: paper.createdAt.toISOString(),
            updatedAt: paper.updatedAt.toISOString(),
          } as unknown as Paper);
        } catch (error) {
          throw new RequestError(400, error instanceof Error ? error.message : "答题卡布局无效。");
        }
        await assertAssets(
          db,
          a,
          layout.regions.flatMap((r) => (r.image ? [r.image] : [])),
        );
        const t = id
          ? await db.cardTemplate.update({
              where: { id },
              data: { ...data, layout: json(layout) },
            })
          : await db.cardTemplate.create({
              data: { ...data, ownerId: a.id, preset: false, layout: json(layout) },
            });
        return { id: t.id };
      }
      case "template.delete": {
        const t = await db.cardTemplate.findUnique({ where: { id: command.id } });
        if (!t || t.preset || !t.ownerId) throw missing();
        owner(a, { ownerId: t.ownerId });
        if (await db.scanSubmission.count({ where: { templateId: t.id } }))
          throw new RequestError(409, "已使用的模板不能删除。");
        await db.cardTemplate.delete({ where: { id: t.id } });
        return { id: t.id };
      }
      case "submission.save": {
        const { id, alignment, ...data } = command.submission;
        const exam = await canAssess(db, a, data.assessmentId);
        if (exam.published) throw new RequestError(409, "请先撤回成绩发布，再调整答卷。");
        const config = exam.papers.find((p) => p.paperId === data.paperId);
        if (!config) throw new RequestError(400, "答卷对应试卷不属于这次考试。");
        const student = await db.classroomStudent.findUnique({ where: { id: data.studentId } });
        if (
          !student ||
          !exam.classroomIds.includes(student.classroomId) ||
          !exam.studentIds.includes(student.id)
        )
          throw new RequestError(400, "学生不在参试班级。");
        await canUseStudent(db, a, student.classroomId);
        const paper = await db.paper.findUniqueOrThrow({
          where: { id: data.paperId },
          include: { items: true },
        });
        if (data.answers.some((ans) => !paper.items.some((i) => i.id === ans.itemId)))
          throw new RequestError(400, "作答引用了其他试卷题目。");
        if (data.templateId) {
          const t = await db.cardTemplate.findUnique({ where: { id: data.templateId } });
          if (!t || t.paperId !== paper.id) throw new RequestError(400, "答题卡模板不匹配。");
        }
        if (data.kind === "CARD" && !data.templateId)
          throw new RequestError(400, "答题卡扫描必须选择模板。");
        await assertAssets(db, a, [
          ...data.sourceFiles,
          ...data.answers.flatMap((ans) => [
            ...ans.images,
            ...(ans.sourcePage ? [ans.sourcePage] : []),
          ]),
        ]);
        if (id) {
          const s = await db.scanSubmission.findUnique({ where: { id } });
          if (
            !s ||
            s.assessmentId !== exam.id ||
            s.paperId !== paper.id ||
            s.studentId !== student.id
          )
            throw missing();
          if (await db.review.count({ where: { submissionId: id } }))
            throw new RequestError(409, "已评阅的答卷不能替换。");
        } else if (
          await db.scanSubmission.findUnique({
            where: {
              assessmentId_paperId_studentId: {
                assessmentId: exam.id,
                paperId: paper.id,
                studentId: student.id,
              },
            },
          })
        )
          throw new RequestError(409, "该学生这科已有答卷，请编辑原答卷。");
        const save = {
          ...data,
          templateId: data.templateId ?? null,
          answers: json(data.answers),
          alignment: alignment ? json(alignment) : Prisma.DbNull,
          status: "PENDING",
        };
        const s = id
          ? await db.scanSubmission.update({ where: { id }, data: save })
          : await db.scanSubmission.create({ data: { ...save, ownerId: a.id } });
        return { id: s.id };
      }
      case "review.save": {
        const r = command.review;
        if (context.source === "AI" && r.round !== "FIRST")
          throw new RequestError(400, "AI只允许第一评，第二评与仲裁必须人工完成。");
        const s = await db.scanSubmission.findUnique({ where: { id: r.submissionId } });
        if (!s) throw missing();
        const exam = await canAssess(db, a, s.assessmentId);
        const student = await db.classroomStudent.findUniqueOrThrow({
          where: { id: s.studentId },
        });
        await canUseStudent(db, a, student.classroomId);
        if (exam.published) throw new RequestError(409, "已发布成绩的考试不能重新评阅。");
        const config = exam.papers.find((p) => p.paperId === s.paperId)!;
        const paper = await db.paper.findUniqueOrThrow({
          where: { id: s.paperId },
          include: { items: true },
        });
        const item = paper.items.find((i) => i.id === r.itemId);
        if (!item || r.score > item.score)
          throw new RequestError(400, "评分必须在题目分值范围内。");
        const snapshot = item.snapshot as unknown as BankQuestion;
        const partScores = r.partScores ?? [];
        if (snapshot.type === "MIXED") {
          const parts = snapshot.content.parts,
            weights = parts.reduce((n, part) => n + part.score, 0);
          if (
            !weights ||
            partScores.length !== parts.length ||
            new Set(partScores.map((p) => p.partId)).size !== parts.length ||
            parts.some((part) => !partScores.some((p) => p.partId === part.id))
          )
            throw new RequestError(400, "混合题必须完整记录每个小问的得分。");
          if (
            partScores.some(
              (p) =>
                p.score >
                (item.score * parts.find((part) => part.id === p.partId)!.score) / weights +
                  0.000001,
            ) ||
            Math.abs(partScores.reduce((n, p) => n + p.score, 0) - r.score) > 0.000001
          )
            throw new RequestError(400, "小问分数必须符合权重上限，且合计等于题目得分。");
        } else if (partScores.length) throw new RequestError(400, "只有混合题可以填写小问分数。");
        const rows = await db.review.findMany({
          where: { submissionId: s.id, itemId: r.itemId },
        });
        const previous = rows.find((row) => row.round === r.round),
          first = rows.find((row) => row.round === "FIRST"),
          second = rows.find((row) => row.round === "SECOND");
        if (previous && previous.reviewerId !== a.id)
          throw new AccessError(403, "不能覆盖其他评阅者的评分。");
        if (r.round !== "FIRST" && config.gradingMode !== "DOUBLE")
          throw new RequestError(400, "单评模式无需第二评或仲裁。");
        if (r.round === "SECOND" && (!first || first.reviewerId === a.id))
          throw new RequestError(409, "第二评必须由不同教师在第一评完成后进行。");
        if (
          r.round === "ARBITRATION" &&
          (!first ||
            !second ||
            [first.reviewerId, second.reviewerId].includes(a.id) ||
            Math.abs(first.score - second.score) <= config.arbitrationThreshold)
        )
          throw new RequestError(409, "仲裁需要分差超阈值，且由第三位教师完成。");
        if (
          (r.round === "FIRST" && second) ||
          (r.round === "SECOND" && rows.some((row) => row.round === "ARBITRATION"))
        )
          throw new RequestError(409, "后续评阅已完成，不能改动前一评。");
        const review = await db.review.upsert({
          where: {
            submissionId_itemId_round: { submissionId: s.id, itemId: r.itemId, round: r.round },
          },
          create: {
            ...r,
            partScores: json(partScores),
            reviewerId: a.id,
            source: context.source ?? "HUMAN",
            aiJobId: context.source === "AI" ? context.jobId : null,
          },
          update: {
            score: r.score,
            feedback: r.feedback,
            partScores: json(partScores),
            source: context.source ?? "HUMAN",
            aiJobId: context.source === "AI" ? context.jobId : null,
          },
        });
        const all = await db.review.findMany({ where: { submissionId: s.id } });
        const grades = finalGrades(
          {
            ...paper,
            createdAt: paper.createdAt.toISOString(),
            updatedAt: paper.updatedAt.toISOString(),
          } as unknown as Paper,
          { ...config, conversion: config.conversion } as unknown as Assessment["papers"][number],
          { ...s, createdAt: s.createdAt.toISOString() } as unknown as ScanSubmission,
          all.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })) as Review[],
        );
        await db.scanSubmission.update({
          where: { id: s.id },
          data: { status: grades.every((g) => g.status === "FINAL") ? "GRADED" : "REVIEW" },
        });
        return { id: review.id };
      }
    }
  };
  return context.db ? execute(context.db) : getDb().$transaction(execute, { timeout: 20000 });
}
