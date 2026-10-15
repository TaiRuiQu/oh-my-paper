import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import {
  accountImportSchema,
  importAccount,
  validateImportRows,
  type AccountImport,
  type ImportIssue,
  type ImportResult,
} from "@/contracts/account-import";
import { getDb } from "@/server/db/client";
import { AccessError, RequestError } from "@/server/http/errors";
import { insertAccount, lockAccounts, prepareAccountPassword } from "./accounts";

type Db = Prisma.TransactionClient;
export async function authorizeAccountImport(
  actorId: string,
  role: AccountImport["role"],
  classroomId?: string,
  db: Db = getDb(),
) {
  const actor = await db.user.findUnique({ where: { id: actorId }, select: { role: true } });
  if (actor?.role !== "ADMIN" && !(actor?.role === "TEACHER" && role === "STUDENT" && classroomId))
    throw new AccessError(403, "仅管理员可以导入教师和全校账号；教师只能向自己的班级导入学生。");
  if (classroomId) {
    if (role !== "STUDENT") throw new RequestError(400, "只有学生可以导入班级。");
    const classroom = await db.classroom.findUnique({ where: { id: classroomId } });
    if (!classroom || (actor.role !== "ADMIN" && classroom.ownerId !== actorId))
      throw new AccessError(404, "班级不存在或无权管理。");
  }
}

export async function checkAccountImport(
  input: AccountImport,
  db: Db = getDb(),
): Promise<ImportIssue[]> {
  const issues = validateImportRows(input.role, input.rows);
  const keys = input.rows
    .map((row) =>
      input.role === "STUDENT" ? row.studentNumber : row.username.trim().toLowerCase(),
    )
    .filter(Boolean);
  const existing = await db.user.findMany({
    where: { username: { in: keys } },
    select: { username: true },
  });
  const taken = new Set(existing.map((user) => user.username));
  const roster =
    input.role === "STUDENT"
      ? await db.classroomStudent.findMany({
          where: { studentNumber: { in: keys } },
          select: { studentNumber: true },
        })
      : [];
  for (const student of roster) taken.add(student.studentNumber);
  for (const row of input.rows) {
    const key = input.role === "STUDENT" ? row.studentNumber : row.username.trim().toLowerCase();
    if (key && taken.has(key))
      issues.push({
        row: row.row,
        message:
          input.role === "STUDENT"
            ? "学号已存在，请修改后重试；已有学生请在班级中绑定账号。"
            : "账号已存在，请使用其他账号后重新上传。",
      });
  }
  return issues;
}

export async function commitAccountImport(actorId: string, raw: unknown): Promise<ImportResult> {
  const input = accountImportSchema.parse(raw);
  await authorizeAccountImport(actorId, input.role, input.classroomId);
  const issues = await checkAccountImport(input);
  if (issues.length)
    throw new RequestError(
      400,
      issues.map((issue) => `第 ${issue.row} 行：${issue.message}`).join("\n"),
    );
  const accounts = input.rows.map((row) => importAccount(input.role, row).data!);
  // Hash before opening the transaction; bound concurrent scrypt memory usage.
  const prepared: Awaited<ReturnType<typeof prepareAccountPassword>>[] = [];
  for (let offset = 0; offset < accounts.length; offset += 4)
    prepared.push(
      ...(await Promise.all(accounts.slice(offset, offset + 4).map(prepareAccountPassword))),
    );
  return getDb().$transaction(
    async (db) => {
      // Match permission/role writers' lock order and recheck grants and duplicates after waiting.
      await db.$executeRaw`SELECT pg_advisory_xact_lock(490221)`;
      await db.$queryRaw`SELECT pg_advisory_xact_lock(7240132026::bigint)::text`;
      await lockAccounts(db);
      await authorizeAccountImport(actorId, input.role, input.classroomId, db);
      const conflicts = await checkAccountImport(input, db);
      if (conflicts.length)
        throw new RequestError(
          409,
          conflicts.map((issue) => `第 ${issue.row} 行：${issue.message}`).join("\n"),
        );
      const result: ImportResult = { accounts: [] };
      // Reserve explicitly supplied numbers before generating numbers for blank cells.
      const order = accounts
        .map((_, index) => index)
        .sort(
          (a, b) =>
            Number(input.rows[a].studentNumber === "") - Number(input.rows[b].studentNumber === ""),
        );
      for (const index of order) {
        const account = accounts[index];
        const saved = await insertAccount(db, account, prepared[index]);
        const name = account.name ?? saved.credentials.username;
        if (input.classroomId)
          await db.classroomStudent.create({
            data: {
              classroomId: input.classroomId,
              name,
              studentNumber: saved.credentials.username,
              userId: saved.id,
            },
          });
        result.accounts.push({ ...saved.credentials, name, row: input.rows[index].row });
      }
      result.accounts.sort((a, b) => a.row - b.row);
      return result;
    },
    { timeout: 60000 },
  );
}
