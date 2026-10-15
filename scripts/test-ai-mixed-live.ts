import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import sharp from "sharp";
import { loadEnvironment } from "./load-env.mjs";
import type { PlatformCommand } from "../src/contracts/platform";
loadEnvironment();

async function main() {
  const { getDb } = await import("../src/server/db/client");
  const { PrismaClient } = await import("../src/generated/prisma/client");
  const source = await getDb().aiModel.findFirstOrThrow({
    where: process.env.AI_LIVE_MODEL_ID
      ? { id: process.env.AI_LIVE_MODEL_ID }
      : { name: "ark-code-latest" },
    include: { provider: true },
  });
  const schema = `mixed_live_${randomUUID().replaceAll("-", "")}`;
  const sql = new pg.Client({ connectionString: process.env.DATABASE_URL });
  const db = new PrismaClient({
    adapter: new PrismaPg(
      { connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}` },
      { schema },
    ),
  });
  const globalDb = globalThis as typeof globalThis & {
    paperDb?: InstanceType<typeof PrismaClient>;
  };
  const previous = globalDb.paperDb;
  globalDb.paperDb = db;
  const events: unknown[] = [];
  try {
    await sql.connect();
    await sql.query(`CREATE SCHEMA "${schema}"`);
    await sql.query(`SET search_path TO "${schema}"`);
    for (const name of (await readdir("prisma/migrations"))
      .filter((name) => /^\d/.test(name))
      .sort())
      await sql.query(await readFile(join("prisma/migrations", name, "migration.sql"), "utf8"));
    for (const id of ["teacher", "second"])
      await db.user.create({
        data: { id, name: id, email: `${id}@mixed.invalid`, role: "TEACHER" },
      });
    await db.user.create({
      data: { id: "student", name: "学生", email: "student@mixed.invalid", role: "STUDENT" },
    });
    const provider = await db.aiProvider.create({
      data: {
        name: source.provider.name,
        apiType: source.provider.apiType,
        baseURL: source.provider.baseURL,
        encryptedApiKey: source.provider.encryptedApiKey,
        maxOutputTokens: 16384,
        timeoutSeconds: 240,
        maxConcurrency: 1,
      },
    });
    const model = await db.aiModel.create({
      data: {
        providerId: provider.id,
        name: source.name,
        reasoningEfforts: ["default"],
        reasoningEffort: source.reasoningEffort,
        isPublic: true,
      },
    });
    const { executeCommand, loadState } = await import("../src/server/platform/service");
    const { saveImage } = await import("../src/server/platform/assets");
    const { runAiTask } = await import("../src/server/platform/ai/runner");
    const command = (command: PlatformCommand) => executeCommand({ id: "teacher" }, command);
    const questionId = (
      await command({
        type: "question.save",
        question: {
          type: "MIXED",
          subject: "数学",
          grade: "高一",
          difficulty: 0.4,
          knowledgeTags: [],
          content: {
            stem: "矩形的长为4，宽为3。回答两小问。",
            options: [],
            answers: [],
            explanation: "",
            rubric: "逐小问独立评分",
            images: [],
            parts: [
              {
                id: "1",
                type: "BLANK",
                stem: "矩形面积为____。",
                options: [],
                answers: ["12"],
                explanation: "4×3=12",
                rubric: "答案12得2分，其他答案0分。",
                score: 2,
                knowledgeTags: ["矩形面积"],
              },
              {
                id: "2",
                type: "SUBJECTIVE",
                stem: "求周长并写出计算方法。",
                options: [],
                answers: ["2(4+3)=14"],
                explanation: "长宽和乘2",
                rubric: "周长公式2分、代入及正确结果1分。接受等价正确方法。",
                score: 3,
                knowledgeTags: ["矩形周长"],
              },
            ],
          },
        },
      })
    ).id;
    const paperId = (
      await command({
        type: "paper.save",
        paper: {
          name: "混合题实测",
          kind: "EXAM",
          subject: "数学",
          grade: "高一",
          instructions: "",
          layout: { paperSize: "A4", columns: 1 },
          items: [{ questionId, score: 5, section: "综合" }],
        },
      })
    ).id;
    const classroomId = (
      await command({
        type: "classroom.save",
        classroom: { name: "实测班", stage: "高中", cohort: "2027届" },
      })
    ).id;
    await db.teachingAssignment.createMany({
      data: ["teacher", "second"].map((userId) => ({
        userId,
        role: "SUBJECT_TEACHER",
        classroomId,
        subject: "数学",
      })),
    });
    const studentId = (
      await command({
        type: "student.save",
        student: { classroomId, studentNumber: "000001", name: "学生", userId: "student" },
      })
    ).id;
    const assessmentId = (
      await command({
        type: "assessment.save",
        assessment: {
          name: "混合双评",
          kind: "EXAM",
          reviewScope: "CLASSROOM",
          classroomIds: [classroomId],
          papers: [
            {
              paperId,
              subject: "数学",
              gradingMode: "DOUBLE",
              arbitrationThreshold: 1,
              conversion: { enabled: false, bands: [] },
            },
          ],
        },
      })
    ).id;
    const paper = (await loadState({ id: "teacher" })).papers.find(
      (paper) => paper.id === paperId,
    )!;
    const answerImage = await saveImage(
      "teacher",
      await sharp(
        Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="700" height="260"><rect width="700" height="260" fill="white"/><g font-family="sans-serif" font-size="35" fill="black"><text x="30" y="80">(1) 10</text><text x="30" y="160">(2) P = 2 (4 + 3) = 14</text></g></svg>`,
        ),
      )
        .png()
        .toBuffer(),
      "mixed-student.png",
    );
    const submissionId = (
      await command({
        type: "submission.save",
        submission: {
          assessmentId,
          paperId,
          studentId,
          kind: "WORKBOOK",
          sourceFiles: [answerImage.url],
          answers: [{ itemId: paper.items[0].id, text: "", images: [answerImage.url] }],
        },
      })
    ).id;
    const input = { assessmentId, classroomId, paperId, submissionIds: [submissionId] };
    const job = await db.aiJob.create({
      data: {
        userId: "teacher",
        kind: "GRADE",
        modelId: model.id,
        input,
        status: "RUNNING",
        heartbeatAt: new Date(),
      },
    });
    console.log(`Live mixed GRADE started with ${model.name}`);
    const result = await runAiTask({
      userId: "teacher",
      kind: "GRADE",
      input,
      modelId: model.id,
      jobId: job.id,
      onEvent: async (event) => {
        events.push(event);
        const row = event as { type?: string; name?: string; status?: string };
        if (row.type === "tool" && row.status === "started") console.log(row.name);
      },
    });
    const first = await db.review.findFirstOrThrow({ where: { submissionId, round: "FIRST" } });
    assert.equal(first.source, "AI");
    assert.equal(first.score, 3);
    const parts = first.partScores as { partId: string; score: number; feedback: string }[];
    assert.deepEqual(parts.map((part) => [part.partId, part.score]).sort(), [
      ["1", 0],
      ["2", 3],
    ]);
    assert.equal(
      (await db.scanSubmission.findUniqueOrThrow({ where: { id: submissionId } })).status,
      "REVIEW",
    );
    await executeCommand(
      { id: "second" },
      {
        type: "review.save",
        review: {
          submissionId,
          itemId: paper.items[0].id,
          round: "SECOND",
          score: 3,
          feedback: "人工独立复核",
          partScores: [
            { partId: "1", score: 0, feedback: "面积错误" },
            { partId: "2", score: 3, feedback: "周长正确" },
          ],
        },
      },
    );
    await command({ type: "assessment.publish", id: assessmentId, published: true });
    const report = (await loadState({ id: "student" })).analytics.students[0];
    assert.equal(report.knowledge.find((point) => point.tag === "矩形面积")!.accuracy, 0);
    assert.equal(report.knowledge.find((point) => point.tag === "矩形周长")!.accuracy, 1);
    assert.deepEqual(report.wrongQuestions[0].wrongPartIds, ["1"]);
    await mkdir("tmp", { recursive: true });
    await writeFile(
      "tmp/ai-mixed-live-evidence.json",
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          model: model.name,
          success: true,
          summary: result.summary,
          assertions: [
            "AI读取真实图像后独立保存两个小问的0/2和3/3",
            "人工不同教师第二评后发布",
            "学生面积掌握率0%，周长100%，仅小问1进入错题",
          ],
          events,
        },
        null,
        2,
      ),
    );
    console.log(
      "✓ Live mixed AI grading, independent second review and precise student knowledge analytics passed.",
    );
  } finally {
    const assets = await db.platformAsset
      .findMany({ where: { ownerId: "teacher" }, select: { path: true } })
      .catch(() => []);
    await Promise.all(assets.map((asset) => rm(asset.path, { force: true })));
    globalDb.paperDb = previous;
    await db.$disconnect();
    await sql.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await sql.end();
    await previous?.$disconnect();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
