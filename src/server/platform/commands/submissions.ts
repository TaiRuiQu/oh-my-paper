import "server-only";
import type { Prisma as PrismaTypes } from "@/generated/prisma/client";
import type { PlatformState } from "../types";
import type { Command } from "./types";
import { Prisma } from "@/generated/prisma/client";
import { assertAssets, canAssess, canUseStudent, json, missing } from "../access";
import { RequestError } from "@/server/http/errors";
export async function executeSubmissionsCommand(
  db: PrismaTypes.TransactionClient,
  a: PlatformState["actor"],
  command: Command,
) {
  switch (command.type) {
    case "submission.save": {
      const { id, alignment, ...data } = command.submission;
      const exam = await canAssess(db, a, data.assessmentId);
      if (exam.kind === "HOMEWORK" && (data.kind !== "WORKBOOK" || data.templateId))
        throw new RequestError(400, "作业必须以练习册方式录入，不使用答题卡。");
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
  }
}
