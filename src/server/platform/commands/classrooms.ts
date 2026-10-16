import "server-only";
import { insertAccount, lockAccounts, nextStudentNumber } from "@/server/auth/accounts";
import { studentNumberSchema, type AccountCredentials } from "@/contracts/auth";
import type { Prisma as PrismaTypes } from "@/generated/prisma/client";
import type { PlatformState } from "../types";
import type { Command } from "./types";
import { owner, missing } from "../access";
import { AccessError, RequestError } from "@/server/http/errors";
import { grantNewClassroomOwner } from "../teaching-permissions";
export async function executeClassroomsCommand(
  db: PrismaTypes.TransactionClient,
  a: PlatformState["actor"],
  command: Command,
) {
  switch (command.type) {
    case "classroom.save": {
      const { id, ...data } = command.classroom;
      if (id) {
        const previous = owner(a, await db.classroom.findUnique({ where: { id } }));
        if (
          a.role !== "ADMIN" &&
          (previous.stage !== data.stage || previous.cohort !== data.cohort) &&
          (await db.teachingAssignment.count({
            where: { classroomId: id, role: "SUBJECT_TEACHER" },
          }))
        )
          throw new AccessError(403, "已配置任课教师的班级学段或届别只能由管理员调整。");
      }
      const c = id
        ? await db.classroom.update({ where: { id }, data })
        : await db.classroom.create({ data: { ...data, ownerId: a.id } });
      if (!id && a.role === "TEACHER") await grantNewClassroomOwner(db, a.id, c);
      return { id: c.id };
    }
    case "student.save": {
      const { id, userId, ...input } = command.student;
      const data = { ...input, studentNumber: input.studentNumber ?? "" };
      owner(a, await db.classroom.findUnique({ where: { id: data.classroomId } }));
      const previous = id ? await db.classroomStudent.findUnique({ where: { id } }) : null;
      if (id && (!previous || previous.classroomId !== data.classroomId)) throw missing();
      let binding = userId;
      await lockAccounts(db);
      let credentials: AccountCredentials | undefined;
      if (previous?.userId && binding !== undefined && binding !== previous.userId)
        throw new RequestError(
          409,
          "已有学生账号不能解绑或更换，学生身份不能更改；请保留本人登录与教学记录。",
        );
      if (binding === undefined) binding = previous?.userId ?? undefined;
      if (binding) {
        const account = await db.user.findUnique({ where: { id: binding } });
        if (!account || account.role !== "STUDENT")
          throw new RequestError(400, "只能绑定学生账号。");
        if (
          !data.studentNumber &&
          !previous &&
          studentNumberSchema.safeParse(account.username).success
        )
          data.studentNumber = account.username!;
      }
      if (!data.studentNumber)
        data.studentNumber = previous?.studentNumber ?? (await nextStudentNumber(db));
      if (previous) {
        const hasPracticeHistory =
          (await db.practiceSession.count({ where: { studentId: previous.id } })) > 0;
        const hasClassroomHistory =
          (await db.teachingParticipant.count({ where: { studentId: previous.id } })) > 0;
        const hasRoster =
          (await db.assessmentParticipant.count({ where: { studentId: previous.id } })) > 0;
        if (
          (hasRoster || hasClassroomHistory || hasPracticeHistory) &&
          (previous.name !== data.name ||
            previous.studentNumber !== data.studentNumber ||
            previous.classroomId !== data.classroomId)
        )
          throw new RequestError(
            409,
            "学生已有考试、作业、课堂或自主练习记录，身份资料不能直接修改；请保留历史记录。",
          );
        const hasHistory =
          hasRoster ||
          hasClassroomHistory ||
          hasPracticeHistory ||
          (await db.scanSubmission.count({ where: { studentId: previous.id } })) > 0;
        if (hasHistory) {
          const unchangedIdentity =
            previous.name === data.name &&
            previous.studentNumber === data.studentNumber &&
            previous.classroomId === data.classroomId;
          const unchangedBinding = binding === undefined || binding === previous.userId;
          const firstBinding = !hasPracticeHistory && !!binding && previous.userId === null;
          if (!unchangedIdentity || (!unchangedBinding && !firstBinding))
            throw new RequestError(
              409,
              "已有教学记录的学生身份不能更改；尚未绑定账号的学生可补绑定本人账号。",
            );
        }
      }
      if (
        await db.classroomStudent.findFirst({
          where: {
            classroomId: data.classroomId,
            OR: [{ studentNumber: data.studentNumber }, ...(binding ? [{ userId: binding }] : [])],
            ...(id ? { id: { not: id } } : {}),
          },
        })
      )
        throw new RequestError(409, "该班级已有相同卡号或账号。");
      // Omitted userId creates a managed account; explicit null keeps a roster
      // entry unbound until an existing student account is attached later.
      if (binding === undefined) {
        const account = await insertAccount(db, {
          role: "STUDENT",
          name: data.name,
          studentNumber: data.studentNumber,
        });
        binding = account.id;
        credentials = account.credentials;
      } else if (previous?.userId && previous.userId === binding) {
        // A student's login identifies them across classrooms; don't silently change it here.
        if (previous.studentNumber !== data.studentNumber)
          throw new RequestError(409, "已分配学生账号的学号不能更改。");
      }
      const s = id
        ? await db.classroomStudent.update({
            where: { id },
            data: { ...data, ...(binding !== undefined ? { userId: binding } : {}) },
          })
        : await db.classroomStudent.create({ data: { ...data, userId: binding ?? null } });
      return { id: s.id, ...(credentials ? { credentials } : {}) };
    }
    case "student.delete": {
      const s = await db.classroomStudent.findUnique({ where: { id: command.id } });
      if (!s) throw missing();
      owner(a, await db.classroom.findUnique({ where: { id: s.classroomId } }));
      if (await db.practiceSession.count({ where: { studentId: s.id } }))
        throw new RequestError(409, "学生已有自主练习记录，不能删除；请保留本人作答与反馈历史。");
      if (await db.teachingParticipant.count({ where: { studentId: s.id } }))
        throw new RequestError(
          409,
          "学生已加入课堂名单，不能删除；请在课堂名单中登记排除并保留授课历史。",
        );
      if (await db.assessmentParticipant.count({ where: { studentId: s.id } }))
        throw new RequestError(
          409,
          "学生已加入考试或作业参试名单，不能删除；请在本次名单中登记退出并保留历史记录。",
        );
      if (await db.scanSubmission.count({ where: { studentId: s.id } }))
        throw new RequestError(409, "已有答卷的学生不能删除。");
      await db.classroomStudent.delete({ where: { id: s.id } });
      return { id: s.id };
    }
  }
}
