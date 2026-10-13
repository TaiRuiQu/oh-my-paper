import "server-only";
import { getDb } from "@/server/db/client";
import { getAuth } from "@/server/auth";
import { AccessError, RequestError } from "@/server/http/errors";
import { logEvent } from "@/server/logger";
import type { AdminUser, AdminList } from "@/contracts/admin";

export async function listUsers(search: string, page: number): Promise<AdminList<AdminUser>> {
  const where = search
    ? {
        OR: [
          { name: { contains: search, mode: "insensitive" as const } },
          { email: { contains: search, mode: "insensitive" as const } },
        ],
      }
    : {};
  const pageSize = 20;
  const [users, total] = await Promise.all([
    getDb().user.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        credits: true,
        createdAt: true,
        _count: { select: { examTasks: true } },
      },
    }),
    getDb().user.count({ where }),
  ]);
  return {
    items: users.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      credits: user.credits.toFixed(8),
      createdAt: user.createdAt.toISOString(),
      examCount: user._count.examTasks,
    })),
    total,
    page,
    pageSize,
  };
}
export async function updateUser(
  adminId: string,
  id: string,
  input: { name: string; role: "USER" | "ADMIN" },
) {
  const changedRole = await getDb().$transaction(async (tx) => {
    // Serialize role changes so at least one administrator always remains.
    await tx.$executeRaw`LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE`;
    const admin = await tx.user.findUnique({ where: { id: adminId }, select: { role: true } });
    if (admin?.role !== "ADMIN") throw new AccessError(403, "需要管理员权限。");
    const target = await tx.user.findUnique({ where: { id }, select: { role: true } });
    if (!target) throw new AccessError(404, "用户不存在。");
    if (
      target.role === "ADMIN" &&
      input.role !== "ADMIN" &&
      (await tx.user.count({ where: { role: "ADMIN" } })) <= 1
    )
      throw new RequestError(409, "至少需要保留一名管理员。");
    await tx.user.update({ where: { id }, data: input });
    if (target.role !== input.role) await tx.session.deleteMany({ where: { userId: id } });
    return target.role !== input.role;
  });
  logEvent("admin.user.updated", { adminId, userId: id, role: input.role });
  return { success: true, signedOut: changedRole && adminId === id };
}
export async function resetUserPassword(adminId: string, id: string, password: string) {
  if (
    (await getDb().user.findUnique({ where: { id: adminId }, select: { role: true } }))?.role !==
    "ADMIN"
  )
    throw new AccessError(403, "需要管理员权限。");
  const context = await getAuth().$context;
  const hashed = await context.password.hash(password);
  await getDb().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${id} FOR UPDATE`;
    if (
      (await tx.user.findUnique({ where: { id: adminId }, select: { role: true } }))?.role !==
      "ADMIN"
    )
      throw new AccessError(403, "需要管理员权限。");
    const account = await tx.account.findFirst({
      where: { userId: id, providerId: "credential" },
      select: { id: true },
    });
    if (!account) throw new AccessError(404, "用户不存在或尚未设置密码登录。");
    await tx.account.update({ where: { id: account.id }, data: { password: hashed } });
    await tx.session.deleteMany({ where: { userId: id } });
  });
  logEvent("admin.user.password_reset", { adminId, userId: id });
  return { success: true, signedOut: adminId === id };
}
