import "server-only";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import type { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { managedAccountSchema, type AccountCredentials } from "@/contracts/auth";
import { getDb } from "@/server/db/client";
import { AccessError, RequestError } from "@/server/http/errors";

type Db = Prisma.TransactionClient;

// All managed account writers share this lock, including concurrent server starts.
export async function lockAccounts(db: Db) {
  await db.$queryRaw`SELECT pg_advisory_xact_lock(490222)::text`;
}

export async function nextStudentNumber(db: Db) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const candidate = String(randomInt(1, 1000000)).padStart(6, "0");
    if (
      !(await db.user.findUnique({ where: { username: candidate } })) &&
      !(await db.classroomStudent.findFirst({ where: { studentNumber: candidate } }))
    )
      return candidate;
  }
  throw new RequestError(409, "暂时无法分配学号，请指定学号后重试。");
}

export async function prepareAccountPassword(input: z.infer<typeof managedAccountSchema>) {
  const password =
    input.role === "STUDENT" ? randomBytes(15).toString("base64url") : input.password;
  return { password, hash: await hashPassword(password) };
}

export async function insertAccount(
  db: Db,
  input: z.infer<typeof managedAccountSchema>,
  prepared?: Awaited<ReturnType<typeof prepareAccountPassword>>,
) {
  const username =
    input.role === "STUDENT"
      ? (input.studentNumber ?? (await nextStudentNumber(db)))
      : input.username;
  if (await db.user.findUnique({ where: { username } }))
    throw new RequestError(409, "账号或学号已存在，请使用其他账号或绑定已有学生账号。");
  const { password, hash } = prepared ?? (await prepareAccountPassword(input));
  const id = randomUUID();
  await db.user.create({
    data: {
      id,
      username,
      name: input.name ?? username,
      email: `${id}@accounts.invalid`,
      role: input.role,
      accounts: {
        create: {
          id: randomUUID(),
          providerId: "credential",
          accountId: id,
          password: hash,
        },
      },
    },
  });
  return { id, credentials: { username, password } satisfies AccountCredentials };
}

export async function createManagedAccount(actorId: string, input: unknown) {
  const parsed = managedAccountSchema.safeParse(input);
  if (!parsed.success)
    throw new RequestError(400, parsed.error.issues.map((issue) => issue.message).join(" "));
  return getDb().$transaction(
    async (db) => {
      await lockAccounts(db);
      const actor = await db.user.findUnique({ where: { id: actorId }, select: { role: true } });
      if (actor?.role !== "ADMIN" && !(actor?.role === "TEACHER" && parsed.data.role === "STUDENT"))
        throw new AccessError(403, "仅管理员可以添加账号，教师只能添加学生账号。");
      return insertAccount(db, parsed.data);
    },
    { timeout: 20000 },
  );
}

export async function ensureInitialAdmin() {
  const result = await getDb().$transaction(
    async (db) => {
      await lockAccounts(db);
      if (await db.user.findFirst({ where: { role: "ADMIN" } })) return null;
      const username = (await db.user.findUnique({ where: { username: "admin" } }))
        ? `admin_${randomBytes(4).toString("hex")}`
        : "admin";
      return insertAccount(db, {
        role: "ADMIN",
        username,
        password: randomBytes(18).toString("base64url"),
      });
    },
    { timeout: 20000 },
  );
  // Deliberately print once, after commit. Ordinary logs and API responses never contain this password.
  if (result)
    console.info(
      `\n[Oh My Paper] 初始管理员已创建\n账号：${result.credentials.username}\n密码：${result.credentials.password}\n请保存以上凭据；系统重启不会重置密码。\n`,
    );
  return result;
}
