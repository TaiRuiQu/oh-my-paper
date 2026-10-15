import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { verifyPassword } from "better-auth/crypto";
import { loadEnvironment } from "./load-env.mjs";

loadEnvironment();
async function main() {
  const schema = `account_import_${randomUUID().replaceAll("-", "")}`;
  const connectionString = process.env.DATABASE_URL!;
  const sql = new Client({ connectionString });
  const { PrismaClient } = await import("../src/generated/prisma/client");
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString, options: `-c search_path=${schema}` }, { schema }),
  });
  const shared = globalThis as typeof globalThis & { paperDb?: InstanceType<typeof PrismaClient> };
  const previous = shared.paperDb;
  shared.paperDb = db;
  try {
    await sql.connect();
    await sql.query(`CREATE SCHEMA "${schema}"`);
    await sql.query(`SET search_path TO "${schema}"`);
    for (const folder of (await readdir("prisma/migrations")).filter((f) => /^\d/.test(f)).sort())
      await sql.query(await readFile(join("prisma/migrations", folder, "migration.sql"), "utf8"));
    for (const role of ["ADMIN", "TEACHER", "STUDENT"])
      await db.user.create({
        data: { id: role.toLowerCase(), role, name: role, email: `${role}@test.invalid` },
      });
    const classroom = await db.classroom.create({
      data: { ownerId: "teacher", name: "导入班级", grade: "高中一年级" },
    });
    const { commitAccountImport } = await import("../src/server/auth/account-import");
    const { parseAccountFile } = await import("../src/server/auth/account-import-file");
    const rows = await parseAccountFile(
      Buffer.from("姓名,学号\n张三,000001\n李四,"),
      "csv",
      "STUDENT",
    );
    const imported = await commitAccountImport("teacher", {
      role: "STUDENT",
      classroomId: classroom.id,
      rows,
    });
    assert.equal(imported.accounts.length, 2);
    assert.equal(imported.accounts[0].username, "000001");
    assert.match(imported.accounts[1].username, /^\d{6}$/);
    const roster = await db.classroomStudent.findMany({
      where: { classroomId: classroom.id },
      include: { user: { include: { accounts: true } } },
    });
    assert.equal(roster.length, 2);
    for (const row of roster) {
      assert.equal(row.studentNumber, row.user!.username);
      const credentials = imported.accounts.find(
        (account) => account.username === row.studentNumber,
      )!;
      assert(
        await verifyPassword({
          hash: row.user!.accounts[0].password!,
          password: credentials.password,
        }),
      );
    }
    console.log(
      "✓ CSV batch creates student accounts, usable passwords and classroom membership with leading zeroes",
    );
    const teacherRows = await parseAccountFile(
      Buffer.from("姓名,账号,密码\n王老师,Teacher.A,Password123!"),
      "csv",
      "TEACHER",
    );
    await commitAccountImport("admin", { role: "TEACHER", rows: teacherRows });
    assert.equal((await db.user.findUnique({ where: { username: "teacher.a" } }))?.name, "王老师");
    await assert.rejects(
      commitAccountImport("teacher", { role: "TEACHER", rows: teacherRows }),
      /仅管理员/,
    );
    await assert.rejects(
      commitAccountImport("student", { role: "STUDENT", classroomId: classroom.id, rows }),
      /仅管理员/,
    );
    console.log(
      "✓ Teacher accounts preserve names and normalized usernames; unauthorized imports are rejected",
    );
    const count = await db.user.count();
    await assert.rejects(
      commitAccountImport("admin", {
        role: "STUDENT",
        rows: [
          { ...rows[0], studentNumber: "000002" },
          { ...rows[1], studentNumber: "000001" },
        ],
      }),
      /第 3 行/,
    );
    assert.equal(await db.user.count(), count);
    // Force the second insert to fail at the database layer, after the first succeeds.
    await sql.query(`ALTER TABLE users ADD CONSTRAINT import_failure CHECK (name <> '强制失败')`);
    await assert.rejects(
      commitAccountImport("admin", {
        role: "STUDENT",
        classroomId: classroom.id,
        rows: [
          { ...rows[0], studentNumber: "000003" },
          { ...rows[1], name: "强制失败", studentNumber: "000004" },
        ],
      }),
    );
    assert.equal(await db.user.count(), count);
    assert.equal(await db.classroomStudent.count({ where: { classroomId: classroom.id } }), 2);
    assert.equal(await db.user.findUnique({ where: { username: "000003" } }), null);
    console.log(
      "✓ Duplicate preflight and transaction failures leave no partial accounts or roster entries",
    );
  } finally {
    shared.paperDb = previous;
    await db.$disconnect();
    await sql.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await sql.end();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
