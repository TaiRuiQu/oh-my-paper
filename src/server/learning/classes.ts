import "server-only";
import type { BatchInput, StudentInput, ClassOverview } from "@/contracts/classes";
import { getDb } from "@/server/db/client";
import { AccessError, RequestError } from "@/server/http/errors";
import { createExamTask, ownedExamTask, taskResult } from "@/server/exams/tasks";
import { gradeTaskResult } from "@/server/grading/tasks";
export async function createBatch(userId: string, data: BatchInput) {
  await ownedClass(userId, data.classroomId);
  const task = await ownedExamTask(userId, data.templateId),
    exam = await taskResult(task);
  if (task.autoGrade || task.batchId || !exam?.questions.length || !task.outputKey)
    throw new RequestError(422, "请选择解析完成的空白题套。");
  if (exam.questions.some((q) => !q.solution?.sufficient))
    throw new RequestError(422, "题套尚有题目未完成解题，请补充标准答案后再创建批次。");
  return getDb().gradeBatch.create({
    data: { ...data, templateOutputKey: task.outputKey },
  });
}
export async function ownedClass(userId: string, id: string) {
  const c = await getDb().classroom.findFirst({
    where: { id, ownerId: userId },
  });
  if (!c) throw new AccessError(404, "班级不存在或无权访问。");
  return c;
}
export async function classOverview(userId: string): Promise<ClassOverview> {
  const classes = await getDb().classroom.findMany({
    where: { ownerId: userId },
    include: {
      students: { orderBy: { number: "asc" } },
      batches: {
        orderBy: { createdAt: "desc" },
        take: 20,
        include: {
          template: { select: { name: true } },
          exams: {
            include: {
              student: true,
              gradeTasks: { orderBy: { createdAt: "desc" }, take: 1 },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  return classes.map((c) => ({
    id: c.id,
    name: c.name,
    students: c.students.map((s) => ({
      id: s.id,
      name: s.name,
      number: s.number,
      linked: Boolean(s.accountId),
    })),
    batches: c.batches.map((b) => ({
      id: b.id,
      name: b.name,
      templateId: b.templateId,
      templateName: b.template?.name ?? null,
      createdAt: b.createdAt.toISOString(),
      exams: b.exams.map((e) => {
        const grade = e.gradeTasks[0],
          result = grade ? gradeTaskResult(grade) : null;
        return {
          id: e.id,
          student: e.student?.name ?? "未关联学生",
          number: e.student?.number ?? "",
          status:
            e.status === "FAILED"
              ? "识别未完成"
              : grade?.status === "COMPLETED"
                ? "批改完成"
                : grade?.status === "FAILED"
                  ? "批改未完成"
                  : e.status === "COMPLETED"
                    ? "等待批改"
                    : "处理中",
          gradeId: grade?.id ?? null,
          score: result?.totals.awardedPoints ?? null,
          maximum: result?.totals.gradedMaxPoints ?? null,
          pending: result?.totals.pendingQuestions ?? null,
        };
      }),
    })),
  }));
}
export async function addStudent(userId: string, data: StudentInput) {
  await ownedClass(userId, data.classroomId);
  const account = data.email
    ? await getDb().user.findUnique({
        where: { email: data.email.toLowerCase() },
      })
    : null;
  if (data.email && !account)
    throw new RequestError(422, "该邮箱尚未注册，请让学生先创建账号，或暂不关联邮箱。");
  if (
    await getDb().studentProfile.findUnique({
      where: {
        classroomId_number: {
          classroomId: data.classroomId,
          number: data.number,
        },
      },
    })
  )
    throw new RequestError(409, "该学号已存在，请核对学生信息。");
  return getDb().studentProfile.create({
    data: {
      classroomId: data.classroomId,
      name: data.name,
      number: data.number,
      accountId: account?.id,
    },
  });
}
export async function batchUpload(
  userId: string,
  batchId: string,
  studentId: string,
  request: Request,
) {
  const batch = await getDb().gradeBatch.findFirst({
    where: { id: batchId, classroom: { ownerId: userId } },
  });
  const student = await getDb().studentProfile.findFirst({
    where: { id: studentId, classroomId: batch?.classroomId },
  });
  if (!batch || !student) throw new AccessError(404, "批次或学生不存在。");
  return createExamTask(request, userId, {
    autoGrade: true,
    batchId,
    studentId,
  });
}
