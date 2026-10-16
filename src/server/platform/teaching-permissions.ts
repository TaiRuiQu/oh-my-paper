import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import {
  assignmentKey,
  teachingPermissionsHistoryQuerySchema,
  type TeachingPermissionsCommand,
  type TeachingPermissionsHistory,
  type TeachingPermissionsSnapshot,
} from "@/contracts/permissions";
import { getDb } from "@/server/db/client";
import { AccessError, RequestError } from "@/server/http/errors";
import { json, missing, toTeachingAssignment, type Db } from "./access";

const conflict = () =>
  new RequestError(409, "教学权限或角色已更新，请重新读取并比较；本次修改尚未保存。");
const userSelect = { id: true, name: true, role: true, permissionsVersion: true } as const;
type Target = { id: string; name: string; role: string; permissionsVersion: number };

async function persistChange(
  tx: Prisma.TransactionClient,
  actor: Pick<Target, "id" | "name">,
  user: Target,
  before: TeachingPermissionsSnapshot,
  after: TeachingPermissionsSnapshot,
  type: TeachingPermissionsHistory["events"][number]["type"],
  reason: string,
) {
  const updated = await tx.user.updateMany({
    where: { id: user.id, role: user.role, permissionsVersion: user.permissionsVersion },
    data: { role: after.role, permissionsVersion: { increment: 1 } },
  });
  if (updated.count !== 1) throw conflict();
  if (type !== "user.role" || after.role !== before.role) {
    await tx.teachingAssignment.deleteMany({ where: { userId: user.id } });
    if (after.assignments.length)
      await tx.teachingAssignment.createMany({
        data: after.assignments.map((row) => ({ ...row, userId: user.id })),
      });
  }
  const permissionsVersion = user.permissionsVersion + 1;
  await tx.teachingPermissionsEvent.create({
    data: {
      targetId: user.id,
      targetName: user.name,
      actorId: actor.id,
      actorName: actor.name,
      type,
      version: permissionsVersion,
      before: json(before),
      after: json(after),
      reason,
    },
  });
  return { id: user.id, permissionsVersion };
}

/** Caller already holds the domain lock. Never take the admin lock after it. */
export async function grantNewClassroomOwner(
  tx: Prisma.TransactionClient,
  actorId: string,
  classroom: { id: string; name: string },
) {
  const user = await tx.user.findUnique({
    where: { id: actorId },
    include: { teachingAssignments: true },
  });
  if (user?.role !== "TEACHER") throw new AccessError(403, "需要教师权限。");
  const before: TeachingPermissionsSnapshot = {
    role: "TEACHER",
    assignments: user.teachingAssignments
      .map(toTeachingAssignment)
      .sort((a, b) => assignmentKey(a).localeCompare(assignmentKey(b))),
  };
  const after: TeachingPermissionsSnapshot = {
    role: "TEACHER",
    assignments: [...before.assignments, { role: "HOMEROOM", classroomId: classroom.id }],
  };
  return persistChange(
    tx,
    user,
    user,
    before,
    after,
    "classroom.save",
    `新建班级“${classroom.name}”，自动配置班主任身份。`,
  );
}

/** Role and grant changes share one version, so changing away and back cannot revive a stale form. */
export async function changeTeachingPermissions(
  actorId: string,
  command: TeachingPermissionsCommand,
  db: PrismaClient = getDb(),
) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(490221)`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(7240132026::bigint)::text`;
    const actor = await tx.user.findUnique({ where: { id: actorId }, select: userSelect });
    if (actor?.role !== "ADMIN") throw new AccessError(403, "需要管理员权限。");
    const user = await tx.user.findUnique({
      where: { id: command.id },
      include: { teachingAssignments: true },
    });
    if (!user) throw missing();
    if (user.permissionsVersion !== command.expectedVersion) throw conflict();
    if (!["ADMIN", "TEACHER", "STUDENT"].includes(user.role))
      throw new RequestError(400, "账号角色无效，请先核对账号。");
    const before: TeachingPermissionsSnapshot = {
      role: user.role as TeachingPermissionsSnapshot["role"],
      assignments: user.teachingAssignments
        .map(toTeachingAssignment)
        .sort((a, b) => assignmentKey(a).localeCompare(assignmentKey(b))),
    };
    const after: TeachingPermissionsSnapshot = {
      role: command.type === "user.role" ? command.role : before.role,
      assignments:
        command.type === "user.permissions"
          ? [...command.assignments].sort((a, b) =>
              assignmentKey(a).localeCompare(assignmentKey(b)),
            )
          : command.role !== before.role
            ? []
            : before.assignments,
    };
    if (command.type === "user.permissions") {
      if (user.role !== "TEACHER") throw new RequestError(400, "只能为教师账号配置教学身份。");
      const classIds = [
        ...new Set(
          after.assignments.flatMap((row) => ("classroomId" in row ? [row.classroomId] : [])),
        ),
      ];
      if ((await tx.classroom.count({ where: { id: { in: classIds } } })) !== classIds.length)
        throw new RequestError(400, "班级不存在，请刷新后重新配置。");
      for (const scope of after.assignments.filter((row) => row.role === "GRADE_DIRECTOR"))
        if (
          !(await tx.classroom.findFirst({
            where: { stage: scope.stage, cohort: scope.cohort },
            select: { id: true },
          }))
        )
          throw new RequestError(400, "届别不存在，请先创建该学段、该届别的班级。");
    } else if (
      user.role === "ADMIN" &&
      command.role !== "ADMIN" &&
      (await tx.user.count({ where: { role: "ADMIN" } })) === 1
    )
      throw new RequestError(409, "至少保留一名管理员。");
    return persistChange(tx, actor, user, before, after, command.type, command.reason);
  });
}

export async function loadTeachingPermissionsHistory(
  actorId: string,
  targetId: string,
  input: unknown = {},
  db: Db = getDb(),
): Promise<TeachingPermissionsHistory> {
  const actor = await db.user.findUnique({ where: { id: actorId }, select: { role: true } });
  if (actor?.role !== "ADMIN") throw new AccessError(403, "需要管理员权限。");
  const parsed = teachingPermissionsHistoryQuerySchema.safeParse(input);
  if (!parsed.success) throw new RequestError(400, "权限历史分页参数无效。");
  const { beforeId, limit } = parsed.data;
  const user = await db.user.findUnique({ where: { id: targetId }, select: userSelect });
  if (!user) throw missing();
  const cursor = beforeId
    ? await db.teachingPermissionsEvent.findFirst({
        where: { id: beforeId, targetId },
        select: { id: true, createdAt: true },
      })
    : null;
  if (beforeId && !cursor) throw missing();
  const rows = await db.teachingPermissionsEvent.findMany({
    where: {
      targetId,
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });
  return {
    user: { ...user, role: user.role as TeachingPermissionsSnapshot["role"] },
    events: rows.slice(0, limit).map((row) => ({
      ...row,
      type: row.type as TeachingPermissionsHistory["events"][number]["type"],
      before: row.before as TeachingPermissionsSnapshot,
      after: row.after as TeachingPermissionsSnapshot,
      createdAt: row.createdAt.toISOString(),
    })),
    nextBeforeId: rows.length > limit ? rows[limit - 1].id : null,
  };
}
