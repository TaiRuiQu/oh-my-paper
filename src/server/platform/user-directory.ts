import "server-only";
import { AccessError, RequestError } from "@/server/http/errors";
import type { PlatformState } from "@/contracts/platform";
import { getActor, toTeachingAssignment, visibleClassrooms, type Db } from "./access";
import { getDb } from "@/server/db/client";

export const USER_DIRECTORY_LIMIT = 200;
const ROLES = ["ADMIN", "TEACHER", "STUDENT"] as const;

export type UserDirectoryParams = {
  query?: string;
  role?: string;
  id?: string;
};

/**
 * On-demand account directory search. Mirrors the scope of the state `users`
 * load (staff for everyone, plus students of visible classrooms for teachers)
 * so no page needs the full account list up front.
 */
export async function loadUserDirectory(
  actorId: string,
  params: UserDirectoryParams = {},
  db: Db = getDb(),
): Promise<{ users: PlatformState["users"]; total: number }> {
  const actor = await getActor(actorId, db);
  if (actor.role === "STUDENT") throw new AccessError(403, "需要教师权限。");
  const query = params.query?.trim() ?? "";
  if (query.length > 64) throw new RequestError(400, "搜索关键词过长，请缩短后重试。");
  if (query && params.id) throw new RequestError(400, "按编号读取账号时不需要搜索关键词。");
  const role = params.role
    ? ROLES.includes(params.role as (typeof ROLES)[number])
      ? (params.role as (typeof ROLES)[number])
      : undefined
    : undefined;
  if (params.role && !role) throw new RequestError(400, "账号角色无效。");
  const scope =
    actor.role === "ADMIN"
      ? {}
      : {
          OR: [
            { role: { in: ["ADMIN", "TEACHER"] } },
            {
              studentRecords: {
                some: {
                  classroomId: {
                    in: (
                      await db.classroom.findMany({
                        where: visibleClassrooms(actor),
                        select: { id: true },
                      })
                    ).map((c) => c.id),
                  },
                },
              },
            },
          ],
        };
  // The visibility scope and the free-text filter both use OR, so they must be
  // combined explicitly instead of sharing a top-level key.
  const where = {
    AND: [
      scope,
      ...(params.id ? [{ id: params.id }] : []),
      ...(role ? [{ role }] : []),
      ...(query
        ? [
            {
              OR: [
                { name: { contains: query, mode: "insensitive" as const } },
                { username: { contains: query, mode: "insensitive" as const } },
                { email: { contains: query, mode: "insensitive" as const } },
              ],
            },
          ]
        : []),
    ],
  };
  const base = { id: true, name: true, email: true, username: true, role: true } as const;
  const select =
    actor.role === "ADMIN"
      ? { ...base, teachingAssignments: true, permissionsVersion: true }
      : base;
  if (params.id) {
    const rows = await db.user.findFirst({ where, select }).then((user) => (user ? [user] : []));
    if (!rows.length) throw new AccessError(404, "记录不存在或无权访问。");
    return { users: projectUsers(rows, actor.role), total: 1 };
  }
  const [users, total] = await Promise.all([
    db.user.findMany({
      where,
      select,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: USER_DIRECTORY_LIMIT,
    }),
    db.user.count({ where }),
  ]);
  return { users: projectUsers(users, actor.role), total };
}

function projectUsers(users: Record<string, unknown>[], role: string): PlatformState["users"] {
  return users.map((user) => ({
    ...user,
    ...(role === "ADMIN" && "teachingAssignments" in user
      ? {
          teachingAssignments: (
            user.teachingAssignments as Parameters<typeof toTeachingAssignment>[0][]
          ).map(toTeachingAssignment),
        }
      : {}),
  })) as PlatformState["users"];
}
