import "server-only";
import { getDb } from "@/server/db/client";
import { requireSession } from "./session";
import { AccessError } from "@/server/http/errors";
import type { WorkspaceRole } from "@/generated/prisma/client";

export async function requireWorkspaceAccess(requestHeaders: Headers, workspaceId: string, roles?: WorkspaceRole[]) {
  const session = await requireSession(requestHeaders);
  const member = await getDb().workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: session.user.id } },
    include: { workspace: true },
  });
  if (!member) throw new AccessError(404, "工作空间不存在或无权访问。");
  if (roles && !roles.includes(member.role)) throw new AccessError(403, "没有执行此操作的权限。");
  return { session, member, workspace: member.workspace };
}

export async function requireAdmin(requestHeaders: Headers) {
  const session = await requireSession(requestHeaders);
  // Read the current database role rather than trusting client input or cached user fields.
  const user = await getDb().user.findUnique({ where: { id: session.user.id }, select: { role: true } });
  if (user?.role !== "ADMIN") throw new AccessError(403, "需要管理员权限。");
  return session;
}
