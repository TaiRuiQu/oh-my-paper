import "server-only";
import { paperRecord, assessmentRecord } from "../records";
import type { Prisma as PrismaTypes } from "@/generated/prisma/client";
import type { PlatformState } from "../types";
import type { Command, CommandContext } from "./types";
import { Prisma } from "@/generated/prisma/client";
import { assertAssets, assertCanReview, canAssess, canUseStudent, json, missing } from "../access";
import { RequestError } from "@/server/http/errors";
export async function executeSubmissionsCommand(
  db: PrismaTypes.TransactionClient,
  a: PlatformState["actor"],
  command: Command,
  context: CommandContext = {},
) {
  switch (command.type) {
    case "submission.save": {
      const { id, alignment, ...data } = command.submission;
      const aiJob =
        context.source === "AI" && context.jobId
          ? await db.aiJob.findUnique({ where: { id: context.jobId } })
          : null;
      const batchInput =
        aiJob?.kind === "BATCH_GRADE"
          ? (aiJob.input as { assessmentId: string; paperId: string; classroomId: string })
          : null;
      const batch =
        !!batchInput &&
        aiJob?.userId === a.id &&
        aiJob.status === "RUNNING" &&
        batchInput.assessmentId === data.assessmentId &&
        batchInput.paperId === data.paperId;
      const rawExam = batch
        ? await db.assessment.findUnique({ where: { id: data.assessmentId } })
        : null;
      const exam = rawExam ? assessmentRecord(rawExam) : await canAssess(db, a, data.assessmentId);
      if (exam.kind === "HOMEWORK" && (data.kind !== "WORKBOOK" || data.templateId))
        throw new RequestError(400, "作业必须以练习册方式录入，不使用答题卡。");
      if (exam.published) throw new RequestError(409, "请先撤回成绩发布，再调整答卷。");
      const config = exam.papers.find((p) => p.paperId === data.paperId);
      if (!config) throw new RequestError(400, "答卷对应试卷不属于这次考试。");
      const student = await db.classroomStudent.findUnique({ where: { id: data.studentId } });
      if (!student || !exam.classroomIds.includes(student.classroomId))
        throw new RequestError(400, "学生不在参试班级。");
      if (batch) {
        if (batchInput!.classroomId !== student.classroomId) throw missing();
        await assertCanReview(db, a, exam, student.classroomId, config.subject);
      } else await canUseStudent(db, a, student.classroomId, config.subject);
      const paper = paperRecord(
        await db.paper.findUniqueOrThrow({
          where: { id: data.paperId },
        }),
      );
      if (data.answers.some((ans) => !paper.items.some((i) => i.id === ans.itemId)))
        throw new RequestError(400, "作答引用了其他试卷题目。");
      if (data.templateId) {
        const t = await db.cardTemplate.findUnique({ where: { id: data.templateId } });
        if (!t || t.paperId !== paper.id) throw new RequestError(400, "答题卡模板不匹配。");
      }
      if (data.kind === "CARD" && !data.templateId)
        throw new RequestError(400, "答题卡扫描必须选择模板。");
      const previous = batch && id ? await db.scanSubmission.findUnique({ where: { id } }) : null;
      const previousAnswers = (previous?.answers ?? []) as unknown as {
        images: string[];
        sourcePage?: string;
      }[];
      const retainedAssets =
        previous?.assessmentId === exam.id &&
        previous.paperId === data.paperId &&
        previous.studentId === student.id
          ? new Set([
              ...previous.sourceFiles,
              ...previousAnswers.flatMap((ans) => [
                ...ans.images,
                ...(ans.sourcePage ? [ans.sourcePage] : []),
              ]),
            ])
          : new Set<string>();
      await assertAssets(
        db,
        a,
        [
          ...data.sourceFiles,
          ...data.answers.flatMap((ans) => [
            ...ans.images,
            ...(ans.sourcePage ? [ans.sourcePage] : []),
          ]),
        ].filter((url) => !retainedAssets.has(url)),
      );
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
