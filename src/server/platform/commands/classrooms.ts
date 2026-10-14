import "server-only";
import { insertAccount, lockAccounts, nextStudentNumber } from "@/server/auth/accounts";
import type { AccountCredentials } from "@/contracts/auth";
import type { Prisma as PrismaTypes } from "@/generated/prisma/client";
import type { PlatformState } from "../types";
import type { Command } from "./types";
import { owner, missing } from "../access";
import { RequestError } from "@/server/http/errors";
export async function executeClassroomsCommand(
  db: PrismaTypes.TransactionClient,
  a: PlatformState["actor"],
  command: Command,
) {
  switch (command.type) {
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
      const { id, userId, ...input } = command.student;
      const data = { ...input, studentNumber: input.studentNumber ?? "" };
      owner(a, await db.classroom.findUnique({ where: { id: data.classroomId } }));
      const previous = id ? await db.classroomStudent.findUnique({ where: { id } }) : null;
      if (id && (!previous || previous.classroomId !== data.classroomId)) throw missing();
      let binding = userId;
      await lockAccounts(db);
      let credentials: AccountCredentials | undefined;
      if (!data.studentNumber)
        data.studentNumber = previous?.studentNumber ?? (await nextStudentNumber(db));
      if (previous?.userId && binding === null)
        throw new RequestError(409, "已有学生账号不能解绑。");
      binding ??= previous?.userId ?? undefined;
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
            OR: [{ studentNumber: data.studentNumber }, ...(binding ? [{ userId: binding }] : [])],
            ...(id ? { id: { not: id } } : {}),
          },
        })
      )
        throw new RequestError(409, "该班级已有相同卡号或账号。");
      if (!binding) {
        const account = await insertAccount(db, {
          role: "STUDENT",
          name: data.name,
          studentNumber: data.studentNumber,
        });
        binding = account.id;
        credentials = account.credentials;
      } else if (previous?.userId === binding) {
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
      if (await db.assessment.count({ where: { studentIds: { has: s.id } } }))
        throw new RequestError(409, "已列入考试名单的学生不能删除。");
      if (await db.scanSubmission.count({ where: { studentId: s.id } }))
        throw new RequestError(409, "已有答卷的学生不能删除。");
      await db.classroomStudent.delete({ where: { id: s.id } });
      return { id: s.id };
    }
  }
}
