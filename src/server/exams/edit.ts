import "server-only";
import { examEditSchema } from "@/contracts/exams";
import { getDb } from "@/server/db/client";
import { AccessError, RequestError } from "@/server/http/errors";
import { ownedExamTask, taskResult } from "./tasks";

export async function deleteExamTask(userId: string, id: string) {
  const task = await ownedExamTask(userId, id);
  // Retain all source files, questions, answers and execution evidence for review.
  await getDb().examTask.updateMany({
    where: { id: task.id, userId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
}

export async function editExam(userId: string, id: string, input: unknown) {
  const parsed = examEditSchema.safeParse(input);
  if (!parsed.success) throw new RequestError(400, "试卷内容无效，请检查题目和分值。");
  const task = await ownedExamTask(userId, id);
  if (task.deletedAt) throw new AccessError(404, "试卷已删除。");
  const current = await taskResult(task);
  if (!current) throw new RequestError(409, "请等待试卷解析完成后再编辑。");
  const { exam, revision } = parsed.data;
  if (revision !== (current.revision ?? 0))
    throw new RequestError(409, "试卷已被其他页面修改，请重新加载后再编辑。");
  if (
    exam.sections.length !== current.sections.length ||
    exam.sections.some((section, index) => {
      const original = current.sections[index];
      return (
        section.number !== original.number ||
        section.questions.length !== original.questions.length ||
        section.questions.some((question, position) => {
          const before = original.questions[position];
          return (
            question.number !== before.number ||
            JSON.stringify(question.materials) !== JSON.stringify(before.materials) ||
            question.subquestions.length !== before.subquestions.length ||
            question.subquestions.some(
              (part, partIndex) =>
                part.number !== before.subquestions[partIndex].number ||
                JSON.stringify(part.materials) !==
                  JSON.stringify(before.subquestions[partIndex].materials),
            )
          );
        })
      );
    })
  )
    throw new RequestError(400, "编辑时请保留题号、题目顺序和原有配图。");

  await getDb().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM exams WHERE id = ${current.id} FOR UPDATE`;
    const source = await tx.examTask.findFirst({ where: { id, userId, deletedAt: null } });
    if (!source) throw new AccessError(404, "试卷已删除。");
    const active = { in: ["QUEUED", "RUNNING"] as ("QUEUED" | "RUNNING")[] };
    if (
      (await tx.examAgentTask.count({ where: { examId: current.id, status: active } })) ||
      (await tx.gradingWorkflow.count({ where: { sourceId: id, status: active } })) ||
      (await tx.answerCardTemplate.count({ where: { sourceId: id, status: active } })) ||
      (await tx.answerCardBatch.count({ where: { template: { sourceId: id }, status: active } }))
    )
      throw new RequestError(409, "这份试卷正在生成答案或批改，请等待任务结束后再保存。");
    const updated = await tx.exam.updateMany({
      where: { id: current.id, userId, revision },
      data: {
        name: exam.name,
        totalScore: exam.totalScore,
        ...(exam.layout ? { layout: exam.layout } : {}),
        revision: { increment: 1 },
      },
    });
    if (!updated.count) throw new RequestError(409, "试卷已被其他页面修改，请重新加载后再编辑。");
    for (const [index, section] of exam.sections.entries()) {
      const original = current.sections[index];
      await tx.examSection.update({
        where: { id: original.id },
        data: { title: section.title, description: section.description, score: section.score },
      });
      for (const [position, question] of section.questions.entries())
        await tx.examQuestion.update({
          where: { id: original.questions[position].id },
          data: {
            description: question.description,
            score: question.score,
            subquestions: question.subquestions,
          },
        });
    }
    // Old agent results and graded submissions remain in the audit history.
    await tx.examAnswer.deleteMany({ where: { examId: current.id } });
    await tx.examTask.update({ where: { id }, data: { name: exam.name } });
  });
  return taskResult({ ...task, name: exam.name });
}
