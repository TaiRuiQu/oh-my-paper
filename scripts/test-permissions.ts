import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import sharp from "sharp";
import { loadEnvironment } from "./load-env.mjs";
import type { PlatformCommand } from "../src/contracts/platform";
import type { TeachingAssignment } from "../src/contracts/permissions";

loadEnvironment();

async function verifyLegacyCohortMigration(
  sql: Client,
  migration: string,
  labels: string[][] = [
    ["高三", "2027届"],
    ["高中三年级", "2027届"],
    ["高二", "2028届"],
    ["高中二年级", "2028届"],
    ["高一", "2029届"],
    ["高中一年级", "2029届"],
    [" 高一 ", "2029届"],
    ["2027届", "2027届"],
    ["2029届", "2029届"],
    ["2024级", "2024级"],
  ],
  studentCohort = "2029届",
) {
  await sql.query(
    `INSERT INTO users (id, name, email, role, "updatedAt") VALUES ('cohort-owner', '迁移验收', 'cohort@test.invalid', 'TEACHER', NOW())`,
  );
  for (const [index, [label]] of labels.entries()) {
    await sql.query(
      `INSERT INTO classrooms (id, "ownerId", name, cohort) VALUES ($1, 'cohort-owner', '迁移验收班', $2)`,
      [`cohort-${index}`, label],
    );
    await sql.query(
      `INSERT INTO teaching_assignments (id, "userId", role, cohort) VALUES ($1, 'cohort-owner', 'GRADE_DIRECTOR', $2)`,
      [`cohort-director-${index}`, label],
    );
  }
  await sql.query(
    `INSERT INTO classroom_students (id, "classroomId", name, "studentNumber") VALUES ('cohort-student', 'cohort-4', '迁移学生', '123456')`,
  );
  await sql.query(
    `INSERT INTO teaching_assignments (id, "userId", role, "classroomId") VALUES ('cohort-homeroom', 'cohort-owner', 'HOMEROOM', 'cohort-4')`,
  );
  const assertMigrated = async () => {
    for (const [index, [, cohort]] of labels.entries())
      assert.equal(
        (await sql.query("SELECT cohort FROM classrooms WHERE id=$1", [`cohort-${index}`])).rows[0]
          .cohort,
        cohort,
      );
    assert.deepEqual(
      (
        await sql.query(
          `SELECT cohort FROM teaching_assignments WHERE "userId"='cohort-owner' AND role='GRADE_DIRECTOR' ORDER BY cohort`,
        )
      ).rows.map((row: { cohort: string }) => row.cohort),
      [...new Set(labels.map(([, cohort]) => cohort))].sort(),
    );
    assert.equal(
      (await sql.query(`SELECT cohort FROM teaching_assignments WHERE id='cohort-homeroom'`))
        .rows[0].cohort,
      "",
    );
    assert.equal(
      (
        await sql.query(
          `SELECT c.cohort FROM classroom_students s JOIN classrooms c ON c.id=s."classroomId" WHERE s.id='cohort-student'`,
        )
      ).rows[0].cohort,
      studentCohort,
    );
  };
  await sql.query(migration);
  await assertMigrated();
  await sql.query(migration);
  await assertMigrated();
  await sql.query(`DELETE FROM users WHERE id='cohort-owner'`);
  console.log(
    "✓ Fixed 2027 graduation reference migrates class and director aliases, merges duplicate grants, preserves existing cohorts and roster links, and is safe to rerun",
  );
}

