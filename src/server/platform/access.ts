import "server-only";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { AccessError, RequestError } from "@/server/http/errors";
import type { PlatformState, Role } from "./types";
export type Db = PrismaClient | Prisma.TransactionClient;
export const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export const missing = () => new AccessError(404, "记录不存在或无权访问。");
export async function getActor(userId: string, db: Db = getDb()): Promise<PlatformState["actor"]> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, role: true },
  });
  if (!user) throw new AccessError(401, "请先登录。");
  if (!["ADMIN", "TEACHER", "STUDENT"].includes(user.role))
    throw new AccessError(403, "账号角色无效，请联系管理员。");
  return { ...user, role: user.role as Role };
}
export const teacher = (a: PlatformState["actor"]) => {
  if (a.role === "STUDENT") throw new AccessError(403, "需要教师权限。");
};
export function owner(a: PlatformState["actor"], record: { ownerId: string } | null) {
  if (!record || (a.role !== "ADMIN" && record.ownerId !== a.id)) throw missing();
  return record;
}
export async function canAssess(db: Db, a: PlatformState["actor"], id: string) {
  const assessment = await db.assessment.findUnique({ where: { id }, include: { papers: true } });
  if (!assessment) throw missing();
  if (a.role === "ADMIN" || assessment.ownerId === a.id) return assessment;
  const classes = await db.classroom.count({
    where: {
      id: { in: assessment.classroomIds },
      OR: [{ ownerId: a.id }, { reviewerIds: { has: a.id } }],
    },
  });
  if (!classes) throw missing();
  return assessment;
}
export async function canUseStudent(db: Db, a: PlatformState["actor"], classroomId: string) {
  if (a.role === "ADMIN") return;
  const classroom = await db.classroom.findUnique({ where: { id: classroomId } });
  if (!classroom || (classroom.ownerId !== a.id && !classroom.reviewerIds.includes(a.id)))
    throw missing();
}
export async function assertAssets(db: Db, a: PlatformState["actor"], urls: string[]) {
  for (const url of [...new Set(urls)]) {
    const match = /^\/api\/platform\/assets\/([\w-]+)$/.exec(url);
    if (!match) throw new RequestError(400, "图片和扫描件必须先上传到本站。");
    const asset = await db.platformAsset.findUnique({ where: { id: match[1] } });
    if (!asset || (a.role !== "ADMIN" && asset.ownerId !== a.id)) throw missing();
  }
}
