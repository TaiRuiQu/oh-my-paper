import "server-only";
import type { Prisma as PrismaTypes } from "@/generated/prisma/client";
import type { PlatformState } from "../types";
import type { Command } from "./types";
import { json, missing, owner, visibleClassrooms } from "../access";
import { canReadSubject } from "@/contracts/permissions";
import { loadState } from "../queries";
import { RequestError } from "@/server/http/errors";
export async function executeAssessmentsCommand(
  db: PrismaTypes.TransactionClient,
  a: PlatformState["actor"],
  command: Command,
) {
  switch (command.type) {
    case "assessment.rename": {
      owner(a, await db.assessment.findUnique({ where: { id: command.id } }));
      await db.assessment.update({ where: { id: command.id }, data: { name: command.name } });
      return { id: command.id };
    }
    case "assessment.save": {
      const { id, papers, ...data } = command.assessment;
      if (id) {
        owner(a, await db.assessment.findUnique({ where: { id } }));
        if (await db.scanSubmission.count({ where: { assessmentId: id } }))
          throw new RequestError(409, "已有答卷的考试不能调整班级或科目。");
      }
      const classrooms = await db.classroom.findMany({
        where: { AND: [{ id: { in: data.classroomIds } }, visibleClassrooms(a)] },
      });
      if (
        classrooms.length !== data.classroomIds.length ||
        classrooms.some((c) => papers.some((p) => !canReadSubject(a, c, p.subject)))
      )
        throw missing();
      if (data.reviewScope === "GRADE" && new Set(classrooms.map((c) => c.grade)).size !== 1)
        throw new RequestError(400, "年级联考的参与班级必须属于同一年级。");
      const paperRows = await db.paper.findMany({
        include: { items: true },
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
      for (const config of papers) {
        const paper = paperRows.find((row) => row.id === config.paperId)!;
        if (!paper.items.length) throw new RequestError(400, "请先为试卷添加题目。");
        if (
          Object.keys(config.questionRules ?? {}).some(
            (id) => !paper.items.some((item) => item.id === id),
          )
        )
          throw new RequestError(400, "评阅规则包含不属于本卷的题目。");
      }
      const enrolled = await db.classroomStudent.findMany({
        where: { classroomId: { in: data.classroomIds } },
        select: { id: true },
      });
      if (!enrolled.length) throw new RequestError(400, "请先录入参试学生。");
      const studentIds = enrolled.map((s) => s.id);
      const create = papers.map((p) => ({
        ...p,
        questionRules: json(p.questionRules ?? {}),
        conversion: json(p.conversion),
      }));
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
      const exam = await db.assessment.findUnique({
        where: { id: command.id },
        include: { papers: true },
      });
      owner(a, exam);
      const state = await loadState(a, db);
      const target = state.assessments.find((e) => e.id === command.id);
      if (
        !target ||
        target.classroomIds.length !== exam!.classroomIds.length ||
        target.papers.length !== exam!.papers.length ||
        state.classrooms.some(
          (c) =>
            target.classroomIds.includes(c.id) &&
            target.papers.some((p) => !canReadSubject(a, c, p.subject)),
        )
      )
        throw missing();
      if (command.published) {
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
  }
}