async function main() {
  const schema = `permissions_${randomUUID().replaceAll("-", "")}`;
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
    for (const folder of (await readdir("prisma/migrations")).filter((f) => /^\d/.test(f)).sort()) {
      if (folder === "20261017000000_teaching_permissions") {
        await sql.query(
          `INSERT INTO users (id, name, email, role, "updatedAt") VALUES ('legacy-owner', '原教师', 'legacy-owner@test.invalid', 'TEACHER', NOW()), ('legacy-reviewer', '原评阅者', 'legacy-reviewer@test.invalid', 'TEACHER', NOW())`,
        );
        await sql.query(
          `INSERT INTO classrooms (id, "ownerId", name, grade, "reviewerIds") VALUES ('legacy', 'legacy-owner', '旧班级', '旧年级', ARRAY['legacy-reviewer', 'legacy-owner'])`,
        );
      }
      const migration = await readFile(join("prisma/migrations", folder, "migration.sql"), "utf8");
      if (folder === "20261021000000_backfill_student_cohorts")
        await verifyLegacyCohortMigration(sql, migration);
      else if (folder === "20261022000000_backfill_primary_junior_cohorts")
        await verifyLegacyCohortMigration(
          sql,
          migration,
          [
            ["小学六年级", "小学2027届"],
            ["小学五年级", "小学2028届"],
            ["小学四年级", "小学2029届"],
            ["小学三年级", "小学2030届"],
            ["小学二年级", "小学2031届"],
            ["小学一年级", "小学2032届"],
            ["六年级", "小学2027届"],
            ["五年级", "小学2028届"],
            ["四年级", "小学2029届"],
            ["三年级", "小学2030届"],
            ["二年级", "小学2031届"],
            ["一年级", "小学2032届"],
            ["小六", "小学2027届"],
            ["小五", "小学2028届"],
            ["小四", "小学2029届"],
            ["小三", "小学2030届"],
            ["小二", "小学2031届"],
            ["小一", "小学2032届"],
            ["初三", "初中2027届"],
            ["初二", "初中2028届"],
            ["初一", "初中2029届"],
            ["初中三年级", "初中2027届"],
            ["初中二年级", "初中2028届"],
            ["初中一年级", "初中2029届"],
            ["九年级", "初中2027届"],
            ["八年级", "初中2028届"],
            ["七年级", "初中2029届"],
            [" 小学六年级 ", "小学2027届"],
            [" 初三 ", "初中2027届"],
            ["小学2027届", "小学2027届"],
            ["初中2027届", "初中2027届"],
            ["2027届", "2027届"],
            ["2029届", "2029届"],
            ["2024级", "2024级"],
            ["初中四年级", "初中四年级"],
          ],
          "小学2031届",
        );
      else if (folder === "20261023000000_student_cohort_stages") {
        await sql.query(
          `INSERT INTO users (id, name, email, role, "updatedAt") VALUES ('stage-owner', '学段迁移验收', 'stage@test.invalid', 'TEACHER', NOW())`,
        );
        const cases = [
          ["小学2027届", "小学", "2027届"],
          ["初中2027届", "初中", "2027届"],
          ["2027届", "高中", "2027届"],
          ["高中2027届", "高中", "2027届"],
          ["小学2032届", "小学", "2032届"],
          ["初中2024级", "初中", "2024级"],
          ["2024级", "高中", "2024级"],
        ];
        for (const [index, [label]] of cases.entries()) {
          await sql.query(
            `INSERT INTO classrooms (id, "ownerId", name, cohort) VALUES ($1, 'stage-owner', '学段班', $2)`,
            [`stage-class-${index}`, label],
          );
          await sql.query(
            `INSERT INTO teaching_assignments (id, "userId", role, cohort) VALUES ($1, 'stage-owner', 'GRADE_DIRECTOR', $2)`,
            [`stage-director-${index}`, label],
          );
        }
        await sql.query(migration);
        for (const [index, [, stage, cohort]] of cases.entries())
          assert.deepEqual(
            (
              await sql.query("SELECT stage, cohort FROM classrooms WHERE id=$1", [
                `stage-class-${index}`,
              ])
            ).rows[0],
            { stage, cohort },
          );
        assert.equal(
          (
            await sql.query(
              `SELECT COUNT(*)::int AS count FROM teaching_assignments WHERE "userId"='stage-owner'`,
            )
          ).rows[0].count,
          cases.length - 1,
        );
        assert.equal(
          (
            await sql.query(
              `SELECT COUNT(*)::int AS count FROM teaching_assignments WHERE "userId"='stage-owner' AND cohort='2027届'`,
            )
          ).rows[0].count,
          3,
        );
        await sql.query(`DELETE FROM users WHERE id='stage-owner'`);
        console.log(
          "✓ Stage migration splits primary/junior labels, marks senior cohorts and preserves separate same-year scopes",
        );
      } else await sql.query(migration);
    }
    assert.equal(
      await db.teachingAssignment.count({ where: { classroomId: "legacy", role: "HOMEROOM" } }),
      0,
    );
    console.log(
      "✓ Classroom ownership and review collaboration do not implicitly grant teaching identities",
    );
    await db.classroom.delete({ where: { id: "legacy" } });
    const { executeCommand, loadState } = await import("../src/server/platform/service");
    const { executeAdmin, adminCommandSchema } = await import("../src/server/platform/admin");
    const { loadScopedAnalytics } = await import("../src/server/platform/scoped-analytics");
    const { scopePageState } = await import("../src/server/platform/page-state");
    const { enqueueAiJob } = await import("../src/server/platform/ai-jobs");
    const { accessibleAsset, saveImage } = await import("../src/server/platform/assets");
    const { createGradingFeatures } = await import("../src/server/platform/ai/grading");
    for (const id of [
      "admin",
      "school",
      "director",
      "head",
      "subject",
      "combined",
      "outside",
      "student",
    ])
      await db.user.create({
        data: {
          id,
          name: id,
          email: `${id}@test.invalid`,
          role: id === "admin" ? "ADMIN" : id === "student" ? "STUDENT" : "TEACHER",
        },
      });
    const command = (value: PlatformCommand) => executeCommand({ id: "admin" }, value);
    async function grant(id: string, assignments: TeachingAssignment[], actor = "admin") {
      return executeAdmin(
        actor,
        adminCommandSchema.parse({
          type: "user.permissions",
          id,
          assignments,
          expectedVersion: (await db.user.findUniqueOrThrow({ where: { id } })).permissionsVersion,
          reason: "权限边界验收配置",
        }),
      );
    }
    const classes: string[] = [],
      students: string[] = [];
    for (const [index, cohort] of ["2027届", "2027届", "2028届"].entries()) {
      const { id } = await command({
        type: "classroom.save",
        classroom: { name: `${index + 1}班`, stage: "高中", cohort },
      });
      classes.push(id);
      const student = await db.classroomStudent.create({
        data: {
          classroomId: id,
          name: `学生${index + 1}`,
          studentNumber: `00000${index + 1}`,
          ...(index === 0 ? { userId: "student" } : {}),
        },
      });
      students.push(student.id);
    }
    await grant("school", [{ role: "SCHOOL_ADMIN" }]);
    await grant("director", [{ role: "GRADE_DIRECTOR", stage: "高中", cohort: "2027届" }]);
    await grant("head", [{ role: "HOMEROOM", classroomId: classes[0] }]);
    await grant("subject", [{ role: "SUBJECT_TEACHER", classroomId: classes[1], subject: "数学" }]);
    await grant("combined", [
      { role: "HOMEROOM", classroomId: classes[0] },
      { role: "SUBJECT_TEACHER", classroomId: classes[1], subject: "数学" },
    ]);
    await assert.rejects(grant("outside", [{ role: "SCHOOL_ADMIN" }], "school"), /管理员权限/);
    await assert.rejects(grant("student", [{ role: "SCHOOL_ADMIN" }]), /教师账号/);
    await assert.rejects(
      grant("subject", [{ role: "HOMEROOM", classroomId: "nonexistent" }]),
      /班级不存在/,
    );
    await assert.rejects(
      grant("director", [{ role: "GRADE_DIRECTOR", stage: "高中", cohort: "不存在的届别" }]),
      /届别不存在/,
    );
    assert.equal(
      (await loadState({ id: "director" })).actor.teachingAssignments?.[0].role,
      "GRADE_DIRECTOR",
    );
    const papers: string[] = [];
    for (const subject of ["数学", "化学"]) {
      const question = await command({
        type: "question.save",
        question: {
          type: "BLANK",
          subject,
          grade: "高一",
          difficulty: 0.5,
          knowledgeTags: [`${subject}知识点`],
          content: {
            stem: `${subject}题目`,
            options: [],
            answers: ["2"],
            explanation: "解析",
            rubric: "",
            images: [],
            parts: [],
          },
        },
      });
      const paper = await command({
        type: "paper.save",
        paper: {
          name: `${subject}试卷`,
          kind: "EXAM",
          subject,
          grade: "高一",
          instructions: "",
          layout: { paperSize: "A4", columns: 1 },
          items: [{ questionId: question.id, score: 10, section: "" }],
        },
      });
      papers.push(paper.id);
    }
    const configs = papers.map((paperId, index) => ({
      paperId,
      subject: index === 0 ? "数学" : "化学",
      gradingMode: "SINGLE" as const,
      arbitrationThreshold: 0,
      conversion: { enabled: false, bands: [] },
    }));
    const exam = await command({
      type: "assessment.save",
      assessment: {
        name: "跨年级多班多科联考",
        kind: "EXAM",
        reviewScope: "CLASSROOM",
        classroomIds: classes,
        papers: configs,
      },
    });
    const adminPapers = (await loadState({ id: "admin" })).papers;
    const submissionIds: string[][] = [];
    for (const [index, studentId] of students.entries()) {
      submissionIds[index] = [];
      for (const [paperIndex, paperId] of papers.entries()) {
        const itemId = adminPapers.find((p) => p.id === paperId)!.items[0].id;
        const submission = await command({
          type: "submission.save",
          submission: {
            rosterRevision: (
              await db.assessment.findUniqueOrThrow({
                where: { id: exam.id },
                select: { rosterRevision: true },
              })
            ).rosterRevision,
            assessmentId: exam.id,
            paperId,
            studentId,
            kind: "WORKBOOK",
            sourceFiles: [],
            answers: [{ itemId, text: "答案", images: [] }],
          },
        });
        submissionIds[index].push(submission.id);
        await command({
          type: "review.save",
          review: {
            expectedVersion:
              (
                await db.review.findUnique({
                  where: {
                    submissionId_itemId_round: {
                      submissionId: submission.id,
                      itemId: itemId,
                      round: "FIRST",
                    },
                  },
                  select: { version: true },
                })
              )?.version ?? 0,
            submissionId: submission.id,
            itemId,
            round: "FIRST",
            score: 5 + index + paperIndex,
            feedback: "反馈",
          },
        });
      }
    }
    const homework = await db.assessment.create({
      data: {
        ownerId: "admin",
        name: "年级作业",
        kind: "HOMEWORK",
        reviewScope: "CLASSROOM",
        classroomIds: [classes[2]],
        papers: JSON.parse(JSON.stringify([{ ...configs[0] }])),
      },
    });
    assert((await loadState({ id: "school" })).assessments.some((a) => a.id === homework.id));
    assert(!(await loadState({ id: "director" })).assessments.some((a) => a.id === homework.id));
    const admin = await loadState({ id: "admin" });
    for (const [id, expectedClasses, expectedSubs] of [
      ["school", 3, 6],
      ["director", 2, 4],
      ["head", 1, 2],
      ["subject", 1, 1],
      ["combined", 2, 3],
      ["outside", 0, 0],
    ] as const) {
      const state = await loadState({ id, role: "ADMIN" });
      assert.equal(state.classrooms.length, expectedClasses, id);
      assert.equal(state.submissions.length, expectedSubs, id);
      assert.equal(state.reviews.length, expectedSubs, id);
      assert.equal(state.reviewHistory?.length, expectedSubs, id);
      assert.equal(
        state.analytics.results
          .filter((r) => r.assessmentId === exam.id)
          .reduce((n, r) => n + r.subjects.length, 0),
        expectedSubs,
        id,
      );
      assert.equal(
        state.analytics.students.reduce((n, r) => n + r.wrongQuestions.length, 0),
        expectedSubs,
        id,
      );
      const page = scopePageState(state, "exams");
      assert.equal(
        page.analytics.results.reduce((n, r) => n + r.subjects.length, 0),
        expectedSubs,
        `${id} page`,
      );
    }
    const combined = await loadState({ id: "combined" });
    const partial = combined.analytics.results.find((r) => r.studentId === students[1])!;
    assert.equal(partial.total, null);
    assert.equal(partial.rank, null);
    assert.equal(partial.classRank, null);
    assert.equal(partial.subjects.length, 1);
    assert.equal(
      partial.subjects[0].rank,
      admin.analytics.results
        .find((r) => r.studentId === students[1])!
        .subjects.find((s) => s.subject === "数学")!.rank,
    );
    assert.equal(combined.analytics.results.find((r) => r.studentId === students[0])!.total, 11);
    assert.equal(
      combined.analytics.students.find((r) => r.studentId === students[1])!.knowledge.length,
      1,
    );
    assert(
      !JSON.stringify(
        combined.analytics.students.find((r) => r.studentId === students[1]),
      ).includes("化学"),
    );
    const scoped = await loadScopedAnalytics(
      { id: "combined" },
      { classroomId: classes[1], assessmentId: exam.id },
    );
    assert.equal(scoped.results[0].subjects.length, 1);
    assert.equal(scoped.results[0].total, null);
    assert(!JSON.stringify(scoped).includes("化学"));
    await assert.rejects(
      loadScopedAnalytics({ id: "director" }, { classroomId: classes[2] }),
      /班级不存在/,
    );
    console.log(
      "✓ School, grade, homeroom, subject and overlapping scopes filter tasks, rosters, scores, reviews, knowledge and wrong questions; official subject ranks survive",
    );
    await assert.rejects(
      enqueueAiJob("school", {
        kind: "GRADE",
        modelId: "unused-model",
        input: {
          rosterRevision: (
            await db.assessment.findUniqueOrThrow({
              where: { id: exam.id },
              select: { rosterRevision: true },
            })
          ).rosterRevision,
          assessmentId: exam.id,
          classroomId: classes[1],
          paperId: papers[0],
          submissionIds: [submissionIds[1][0]],
        },
      }),
      /不存在|无权访问|批改权限/,
    );
    const itemId = adminPapers.find((p) => p.id === papers[1])!.items[0].id;
    await assert.rejects(
      executeCommand(
        { id: "subject" },
        {
          type: "review.save",
          review: {
            expectedVersion:
              (
                await db.review.findUnique({
                  where: {
                    submissionId_itemId_round: {
                      submissionId: submissionIds[1][1],
                      itemId: itemId,
                      round: "FIRST",
                    },
                  },
                  select: { version: true },
                })
              )?.version ?? 0,
            submissionId: submissionIds[1][1],
            itemId,
            round: "FIRST",
            score: 1,
            feedback: "越权",
          },
        },
      ),
      /无权访问/,
    );
    await assert.rejects(
      executeCommand(
        { id: "subject" },
        {
          type: "submission.save",
          submission: {
            rosterRevision: (
              await db.assessment.findUniqueOrThrow({
                where: { id: exam.id },
                select: { rosterRevision: true },
              })
            ).rosterRevision,
            assessmentId: exam.id,
            paperId: papers[1],
            studentId: students[1],
            kind: "WORKBOOK",
            sourceFiles: [],
            answers: [],
          },
        },
      ),
      /不属于|无权访问/,
    );
    await db.classroom.update({
      where: { id: classes[1] },
      data: { ownerId: "subject" },
    });
    await db.assessment.update({ where: { id: exam.id }, data: { ownerId: "subject" } });
    await assert.rejects(
      executeCommand(
        { id: "subject" },
        {
          type: "classroom.save",
          classroom: { id: classes[1], name: "2班", stage: "高中", cohort: "2028届" },
        },
      ),
      /只能由管理员/,
    );
    assert.equal(
      (await db.classroom.findUniqueOrThrow({ where: { id: classes[1] } })).cohort,
      "2027届",
    );
    assert.equal((await loadState({ id: "subject" })).submissions.length, 1);
    assert.equal((await loadState({ id: "outside" })).assessments.length, 0);
    await assert.rejects(
      executeCommand(
        { id: "subject" },
        { type: "assessment.publish", id: exam.id, published: true },
      ),
      /无权访问/,
    );
    await db.assessment.update({ where: { id: exam.id }, data: { published: true } });
    await assert.rejects(
      executeCommand(
        { id: "subject" },
        { type: "assessment.publish", id: exam.id, published: false },
      ),
      /无权访问/,
    );
    assert.equal(
      (await db.assessment.findUniqueOrThrow({ where: { id: exam.id } })).published,
      true,
    );
    await command({ type: "assessment.publish", id: exam.id, published: false });
    await grant("combined", [
      { role: "SUBJECT_TEACHER", classroomId: classes[1], subject: "数学" },
    ]);
    assert.equal((await loadState({ id: "combined" })).classrooms.length, 1);
    await grant("combined", []);
    assert.equal((await loadState({ id: "combined" })).submissions.length, 0);
    await assert.rejects(
      loadScopedAnalytics({ id: "combined" }, { assessmentId: exam.id }),
      /考试不存在/,
    );
    await executeAdmin("admin", {
      type: "user.role",
      id: "director",
      role: "STUDENT",
      expectedVersion: (await db.user.findUniqueOrThrow({ where: { id: "director" } }))
        .permissionsVersion,
      reason: "验收角色变更清理身份",
    });
    await executeAdmin("admin", {
      type: "user.role",
      id: "director",
      role: "TEACHER",
      expectedVersion: (await db.user.findUniqueOrThrow({ where: { id: "director" } }))
        .permissionsVersion,
      reason: "验收重新授予教师角色不恢复旧身份",
    });
    assert.equal((await loadState({ id: "director" })).classrooms.length, 0);
    console.log(
      "✓ Forged roles, cross-subject writes, legacy sharing, ownership, partial publishing, revocation and stale grants after role changes cannot bypass authorization",
    );
    await db.assessment.update({ where: { id: exam.id }, data: { published: true } });
    const student = await loadState({ id: "student" });
    assert.equal(student.submissions.length, 2);
    assert.equal(student.classrooms[0].students.length, 1);
    assert.equal(student.analytics.results.length, 1);
    assert.equal(student.users.length, 0);
    assert.equal(student.reviews.length, 0);
    console.log("✓ Students retain access only to their own published results");
    for (const stage of ["小学", "初中"] as const) {
      const otherStage = await command({
        type: "classroom.save",
        classroom: { name: "同年毕业验收班", stage, cohort: "2027届" },
      });
      assert(
        !(await loadState({ id: "director" })).classrooms.some((c) => c.id === otherStage.id),
        "Senior director cannot read a different stage with the same cohort year",
      );
      await assert.rejects(
        command({
          type: "assessment.save",
          assessment: {
            name: "跨学段错误配置",
            kind: "EXAM",
            reviewScope: "GRADE",
            classroomIds: [classes[0], otherStage.id],
            papers: configs,
          },
        }),
        /同一学段、同一届别/,
      );
      await grant("outside", [{ role: "GRADE_DIRECTOR", stage, cohort: "2027届" }]);
      assert.deepEqual(
        (await loadState({ id: "outside" })).classrooms.map((c) => c.id),
        [otherStage.id],
      );
      await grant("outside", []);
      await db.classroom.delete({ where: { id: otherStage.id } });
      await assert.rejects(
        grant("outside", [{ role: "GRADE_DIRECTOR", stage, cohort: "2027届" }]),
        /届别不存在/,
      );
    }
    console.log(
      "✓ Same-year primary, junior and senior scopes stay isolated in director grants and joint exams",
    );
    const gradeExam = await command({
      type: "assessment.save",
      assessment: {
        name: "高一统一阅卷",
        kind: "EXAM",
        reviewScope: "GRADE",
        classroomIds: classes.slice(0, 2),
        papers: configs.map((p) => ({ ...p, gradingMode: "DOUBLE", arbitrationThreshold: 1 })),
      },
    });
    await assert.rejects(
      command({
        type: "assessment.save",
        assessment: {
          name: "跨年级错误配置",
          kind: "EXAM",
          reviewScope: "GRADE",
          classroomIds: [classes[0], classes[2]],
          papers: configs,
        },
      }),
      /同一学段、同一届别/,
    );
    await assert.rejects(
      command({
        type: "assessment.save",
        assessment: {
          name: "作业错误配置",
          kind: "HOMEWORK",
          reviewScope: "GRADE",
          classroomIds: [classes[0]],
          papers: configs,
        },
      }),
      /作业使用班级/,
    );
    const gradeSubs: string[][] = [];
    for (const [classIndex, studentId] of students.slice(0, 2).entries()) {
      gradeSubs[classIndex] = [];
      for (const paperId of papers) {
        const submission = await command({
          type: "submission.save",
          submission: {
            rosterRevision: (
              await db.assessment.findUniqueOrThrow({
                where: { id: gradeExam.id },
                select: { rosterRevision: true },
              })
            ).rosterRevision,
            assessmentId: gradeExam.id,
            paperId,
            studentId,
            kind: "WORKBOOK",
            sourceFiles: [],
            answers: [],
          },
        });
        gradeSubs[classIndex].push(submission.id);
      }
    }
    const reviewState = await loadState({ id: "subject" }, db, { reviewing: true });
    assert(
      reviewState.users.every((user) => user.role !== "STUDENT"),
      "Marking does not expose student account directories",
    );
    await db.user.create({
      data: {
        id: "late-account",
        name: "后转入",
        email: "late-account@test.invalid",
        role: "STUDENT",
      },
    });
    const lateStudent = await db.classroomStudent.create({
      data: {
        classroomId: classes[0],
        userId: "late-account",
        name: "后转入",
        studentNumber: "000099",
      },
    });
    const afterEnrollment = await loadState({ id: "subject" }, db, { reviewing: true });
    assert(!afterEnrollment.users.some((u) => u.id === "late-account"));
    assert(afterEnrollment.classrooms.some((c) => c.students.some((s) => s.id === lateStudent.id)));
    const asset = await saveImage(
      "admin",
      await sharp({
        create: {
          width: 20,
          height: 20,
          channels: 3,
          background: "white",
        },
      })
        .png()
        .toBuffer(),
      "跨班数学作答",
    );
    await db.scanSubmission.update({
      where: { id: gradeSubs[0][0] },
      data: { sourceFiles: [asset.url] },
    });
    assert((await accessibleAsset("subject", asset.id)).buffer.length > 0);
    await assert.rejects(accessibleAsset("outside", asset.id), /图片不存在/);
    const chemistryAsset = await saveImage(
      "admin",
      await sharp({
        create: {
          width: 20,
          height: 20,
          channels: 3,
          background: "blue",
        },
      })
        .png()
        .toBuffer(),
      "无权访问的化学作答",
    );
    await db.scanSubmission.update({
      where: { id: gradeSubs[0][1] },
      data: { sourceFiles: [chemistryAsset.url] },
    });
    await assert.rejects(accessibleAsset("subject", chemistryAsset.id), /图片不存在/);
    assert.deepEqual(
      reviewState.submissions
        .filter((s) => s.assessmentId === gradeExam.id)
        .map((s) => s.id)
        .sort(),
      gradeSubs.map((row) => row[0]).sort(),
    );
    assert.equal(reviewState.submissions.filter((s) => s.assessmentId === exam.id).length, 1);
    assert.equal(reviewState.classrooms.length, 2);
    assert.equal(reviewState.analytics.students.length, 0);
    assert.equal(reviewState.analytics.knowledge.length, 0);
    assert(
      reviewState.analytics.results.every(
        (r) => r.total === null && r.rank === null && r.subjects.every((s) => s.subject === "数学"),
      ),
    );
    assert(
      !reviewState.submissions.some((s) => s.id === submissionIds[0][0]),
      "Local exams must not grant cross-class marking",
    );
    assert(
      !reviewState.assessments.some((a) => a.id === homework.id),
      "Unrelated homework must stay hidden",
    );
    const normal = await loadState({ id: "subject" });
    assert(
      !normal.submissions.some((s) => s.id === gradeSubs[0][0]),
      "Marking rights do not broaden report visibility",
    );
    assert.equal(
      scopePageState(reviewState, "exams").submissions.length,
      reviewState.submissions.length,
    );
    await assert.rejects(loadState({ id: "student" }, db, { reviewing: true }), /教师权限/);
    const extraClass = await command({
      type: "classroom.save",
      classroom: { name: "未参试三班", stage: "高中", cohort: "2027届" },
    });
    await db.user.create({
      data: {
        id: "grade-peer",
        name: "同年级数学老师",
        email: "grade-peer@test.invalid",
        role: "TEACHER",
      },
    });
    await grant("grade-peer", [
      { role: "SUBJECT_TEACHER", classroomId: extraClass.id, subject: "数学" },
    ]);
    await command({
      type: "classroom.save",
      classroom: { id: extraClass.id, name: "未参试三班", stage: "高中", cohort: "2028届" },
    });
    assert(
      !(await loadState({ id: "grade-peer" }, db, { reviewing: true })).assessments.some(
        (a) => a.id === gradeExam.id,
      ),
    );
    await command({
      type: "classroom.save",
      classroom: { id: extraClass.id, name: "未参试三班", stage: "高中", cohort: "2027届" },
    });
    await grant("outside", [{ role: "SUBJECT_TEACHER", classroomId: classes[2], subject: "数学" }]);
    assert(
      (await loadState({ id: "grade-peer" }, db, { reviewing: true })).submissions.some(
        (s) => s.id === gradeSubs[0][0],
      ),
      "Teachers from nonparticipating classes in the same grade join the pool",
    );
    assert(
      !(await loadState({ id: "outside" }, db, { reviewing: true })).assessments.some(
        (a) => a.id === gradeExam.id,
      ),
    );
    const mathItemId = adminPapers.find((p) => p.id === papers[0])!.items[0].id;
    async function mark(
      id: string,
      submissionId: string,
      round: "FIRST" | "SECOND" | "ARBITRATION",
      score: number,
      targetItem = mathItemId,
    ) {
      return executeCommand(
        { id },
        {
          type: "review.save",
          review: {
            expectedVersion:
              (
                await db.review.findUnique({
                  where: {
                    submissionId_itemId_round: {
                      submissionId: submissionId,
                      itemId: targetItem,
                      round: round,
                    },
                  },
                  select: { version: true },
                })
              )?.version ?? 0,
            submissionId,
            itemId: targetItem,
            round,
            score,
            feedback: "范围验证",
          },
        },
      );
    }
    await assert.rejects(mark("subject", submissionIds[0][0], "FIRST", 2), /无权访问/);
    await assert.rejects(mark("subject", gradeSubs[0][1], "FIRST", 2, itemId), /无权访问/);
    await assert.rejects(mark("outside", gradeSubs[0][0], "FIRST", 2), /无权访问/);
    await assert.rejects(mark("head", gradeSubs[0][0], "FIRST", 2), /无权访问/);
    const gradeInput = {
      rosterRevision: (
        await db.assessment.findUniqueOrThrow({
          where: { id: gradeExam.id },
          select: { rosterRevision: true },
        })
      ).rosterRevision,
      assessmentId: gradeExam.id,
      classroomId: classes[1],
      paperId: papers[0],
      submissionIds: [gradeSubs[1][0]],
    };
    const gradeJob = await db.aiJob.create({
      data: {
        userId: "grade-peer",
        kind: "GRADE",
        modelId: "unused-model",
        status: "RUNNING",
        input: gradeInput,
      },
    });
    const grader = await createGradingFeatures({
      userId: "grade-peer",
      input: gradeInput,
      jobId: gradeJob.id,
    });
    try {
      await grader.run({
        agent: async () => {
          throw new Error("考试不应启动 Agent");
        },
        model: async () => ({
          grades: [{ itemId: mathItemId, score: 8, feedback: "跨班AI首评", partScores: [] }],
          skipped: [],
        }),
      });
      await grant("grade-peer", []);
      await assert.rejects(grader.commit(), /无权访问|批改权限/);
      assert.equal(await db.review.count({ where: { submissionId: gradeSubs[1][0] } }), 0);
      assert.equal(
        (await db.aiJob.findUniqueOrThrow({ where: { id: gradeJob.id } })).status,
        "RUNNING",
      );
      await grant("grade-peer", [
        { role: "SUBJECT_TEACHER", classroomId: extraClass.id, subject: "数学" },
      ]);
    } finally {
      await grader.dispose();
    }
    await mark("subject", gradeSubs[0][0], "FIRST", 2);
    await assert.rejects(mark("subject", gradeSubs[0][0], "SECOND", 8), /不同教师/);
    await mark("grade-peer", gradeSubs[0][0], "SECOND", 8);
    await assert.rejects(mark("grade-peer", gradeSubs[0][0], "ARBITRATION", 6), /第三位教师/);
    await mark("admin", gradeSubs[0][0], "ARBITRATION", 6);
    const marked = (
      await loadState({ id: "subject" }, db, { reviewing: true })
    ).analytics.results.find(
      (r) => r.assessmentId === gradeExam.id && r.studentId === students[0],
    )!;
    assert.equal(marked.subjects[0].grades[0].score, 7);
    await grant("subject", []);
    await assert.rejects(accessibleAsset("subject", asset.id), /图片不存在/);
    assert.equal(
      (await loadState({ id: "subject" }, db, { reviewing: true })).submissions.length,
      0,
    );
    await assert.rejects(mark("subject", gradeSubs[0][0], "FIRST", 3), /无权访问/);
    console.log(
      "✓ Grade pools mark only their subject across participating classes; local exams, other grades and reports remain isolated; all markers can double-review, independent arbitration and revocation hold",
    );
  } finally {
    const assets = await db.platformAsset.findMany({ select: { path: true } }).catch(() => []);
    await Promise.all(assets.map((row) => rm(row.path, { force: true })));
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
