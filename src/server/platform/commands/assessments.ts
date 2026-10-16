import "server-only";
import type { Prisma as PrismaTypes } from "@/generated/prisma/client";
import type { PlatformState } from "../types";
import type { Command } from "./types";
import { paperRecord } from "../records";
import { json, missing, visibleClassrooms } from "../access";
import { canReadSubject } from "@/contracts/permissions";
import { loadInternalState } from "../queries";
import { RequestError } from "@/server/http/errors";
import { rosterPublicationReadiness } from "@/lib/assessment-roster";
import {
  addRosterParticipants,
  manageableAssessmentRoster,
  reconcileRosterConfiguration,
  recordRosterEvent,
} from "../assessment-roster";
export async function executeAssessmentsCommand(
  db: PrismaTypes.TransactionClient,
  a: PlatformState["actor"],
  command: Command,
) {
  switch (command.type) {
    case "assessment.rename": {
      await manageableAssessmentRoster(db, a, command.id);
      await db.assessment.update({ where: { id: command.id }, data: { name: command.name } });
      return { id: command.id };
    }
    case "assessment.roster.update": {
      const assessment = await manageableAssessmentRoster(db, a, command.id);
      if (assessment.published) throw new RequestError(409, "请先撤回成绩发布，再调整本次名单。");
      if (assessment.rosterRevision !== command.expectedRevision)
        throw new RequestError(409, "参试名单已被其他操作修改，请刷新后核对并重试。");
      if (
        command.addStudentIds.some((id) =>
          assessment.participants.some((participant) => participant.studentId === id),
        )
      )
        throw new RequestError(400, "学生已在本次名单中，请修改其科目参加状态。");
      const changes = [];
      for (const change of command.changes) {
        const participant = assessment.participants.find(
          (entry) => entry.id === change.participantId,
        );
        const subject = participant?.subjects.find((entry) => entry.paperId === change.paperId);
        if (
          !participant ||
          !subject ||
          !assessment.papers.some((entry) => entry.paperId === change.paperId)
        )
          throw missing();
        changes.push({
          participantId: participant.id,
          studentId: participant.studentId,
          paperId: subject.paperId,
          before: subject,
          after: { status: change.status, reason: change.reason },
        });
      }
      const added = await addRosterParticipants(
        db,
        assessment.id,
        assessment.classroomIds,
        assessment.papers,
        command.addStudentIds,
      );
      for (const change of command.changes)
        await db.assessmentParticipantSubject.update({
          where: {
            participantId_paperId: { participantId: change.participantId, paperId: change.paperId },
          },
          data: { status: change.status, reason: change.reason },
        });
      const revision = assessment.rosterRevision + 1;
      const updated = await db.assessment.updateMany({
        where: { id: assessment.id, rosterRevision: command.expectedRevision, published: false },
        data: {
          rosterRevision: revision,
          ...(command.confirmReconstruction ? { rosterStatus: "CONFIRMED" } : {}),
        },
      });
      if (updated.count !== 1) throw new RequestError(409, "参试名单已更新，请刷新后重试。");
      await recordRosterEvent(db, assessment.id, revision, a.id, command.reason, {
        changes,
        added,
        confirmReconstruction: command.confirmReconstruction,
      });
      return { id: assessment.id };
    }
    case "assessment.save": {
      const { id, papers, expectedRosterRevision, rosterStudentIds, rosterChangeReason, ...data } =
        command.assessment;
      let previous;
      if (id) {
        previous = await manageableAssessmentRoster(db, a, id);
        if (await db.homeworkAssignment.findUnique({ where: { assessmentId: id } }))
          throw new RequestError(
            409,
            "作业已发放，班级、科目和评阅规则已冻结；请使用名单核对或另建安排。",
          );
        if (previous.published) throw new RequestError(409, "请先撤回成绩发布，再调整安排。");
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
      if (
        data.reviewScope === "GRADE" &&
        new Set(classrooms.map((c) => JSON.stringify([c.stage, c.cohort]))).size !== 1
      )
        throw new RequestError(400, "年级联考的参与班级必须属于同一学段、同一届别。");
      const paperRows = (
        await db.paper.findMany({
          where: {
            id: { in: papers.map((p) => p.paperId) },
            ...(a.role === "ADMIN" ? {} : { ownerId: a.id }),
          },
        })
      ).map(paperRecord);
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
      const settings = papers.map((p) => ({ ...p, questionRules: p.questionRules ?? {} }));
      if (id) {
        const changedScope =
          JSON.stringify([...previous!.classroomIds].sort()) !==
            JSON.stringify([...data.classroomIds].sort()) ||
          JSON.stringify(previous!.papers.map((paper) => paper.paperId).sort()) !==
            JSON.stringify(papers.map((paper) => paper.paperId).sort());
        if (
          changedScope &&
          (expectedRosterRevision !== previous!.rosterRevision ||
            !rosterStudentIds ||
            !rosterChangeReason)
        )
          throw new RequestError(
            409,
            "调整班级或科目前，请核对本次名单差异、填写原因并确认当前名单版本。",
          );
        const changes = changedScope
          ? await reconcileRosterConfiguration(
              db,
              id,
              data.classroomIds,
              papers,
              rosterStudentIds!,
              rosterChangeReason!,
            )
          : undefined;
        await db.assessment.update({
          where: { id },
          data: {
            ...data,
            published: false,
            papers: json(settings),
            ...(changedScope ? { rosterRevision: { increment: 1 } } : {}),
          },
        });
        if (changedScope)
          await recordRosterEvent(
            db,
            id,
            previous!.rosterRevision + 1,
            a.id,
            rosterChangeReason!,
            changes,
          );
        return { id };
      }
      const exam = await db.assessment.create({
        data: { ...data, ownerId: a.id, papers: json(settings) },
      });
      const added = await addRosterParticipants(db, exam.id, data.classroomIds, papers);
      await recordRosterEvent(db, exam.id, 1, a.id, "创建安排时确认初始参试名单。", {
        source: "CREATED_FROM_CLASSROOMS",
        added,
      });
      return { id: exam.id };
    }
    case "assessment.publish": {
      const exam = await manageableAssessmentRoster(db, a, command.id);
      const state = await loadInternalState(a, db);
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
        const collection = await db.homeworkAssignment.findUnique({
          where: { assessmentId: target.id },
        });
        if (collection?.status === "CANCELLED")
          throw new RequestError(409, "已取消发放的作业不能发布成绩。");
        if (collection && collection.rosterRevision !== target.rosterRevision)
          throw new RequestError(409, "请先核对并同步作业收交名单，再发布成绩。");
        const result = state.analytics.results.filter((r) => r.assessmentId === target.id);
        if (!rosterPublicationReadiness(target, result).ready)
          throw new RequestError(
            409,
            "请先确认本次参试名单，完成所有应参加科目的评阅或登记缺考、免考后再发布。",
          );
      }
      await db.assessment.update({
        where: { id: command.id },
        data: { published: command.published },
      });
      return { id: command.id };
    }
  }
}
