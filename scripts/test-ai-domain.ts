import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import sharp from "sharp";
import { loadEnvironment } from "./load-env.mjs";
import type { BankQuestion, PlatformCommand } from "../src/contracts/platform";
loadEnvironment();
async function main() {
  const schema = `ai_domain_${randomUUID().replaceAll("-", "")}`;
  const root = await mkdtemp(join(tmpdir(), "omp-ai-domain-"));
  process.env.STORAGE_ROOT = root;
  process.env.TEMP_ROOT = join(root, "tmp");
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
    const { createTaskFeatures } = await import("../src/server/platform/ai/features");
    const { saveImage } = await import("../src/server/platform/assets");
    for (const id of ["teacher", "second"])
      await db.user.create({ data: { id, name: id, email: `${id}@domain.test`, role: "TEACHER" } });
    await db.user.create({
      data: { id: "account", name: "学生", email: "account@domain.test", role: "STUDENT" },
    });
    const actor = { id: "teacher" },
      command = (cmd: PlatformCommand) => executeCommand(actor, cmd);
    const call = async (
      f: Awaited<ReturnType<typeof createTaskFeatures>>,
      name: string,
      input: unknown,
    ) => {
      const tool = f.tools[name];
      if (!tool?.execute) throw new Error(`Tool missing: ${name}`);
      return tool.execute(input, { toolCallId: randomUUID(), messages: [], context: undefined });
    };
    const makeJob = async (kind: string, input: unknown) =>
      db.aiJob.create({
        data: {
          userId: "teacher",
          kind,
          modelId: "unused-fixture",
          input: JSON.parse(JSON.stringify(input)),
          status: "RUNNING",
          heartbeatAt: new Date(),
        },
      });
    const content: BankQuestion["content"] = {
      stem: "识别图中函数，并计算两处空白。",
      options: [],
      answers: ["2", "4"],
      explanation: "根据函数图像读取",
      rubric: "每空5分",
      parts: [],
      images: [],
    };
    const source = await saveImage(
      "teacher",
      await sharp({ create: { width: 600, height: 800, channels: 3, background: "white" } })
        .png()
        .toBuffer(),
      "试题来源.png",
    );
    const importInput = { assetUrls: [source.url], subject: "数学", grade: "高一" };
    const importJob = await makeJob("IMPORT", importInput),
      importer = await createTaskFeatures({
        userId: "teacher",
        kind: "IMPORT",
        input: importInput,
        jobId: importJob.id,
      });
    await call(importer, "inspect_image", { url: source.url });
    await call(importer, "record_source_inventory", {
      sources: [{ url: source.url, totalQuestions: 1 }],
    });
    const crop = (await call(importer, "crop_material", {
      url: source.url,
      box: { x: 0.1, y: 0.2, width: 0.3, height: 0.25 },
    })) as { url: string };
    await call(importer, "propose_question", {
      sourceKey: "page1:q1",
      question: {
        type: "BLANK",
        subject: "数学",
        grade: "高一",
        difficulty: 0.5,
        knowledgeTags: ["函数"],
        content: { ...content, images: [crop.url] },
      },
    });
    await call(importer, "finish", { summary: "导入完成" });
    assert.equal(await db.question.count(), 0);
    assert.equal(await db.platformAsset.count(), 1);
    await importer.commit();
    assert.equal(await db.question.count(), 1);
    assert.equal(await db.platformAsset.count(), 2);
    assert.equal(
      (await db.aiJob.findUniqueOrThrow({ where: { id: importJob.id } })).status,
      "COMPLETED",
    );
    const storedCrop = await db.platformAsset.findUniqueOrThrow({
      where: { id: crop.url.split("/").at(-1) },
    });
    const cropMeta = await sharp(await readFile(storedCrop.path)).metadata();
    assert.equal(cropMeta.width, 180);
    assert.equal(cropMeta.height, 200);
    console.log(
      "✓ IMPORT stages source inventory and actual cropped pixels, then commits independent image assets, question and job completion atomically",
    );
    const imported = (await loadState(actor)).questions[0];
    const enrichInput = { questionIds: [imported.id] },
      enrichJob = await makeJob("ENRICH", enrichInput),
      enricher = await createTaskFeatures({
        userId: "teacher",
        kind: "ENRICH",
        input: enrichInput,
        jobId: enrichJob.id,
      });
    await call(enricher, "read_question", { questionId: imported.id });
    await call(enricher, "inspect_image", { url: crop.url });
    await call(enricher, "propose_enrichment", {
      questionId: imported.id,
      knowledgeTags: ["函数图像"],
      answers: ["2", "4"],
      explanation: "两个空分别对应图像读数。",
      rubric: "每空5分",
      parts: [],
    });
    await call(enricher, "finish", { summary: "enriched" });
    await command({
      type: "question.save",
      question: { ...imported, content: { ...imported.content, stem: "人工已修改题干" } },
    });
    await assert.rejects(enricher.commit(), /题目已被修改/);
    assert.equal(
      (await db.aiJob.findUniqueOrThrow({ where: { id: enrichJob.id } })).status,
      "RUNNING",
    );
    assert.equal((await loadState(actor)).questions[0].content.stem, "人工已修改题干");
    console.log("✓ ENRICH refuses stale content instead of overwriting an intervening manual edit");
    const mixedId = (
      await command({
        type: "question.save",
        question: {
          type: "MIXED",
          subject: "数学",
          grade: "高一",
          difficulty: 0.5,
          knowledgeTags: ["函数"],
          content: {
            ...content,
            stem: "混合题",
            answers: [],
            parts: [
              {
                id: "1",
                type: "BLANK",
                stem: "两个空",
                options: [],
                answers: ["2", "4"],
                explanation: "读取",
                rubric: "每空2分",
                knowledgeTags: ["函数"],
                score: 4,
              },
              {
                id: "2",
                type: "SUBJECTIVE",
                stem: "解释原因",
                options: [],
                answers: ["正确解释"],
                explanation: "概念",
                rubric: "按解释步骤给分",
                knowledgeTags: ["函数性质"],
                score: 6,
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
          name: "混合阅卷",
          kind: "EXAM",
          subject: "数学",
          grade: "高一",
          instructions: "",
          layout: { paperSize: "A4", columns: 1 },
          items: [{ questionId: mixedId, score: 10, section: "综合" }],
        },
      })
    ).id;
    const classroomId = (
      await command({
        type: "classroom.save",
        classroom: { name: "班级", grade: "高一", reviewerIds: ["second"] },
      })
    ).id;
    const studentId = (
      await command({
        type: "student.save",
        student: { classroomId, name: "学生", studentNumber: "000001", userId: "account" },
      })
    ).id;
    const assessmentId = (
      await command({
        type: "assessment.save",
        assessment: {
          name: "双评",
          kind: "EXAM",
          classroomIds: [classroomId],
          papers: [
            {
              paperId,
              subject: "数学",
              gradingMode: "DOUBLE",
              arbitrationThreshold: 2,
              conversion: { enabled: false, bands: [] },
            },
          ],
        },
      })
    ).id;
    const paper = (await loadState(actor)).papers.find((p) => p.id === paperId)!;
    const submissionId = (
      await command({
        type: "submission.save",
        submission: {
          assessmentId,
          paperId,
          studentId,
          kind: "WORKBOOK",
          sourceFiles: [],
          answers: [{ itemId: paper.items[0].id, text: "2，4。原因解释正确", images: [] }],
        },
      })
    ).id;
    const gradeInput = { submissionId },
      gradeJob = await makeJob("GRADE", gradeInput),
      grader = await createTaskFeatures({
        userId: "teacher",
        kind: "GRADE",
        input: gradeInput,
        jobId: gradeJob.id,
      });
    await call(grader, "read_answer", { itemId: paper.items[0].id });
    await call(grader, "propose_grade", {
      itemId: paper.items[0].id,
      score: 5,
      feedback: "第二小问解释错误",
      parts: [
        { partId: "1", score: 4, feedback: "两个空正确" },
        { partId: "2", score: 1, feedback: "解释错误" },
      ],
    });
    await call(grader, "finish", { summary: "AI首评完成" });
    await grader.commit();
    const first = await db.review.findFirstOrThrow({ where: { submissionId } });
    assert.equal(first.source, "AI");
    assert.equal(first.aiJobId, gradeJob.id);
    assert.equal(first.round, "FIRST");
    assert(first.feedback.includes("(1) 4分"));
    assert.equal(
      (await db.scanSubmission.findUniqueOrThrow({ where: { id: submissionId } })).status,
      "REVIEW",
    );
    await assert.rejects(
      executeCommand(
        actor,
        {
          type: "review.save",
          review: {
            submissionId,
            itemId: paper.items[0].id,
            round: "SECOND",
            score: 9,
            feedback: "",
          },
        },
        { source: "AI", jobId: gradeJob.id },
      ),
      /已结束/,
    );
    await executeCommand(
      { id: "second" },
      {
        type: "review.save",
        review: {
          submissionId,
          itemId: paper.items[0].id,
          round: "SECOND",
          score: 5,
          partScores: [
            { partId: "1", score: 4, feedback: "两个空正确" },
            { partId: "2", score: 1, feedback: "解释错误" },
          ],
          feedback: "人工独立第二评",
        },
      },
    );
    assert.equal(
      (await db.scanSubmission.findUniqueOrThrow({ where: { id: submissionId } })).status,
      "GRADED",
    );
    assert.equal(
      (await db.review.findFirstOrThrow({ where: { submissionId, round: "SECOND" } })).source,
      "HUMAN",
    );
    const precise = (await loadState(actor)).analytics.students.find(
      (s) => s.studentId === studentId,
    )!;
    assert.equal(precise.knowledge.find((k) => k.tag === "函数")!.accuracy, 1);
    assert(
      Math.abs(precise.knowledge.find((k) => k.tag === "函数性质")!.accuracy - 1 / 6) < 0.000001,
    );
    assert.deepEqual(precise.wrongQuestions[0].wrongPartIds, ["2"]);
    assert.deepEqual(
      precise.wrongQuestions[0].partScores?.map((p) => p.score),
      [4, 1],
    );
    console.log(
      "✓ Mixed part scores persist through AI FIRST and independent human SECOND; correct subpart stays mastered and only the failed subpart enters weaknesses",
    );
    const beforeQuestions = await db.question.count(),
      beforeAssets = await db.platformAsset.count(),
      beforeFiles = await readdir(join(root, "platform-assets"));
    const badJob = await makeJob("IMPORT", importInput),
      bad = await createTaskFeatures({
        userId: "teacher",
        kind: "IMPORT",
        input: importInput,
        jobId: badJob.id,
      });
    await call(bad, "inspect_image", { url: source.url });
    await call(bad, "record_source_inventory", {
      sources: [{ url: source.url, totalQuestions: 1 }],
    });
    const doomedCrop = (await call(bad, "crop_material", {
      url: source.url,
      box: { x: 0, y: 0, width: 0.2, height: 0.2 },
    })) as { url: string };
    await call(bad, "propose_question", {
      sourceKey: "q",
      question: {
        type: "BLANK",
        subject: "数学",
        grade: "高一",
        difficulty: 0.5,
        knowledgeTags: ["函数"],
        content: { ...content, images: [doomedCrop.url] },
      },
    });
    await call(bad, "finish", { summary: "will fail" });
    // Permission changes while an agent runs must invalidate its commit, including already written crop assets.
    await db.user.update({ where: { id: "teacher" }, data: { role: "STUDENT" } });
    await assert.rejects(bad.commit(), /教师权限/);
    await db.user.update({ where: { id: "teacher" }, data: { role: "TEACHER" } });
    assert.equal(await db.question.count(), beforeQuestions);
    assert.equal(await db.platformAsset.count(), beforeAssets);
    assert.deepEqual((await readdir(join(root, "platform-assets"))).sort(), beforeFiles.sort());
    assert.equal(
      (await db.aiJob.findUniqueOrThrow({ where: { id: badJob.id } })).status,
      "RUNNING",
    );
    console.log(
      "✓ Failed commit rolls back business rows, cropped asset rows and job completion, and removes written crop files",
    );
    console.log("AI domain atomicity acceptance passed without external model calls.");
  } finally {
    globalDb.paperDb = previous;
    await db.$disconnect();
    await sql.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await sql.end();
    await rm(root, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
