import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { loadEnvironment } from "./load-env.mjs";
import type { PlatformCommand } from "../src/contracts/platform";

loadEnvironment();
async function main() {
  const schema = `record_names_${randomUUID().replaceAll("-", "")}`;
  const connectionString = process.env.DATABASE_URL!;
  const sql = new Client({ connectionString });
  const { PrismaClient } = await import("../src/generated/prisma/client");
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString, options: `-c search_path=${schema}` }, { schema }),
  });
  const globalDb = globalThis as typeof globalThis & {
    paperDb?: InstanceType<typeof PrismaClient>;
  };
  const previous = globalDb.paperDb;
  globalDb.paperDb = db;
  try {
    await sql.connect();
    await sql.query(`CREATE SCHEMA "${schema}"`);
    await sql.query(`SET search_path TO "${schema}"`);
    for (const folder of (await readdir("prisma/migrations")).filter((f) => /^\d/.test(f)).sort())
      await sql.query(await readFile(join("prisma/migrations", folder, "migration.sql"), "utf8"));
    const { executeCommand, loadState } = await import("../src/server/platform/service");
    const { generateCardTemplate } = await import("../src/server/platform/cards");
    for (const id of ["owner", "other", "admin", "student"])
      await db.user.create({
        data: {
          id,
          name: id,
          email: `${id}@test.invalid`,
          role: id === "admin" ? "ADMIN" : id === "student" ? "STUDENT" : "TEACHER",
        },
      });
    const command = (input: PlatformCommand) => executeCommand({ id: "owner" }, input);
    const classroom = await command({
      type: "classroom.save",
      classroom: { name: "高一一班", stage: "高中", cohort: "2027届" },
    });
    await db.teachingAssignment.create({
      data: {
        userId: "owner",
        role: "SUBJECT_TEACHER",
        classroomId: classroom.id,
        subject: "数学",
      },
    });
    const student = await command({
      type: "student.save",
      student: {
        classroomId: classroom.id,
        name: "学生甲",
        studentNumber: "000001",
        userId: "student",
      },
    });
    const question = await command({
      type: "question.save",
      question: {
        type: "BLANK",
        subject: "数学",
        grade: "高一",
        difficulty: 0.5,
        knowledgeTags: ["加法"],
        content: {
          stem: "1 + 1 = ___",
          answers: ["2"],
          options: [],
          images: [],
          parts: [],
          explanation: "",
          rubric: "填2得10分",
        },
      },
    });

    for (const kind of ["EXAM", "HOMEWORK"] as const) {
      const paper = await command({
        type: "paper.save",
        paper: {
          name: `${kind}原题本`,
          kind,
          subject: "数学",
          grade: "高一",
          instructions: "姓名：________",
          layout: { paperSize: "A4", columns: 2 },
          items: [{ questionId: question.id, score: 10, section: "填空题" }],
        },
      });
      await command({ type: "paper.rename", id: paper.id, name: `  ${kind}草稿新名称  ` });
      const saved = (await loadState({ id: "owner" })).papers.find((p) => p.id === paper.id)!;
      assert.equal(saved.name, `${kind}草稿新名称`);
      if (kind === "EXAM") {
        const template = generateCardTemplate(saved);
        await command({
          type: "template.save",
          template: {
            paperId: paper.id,
            name: template.name,
            subject: template.subject,
            layout: template.layout,
          },
        });
      }
      const assessment = await command({
        type: "assessment.save",
        assessment: {
          name: `${kind}原安排`,
          kind,
          reviewScope: "CLASSROOM",
          classroomIds: [classroom.id],
          papers: [
            {
              paperId: paper.id,
              subject: "数学",
              gradingMode: "SINGLE",
              arbitrationThreshold: 2,
              conversion: { enabled: false, bands: [] },
            },
          ],
        },
      });
      const submission = await command({
        type: "submission.save",
        submission: {
          assessmentId: assessment.id,
          paperId: paper.id,
          studentId: student.id,
          kind: "WORKBOOK",
          sourceFiles: [],
          answers: [{ itemId: saved.items[0].id, text: "2", images: [] }],
        },
      });
      await command({
        type: "review.save",
        review: {
          submissionId: submission.id,
          itemId: saved.items[0].id,
          round: "FIRST",
          score: 10,
          feedback: "正确",
        },
      });

      async function snapshot() {
        const paperRow = await db.paper.findUniqueOrThrow({
          where: { id: paper.id },
          include: { templates: true },
        });
        const assessmentRow = await db.assessment.findUniqueOrThrow({
          where: { id: assessment.id },
          include: { submissions: { include: { reviews: true } } },
        });
        return {
          paper: { ...paperRow, name: undefined, updatedAt: undefined },
          assessment: { ...assessmentRow, name: undefined },
          history: await db.reviewEvent.findMany({ where: { submissionId: submission.id } }),
          analytics: (await loadState({ id: "owner" })).analytics,
        };
      }
      for (const published of [false, true]) {
        if (published)
          await command({ type: "assessment.publish", id: assessment.id, published: true });
        const before = await snapshot();
        const nameSuffix = published ? "已发布" : "已有答卷";
        const previousAssessmentName = (
          await db.assessment.findUniqueOrThrow({ where: { id: assessment.id } })
        ).name;
        await command({
          type: "paper.rename",
          id: paper.id,
          name: `${kind}${nameSuffix}题本新名称`,
        });
        assert.equal(
          (await db.assessment.findUniqueOrThrow({ where: { id: assessment.id } })).name,
          previousAssessmentName,
        );
        await command({
          type: "assessment.rename",
          id: assessment.id,
          name: `${kind}${nameSuffix}安排新名称`,
        });
        assert.deepEqual(await snapshot(), before);
        const updated = await loadState({ id: "owner" });
        assert.equal(
          updated.papers.find((p) => p.id === paper.id)!.name,
          `${kind}${nameSuffix}题本新名称`,
        );
        assert.equal(
          updated.assessments.find((a) => a.id === assessment.id)!.name,
          `${kind}${nameSuffix}安排新名称`,
        );
      }

      for (const [type, id] of [
        ["paper.rename", paper.id],
        ["assessment.rename", assessment.id],
      ] as const) {
        const before = await snapshot();
        for (const name of ["", "   ", "题".repeat(201)])
          await assert.rejects(
            executeCommand({ id: "owner" }, { type, id, name }),
            /请输入名称|不能超过/,
          );
        await assert.rejects(
          executeCommand(
            { id: "owner" },
            { type, id, name: "越界修改", published: false, classroomIds: [] },
          ),
          /Unrecognized key/,
        );
        await assert.rejects(
          executeCommand({ id: "other" }, { type, id, name: "其他教师越权" }),
          /无权访问/,
        );
        await assert.rejects(
          executeCommand({ id: "student", role: "ADMIN" }, { type, id, name: "学生越权" }),
          /教师权限/,
        );
        await assert.rejects(
          executeCommand({ id: "owner" }, { type, id: "missing", name: "不存在" }),
          /无权访问/,
        );
        assert.deepEqual(await snapshot(), before);
        await executeCommand({ id: "admin" }, { type, id, name: `管理员修改${kind}` });
        assert.deepEqual(await snapshot(), before);
      }
      assert.equal(
        (await loadState({ id: "student" })).assessments.find((a) => a.id === assessment.id)!.name,
        `管理员修改${kind}`,
      );
      console.log(
        `✓ ${kind}: draft, assigned, submitted and published renames preserve questions, templates, roster, reviews, results and permissions`,
      );
    }
  } finally {
    globalDb.paperDb = previous;
    await db.$disconnect();
    await sql.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
    await sql.end();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
