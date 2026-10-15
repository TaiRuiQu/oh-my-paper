import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import sharp from "sharp";
import type { PlatformCommand } from "../src/contracts/platform";
import { loadEnvironment } from "./load-env.mjs";

loadEnvironment();
async function main() {
  const schema = `revision_${randomUUID().replaceAll("-", "")}`;
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
  const storage = await mkdtemp(join(tmpdir(), "revision-paper-test-"));
  process.env.STORAGE_ROOT = storage;
  const features: Awaited<
    ReturnType<typeof import("../src/server/platform/ai/features").createTaskFeatures>
  >[] = [];
  try {
    await sql.connect();
    await sql.query(`CREATE SCHEMA "${schema}"`);
    await sql.query(`SET search_path TO "${schema}"`);
    for (const folder of (await readdir("prisma/migrations")).filter((f) => /^\d/.test(f)).sort())
      await sql.query(await readFile(join("prisma/migrations", folder, "migration.sql"), "utf8"));
    const { executeCommand, loadState } = await import("../src/server/platform/service");
    const { reproducePaper, consolidationContext } =
      await import("../src/server/platform/revision-papers");
    const { createTaskFeatures } = await import("../src/server/platform/ai/features");
    const { enqueueAiJob } = await import("../src/server/platform/ai-jobs");
    const { saveImage, accessibleAsset, assetId } = await import("../src/server/platform/assets");
    const { paperRecord } = await import("../src/server/platform/records");
    const { renderPaperWord } = await import("../src/server/platform/word-export");
    for (const [id, role] of [
      ["owner", "TEACHER"],
      ["math", "TEACHER"],
      ["outsider", "TEACHER"],
      ["student", "STUDENT"],
      ["otherStudent", "STUDENT"],
    ])
      await db.user.create({ data: { id, role, name: id, email: `${id}@revision.invalid` } });
    const command = (input: PlatformCommand) => executeCommand({ id: "owner" }, input);
    const classroom = await command({
      type: "classroom.save",
      classroom: { name: "复习测试班", stage: "高中", cohort: "2027届" },
    });
    for (const userId of ["owner", "math"])
      await db.teachingAssignment.create({
        data: { userId, role: "SUBJECT_TEACHER", classroomId: classroom.id, subject: "数学" },
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
    const image = await saveImage(
      "owner",
      await sharp({ create: { width: 100, height: 80, channels: 3, background: "white" } })
        .png()
        .toBuffer(),
      "题目配图",
    );
    const content = {
      stem: "阅读材料并解答两个小问。",
      images: [image.url],
      answers: [],
      options: [],
      explanation: "完整解析",
      rubric: "分小问评分",
      parts: [
        {
          id: "algebra",
          type: "BLANK" as const,
          stem: "1+1=___",
          options: [],
          answers: ["2"],
          explanation: "相加",
          rubric: "5分",
          score: 5,
          knowledgeTags: ["代数"],
        },
        {
          id: "geometry",
          type: "BLANK" as const,
          stem: "三角形内角和___度",
          options: [],
          answers: ["180"],
          explanation: "内角和",
          rubric: "5分",
          score: 5,
          knowledgeTags: ["几何"],
        },
      ],
    };
    const original = await command({
      type: "question.save",
      question: {
        type: "MIXED",
        subject: "数学",
        grade: "高一",
        difficulty: 0.5,
        knowledgeTags: ["综合"],
        content,
      },
    });
    const paper = await command({
      type: "paper.save",
      paper: {
        name: "原作业",
        kind: "HOMEWORK",
        subject: "数学",
        grade: "高一",
        instructions: "",
        layout: { paperSize: "A4", columns: 1 },
        items: [{ questionId: original.id, score: 10, section: "综合题" }],
      },
    });
    const sourcePaper = paperRecord(await db.paper.findUniqueOrThrow({ where: { id: paper.id } }));
    const assessment = await command({
      type: "assessment.save",
      assessment: {
        name: "原作业安排",
        kind: "HOMEWORK",
        classroomIds: [classroom.id],
        reviewScope: "CLASSROOM",
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
        answers: [{ itemId: sourcePaper.items[0].id, text: "1；180", images: [] }],
      },
    });
    const reviewInput = {
      submissionId: submission.id,
      itemId: sourcePaper.items[0].id,
      round: "FIRST" as const,
      score: 5,
      feedback: "代数需巩固",
      partScores: [
        { partId: "algebra", score: 0, feedback: "计算失误" },
        { partId: "geometry", score: 5, feedback: "正确" },
      ],
    };
    await command({ type: "review.save", review: reviewInput });
    const input = {
      studentId: student.id,
      name: "数学错题复现",
      subject: "数学",
      sources: [{ assessmentId: assessment.id, itemId: sourcePaper.items[0].id }],
    };
    await assert.rejects(() => reproducePaper("student", input), /错题不存在|无权|报告不存在/);
    await command({ type: "assessment.publish", id: assessment.id, published: true });
    await assert.rejects(() => reproducePaper("outsider", input), /无权|报告不存在/);
    await assert.rejects(() => reproducePaper("otherStudent", input), /无权|报告不存在/);
    await assert.rejects(() => reproducePaper("math", { ...input, subject: "英语" }), /学科不符/);
    await assert.rejects(
      () =>
        reproducePaper("student", {
          ...input,
          sources: [{ ...input.sources[0], itemId: "forged" }],
        }),
      /错题不存在/,
    );
    const replay = await reproducePaper("math", input);
    const saved = paperRecord(await db.paper.findUniqueOrThrow({ where: { id: replay.id } }));
    assert.equal(saved.items.length, 1);
    assert.equal(saved.items[0].score, 10);
    assert.deepEqual(saved.items[0].snapshot.content.parts, content.parts);
    assert.notEqual(saved.items[0].snapshot.content.images[0], image.url);
    assert.deepEqual(
      (await accessibleAsset("math", assetId(saved.items[0].snapshot.content.images[0])!)).buffer,
      image.buffer,
    );
    assert.deepEqual(
      (await db.paper.findUniqueOrThrow({ where: { id: paper.id } })).items,
      sourcePaper.items,
    );
    const own = await reproducePaper("student", input);
    assert((await loadState({ id: "student" })).papers.some((p) => p.id === own.id));
    assert(!(await loadState({ id: "otherStudent" })).papers.some((p) => p.id === own.id));
    await assert.rejects(
      () => executeCommand({ id: "student" }, { type: "paper.delete", id: own.id }),
      /教师权限/,
    );
    const ownPaper = (await loadState({ id: "student" })).papers.find((p) => p.id === own.id)!;
    assert(
      (await renderPaperWord(ownPaper, (url) => accessibleAsset("student", assetId(url)!))).length >
        1000,
    );
    const candidates: string[] = [];
    for (const [stem, tag, subject, grade] of [
      ["2+3=___", "代数", "数学", "高一"],
      ["3+4=___", "代数", "数学", "高一"],
      ["几何练习", "几何", "数学", "高一"],
      ["英语练习", "代数", "英语", "高一"],
      ["跨年级练习", "代数", "数学", "高二"],
      [content.stem, "代数", "数学", "高一"],
    ]) {
      const result = await command({
        type: "question.save",
        question: {
          type: "BLANK",
          subject,
          grade,
          difficulty: 0.4,
          knowledgeTags: [tag],
          content: {
            stem,
            options: [],
            answers: ["5"],
            parts: [],
            images: [],
            explanation: "解析",
            rubric: "填对得分",
          },
        },
      });
      if (candidates.length < 2) candidates.push(result.id);
    }
    const consolidation = { ...input, name: "数学巩固卷", count: 2, score: 6 };
    const context = await consolidationContext("student", consolidation);
    assert.deepEqual(new Set(context.candidates.map((q) => q.id)), new Set(candidates));
    await db.aiProvider.create({
      data: {
        id: "provider",
        name: "测试模型",
        apiType: "openai_chat",
        baseURL: "http://invalid.local",
        encryptedApiKey: "unused",
        models: {
          create: { id: "model", name: "test", isPublic: true, reasoningEfforts: ["default"] },
        },
      },
    });
    await assert.rejects(
      () =>
        enqueueAiJob("student", {
          kind: "CONSOLIDATE",
          modelId: "model",
          input: { ...consolidation, count: 3 },
        }),
      /只有 2 道/,
    );
    const call = async (f: (typeof features)[number], name: string, input: unknown) =>
      f.tools[name].execute!(input, { toolCallId: randomUUID(), messages: [], context: undefined });
    async function prepare() {
      const job = await db.aiJob.create({
        data: {
          userId: "student",
          kind: "CONSOLIDATE",
          modelId: "model",
          input: consolidation,
          status: "RUNNING",
        },
      });
      const f = await createTaskFeatures({
        userId: "student",
        kind: "CONSOLIDATE",
        input: consolidation,
        jobId: job.id,
      });
      features.push(f);
      await assert.rejects(
        () =>
          call(f, "propose_paper", {
            questions: candidates.map((questionId) => ({ questionId, reason: "巩固代数计算" })),
          }),
        /先读取/,
      );
      await call(f, "read_learning", {});
      await call(f, "read_candidate", { items: candidates.map((questionId) => ({ questionId })) });
      await assert.rejects(
        () =>
          call(f, "propose_paper", {
            questions: [
              { questionId: candidates[0], reason: "巩固" },
              { questionId: candidates[0], reason: "重复" },
            ],
          }),
        /重复/,
      );
      await call(f, "propose_paper", {
        questions: candidates.map((questionId) => ({
          questionId,
          reason: "针对代数计算失分增加相近练习",
        })),
      });
      await call(f, "finish", { summary: "已选取两道代数题巩固计算。" });
      return { f, job };
    }
    const { f, job } = await prepare();
    const output = await f.commit();
    const result = output.result as { paperId: string };
    const final = paperRecord(await db.paper.findUniqueOrThrow({ where: { id: result.paperId } }));
    assert.equal(final.items.length, 2);
    assert.deepEqual(
      final.items.map((i) => i.questionId),
      candidates,
    );
    assert.equal(
      final.items.reduce((n, i) => n + i.score, 0),
      12,
    );
    assert.equal((await db.aiJob.findUniqueOrThrow({ where: { id: job.id } })).status, "COMPLETED");
    await assert.rejects(() => f.commit(), /状态已改变/);
    const stale = await prepare();
    await db.question.update({ where: { id: candidates[0] }, data: { knowledgeTags: ["几何"] } });
    await assert.rejects(() => stale.f.commit(), /候选题目.*改变/);
    await db.question.update({ where: { id: candidates[0] }, data: { knowledgeTags: ["代数"] } });
    const skippedJob = await db.aiJob.create({
      data: {
        userId: "student",
        kind: "CONSOLIDATE",
        modelId: "model",
        input: consolidation,
        status: "RUNNING",
      },
    });
    const unreadable = await createTaskFeatures({
      userId: "student",
      kind: "CONSOLIDATE",
      input: consolidation,
      jobId: skippedJob.id,
    });
    features.push(unreadable);
    await call(unreadable, "skip_questions", {
      items: candidates.map((id) => ({ id, reason: "题目无法辨认" })),
    });
    await call(unreadable, "finish", { summary: "候选题均已跳过。" });
    const noPaper = await unreadable.commit();
    assert.equal((noPaper.result as { paperId?: string }).paperId, undefined);
    assert.match(noPaper.summary, /未生成巩固卷/);
    const revoked = await prepare();
    await command({ type: "assessment.publish", id: assessment.id, published: false });
    await assert.rejects(() => revoked.f.commit(), /错题不存在|无权/);
    await command({ type: "assessment.publish", id: assessment.id, published: true });
    const attemptedPaper = await command({
      type: "paper.save",
      paper: {
        name: "未发布的练习",
        kind: "HOMEWORK",
        subject: "数学",
        grade: "高一",
        instructions: "",
        layout: { paperSize: "A4", columns: 1 },
        items: [{ questionId: candidates[1], score: 5, section: "填空" }],
      },
    });
    const attemptedAssessment = await command({
      type: "assessment.save",
      assessment: {
        name: "未发布",
        kind: "HOMEWORK",
        classroomIds: [classroom.id],
        papers: [
          {
            paperId: attemptedPaper.id,
            subject: "数学",
            gradingMode: "SINGLE",
            arbitrationThreshold: 2,
            conversion: { enabled: false, bands: [] },
          },
        ],
      },
    });
    await command({
      type: "submission.save",
      submission: {
        assessmentId: attemptedAssessment.id,
        paperId: attemptedPaper.id,
        studentId: student.id,
        kind: "WORKBOOK",
        sourceFiles: [],
        answers: [],
      },
    });
    assert(
      !(await consolidationContext("student", consolidation)).candidates.some(
        (q) => q.id === candidates[1],
      ),
    );
    assert.deepEqual(
      (await db.paper.findUniqueOrThrow({ where: { id: paper.id } })).items,
      sourcePaper.items,
    );
    console.log(
      "Revision papers integration passed: snapshots, asset copies, student isolation, mixed-part candidates, exact counts, Word export and atomic stale/permission checks.",
    );
  } finally {
    await Promise.all(features.map((f) => f.dispose()));
    globalDb.paperDb = previous;
    await db.$disconnect();
    await sql.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
    await sql.end();
    await rm(storage, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
