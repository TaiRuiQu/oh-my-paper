import "server-only";
import { getDb } from "@/server/db/client";
import { requireSession } from "./session";
import { AccessError } from "@/server/http/errors";
export async function requireAdmin(requestHeaders: Headers) {
  const session = await requireSession(requestHeaders);
  // Read the current database role rather than trusting client input or cached user fields.
  if (!(await isAdminUser(session.user.id))) throw new AccessError(403, "需要管理员权限。");
  return session;
}

export async function isAdminUser(userId: string) {
  const user = await getDb().user.findUnique({ where: { id: userId }, select: { role: true } });
  return user?.role === "ADMIN";
}
