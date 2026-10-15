import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import sharp from "sharp";
import { loadEnvironment } from "./load-env.mjs";
import type { AgentTask } from "../src/server/platform/ai/agent-task";
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
  const tasks: { dispose: () => Promise<void> }[] = [];
  globalDb.paperDb = db;
  try {
    await sql.connect();
    await sql.query(`CREATE SCHEMA "${schema}"`);
    await sql.query(`SET search_path TO "${schema}"`);
    for (const folder of (await readdir("prisma/migrations")).filter((f) => /^\d/.test(f)).sort())
      await sql.query(await readFile(join("prisma/migrations", folder, "migration.sql"), "utf8"));
    const { executeCommand, loadState } = await import("../src/server/platform/service");
    const { createTaskFeatures: createFeatures } =
      await import("../src/server/platform/ai/features");
    const createTaskFeatures = async (options: Parameters<typeof createFeatures>[0]) => {
      const features = await createFeatures(options);
      tasks.push(features);
      return features;
    };
    const { createGradingFeatures } = await import("../src/server/platform/ai/grading");
    const { saveImage, accessibleAsset } = await import("../src/server/platform/assets");
    for (const id of ["teacher", "second"])
      await db.user.create({ data: { id, name: id, email: `${id}@domain.test`, role: "TEACHER" } });
    await db.user.create({
      data: { id: "account", name: "学生", email: "account@domain.test", role: "STUDENT" },
    });
    const actor = { id: "teacher" },
      command = (cmd: PlatformCommand) => executeCommand(actor, cmd);
    const call = async (f: Pick<AgentTask, "tools">, name: string, input: unknown) => {
      const tool = f.tools[name];
      if (!tool?.execute) throw new Error(`Tool missing: ${name}`);
      const output = await tool.execute(input, {
        toolCallId: randomUUID(),
        messages: [],
        context: undefined,
      });
      if (output && typeof output === "object" && "results" in output) {
        const entry = (
          output as {
            results: { success: boolean; output?: unknown; error?: { message: string } }[];
          }
        ).results[0];
        if (!entry.success) throw new Error(entry.error!.message);
        return entry.output;
      }
      return output;
    };
    const image = async (
      features: Pick<AgentTask, "tools">,
      url: string,
      name: string,
      box?: [number, number, number, number],
    ) => {
      const output = (await call(features, "python", {
        code: [
          "import json",
          "from pathlib import Path",
          "from PIL import Image",
          "with open('/inputs/context.json') as file: manifest = json.load(file)",
          `source = next(asset['path'] for asset in manifest['assets'] if asset['url'] == ${JSON.stringify(url)})`,
          "image = Image.open(source)",
          ...(box
            ? [
                `x, y, width, height = ${JSON.stringify(box)}`,
                "left, top = int(x * image.width), int(y * image.height)",
                "image = image.crop((left, top, left + int(width * image.width), top + int(height * image.height)))",
              ]
            : []),
          "Path('/workspace/output').mkdir(exist_ok=True)",
          `image.save('/workspace/output/${name}')`,
        ].join("\n"),
        assets: [url],
        images: [name],
      })) as { exitCode: number; stderr: string; images: { image: string; url?: string }[] };
      assert.equal(output.exitCode, 0, output.stderr);
      assert.equal(output.images.length, 1);
      return output.images[0];
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
    await image(importer, source.url, "source.png");
    await call(importer, "record_source_inventory", {
      sources: [{ url: source.url, totalQuestions: 1 }],
    });
    const crop = await image(importer, source.url, "diagram.png", [0.1, 0.2, 0.3, 0.25]);
    assert.ok(crop.url);
    await call(importer, "propose_question", {
      items: [
        {
          sourceKey: "page1:q1",
          question: {
            type: "BLANK",
            subject: "数学",
            grade: "高一",
            difficulty: 0.5,
            knowledgeTags: ["函数"],
            content: { ...content, images: [crop.url] },
          },
        },
      ],
    });
    await call(importer, "finish", { summary: "导入完成" });
    assert.equal(await db.question.count(), 0);
    assert.equal(await db.platformAsset.count(), 3);
    assert.equal(
      (await accessibleAsset("teacher", crop.url.split("/").at(-1)!)).contentType,
      "image/png",
    );
    await importer.commit();
    assert.equal(await db.question.count(), 1);
    assert.equal(await db.platformAsset.count(), 3);
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
      "✓ IMPORT persists trace images before commit, then commits question and job completion atomically",
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
    await call(enricher, "read_question", { items: [{ questionId: imported.id }] });
    await image(enricher, crop.url, "illustration.png");
    await call(enricher, "propose_enrichment", {
      items: [
        {
          questionId: imported.id,
          knowledgeTags: ["函数图像"],
          answers: ["2", "4"],
          explanation: "两个空分别对应图像读数。",
          rubric: "每空5分",
          parts: [],
        },
      ],
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
        classroom: { name: "班级", stage: "高中", cohort: "2027届" },
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
        student: { classroomId, name: "学生", studentNumber: "000001", userId: "account" },
      })
    ).id;
    const assessmentId = (
      await command({
        type: "assessment.save",
        assessment: {
          name: "双评",
          kind: "EXAM",
          reviewScope: "CLASSROOM",
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
    const gradeInput = { assessmentId, classroomId, paperId, submissionIds: [submissionId] },
      gradeJob = await makeJob("GRADE", gradeInput),
      grader = await createGradingFeatures({
        userId: "teacher",
        input: gradeInput,
        jobId: gradeJob.id,
      });
    tasks.push(grader);
    await grader.run({
      agent: async () => {
        throw new Error("考试不应启动 Agent");
      },
      model: async () => ({
        grades: [
          {
            itemId: paper.items[0].id,
            score: 5,
            feedback: "第二小问解释错误",
            partScores: [
              { partId: "1", score: 4, feedback: "两个空正确" },
              { partId: "2", score: 1, feedback: "解释错误" },
            ],
          },
        ],
        skipped: [],
      }),
    });
    await grader.commit();
    const first = await db.review.findFirstOrThrow({ where: { submissionId } });
    assert.equal(first.source, "AI");
    assert.equal(first.aiJobId, gradeJob.id);
    assert.equal(first.round, "FIRST");
    assert.equal((first.partScores as unknown[]).length, 2);
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
      "REVIEW",
      "Double marking still needs human confirmation of the AI suggestion",
    );
    await executeCommand(actor, {
      type: "review.save",
      review: {
        submissionId,
        itemId: paper.items[0].id,
        round: "FIRST",
        score: first.score,
        feedback: "第一评教师已核对AI建议",
        partScores: [
          { partId: "1", score: 4, feedback: "两个空正确" },
          { partId: "2", score: 1, feedback: "解释错误" },
        ],
      },
    });
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
      "✓ Mixed part scores persist through AI suggestion, human FIRST confirmation and independent human SECOND; correct subpart stays mastered and only the failed subpart enters weaknesses",
    );
    const beforeQuestions = await db.question.count();
    const badJob = await makeJob("IMPORT", importInput),
      bad = await createTaskFeatures({
        userId: "teacher",
        kind: "IMPORT",
        input: importInput,
        jobId: badJob.id,
      });
    await image(bad, source.url, "source.png");
    await call(bad, "record_source_inventory", {
      sources: [{ url: source.url, totalQuestions: 1 }],
    });
    const doomedCrop = await image(bad, source.url, "diagram.png", [0, 0, 0.2, 0.2]);
    assert.ok(doomedCrop.url);
    await call(bad, "propose_question", {
      items: [
        {
          sourceKey: "q",
          question: {
            type: "BLANK",
            subject: "数学",
            grade: "高一",
            difficulty: 0.5,
            knowledgeTags: ["函数"],
            content: { ...content, images: [doomedCrop.url] },
          },
        },
      ],
    });
    await call(bad, "finish", { summary: "will fail" });
    const beforeAssets = await db.platformAsset.count();
    const beforeFiles = await readdir(join(root, "platform-assets"));
    await db.user.update({ where: { id: "teacher" }, data: { role: "STUDENT" } });
    await assert.rejects(bad.commit(), /教师权限/);
    await db.user.update({ where: { id: "teacher" }, data: { role: "TEACHER" } });
    assert.equal(await db.question.count(), beforeQuestions);
    assert.equal(await db.platformAsset.count(), beforeAssets);
    assert.deepEqual((await readdir(join(root, "platform-assets"))).sort(), beforeFiles.sort());
    await bad.dispose();
    assert.equal(
      (await accessibleAsset("teacher", doomedCrop.url.split("/").at(-1)!)).contentType,
      "image/png",
    );
    await assert.rejects(
      accessibleAsset("second", doomedCrop.url.split("/").at(-1)!),
      /图片不存在/,
    );
    assert.equal(
      (await db.aiJob.findUniqueOrThrow({ where: { id: badJob.id } })).status,
      "RUNNING",
    );
    console.log(
      "✓ Failed commit rolls back business rows and job completion while retaining private trace images after disposal",
    );
    const skippedJob = await makeJob("IMPORT", importInput);
    const unreadable = await createTaskFeatures({
      userId: "teacher",
      kind: "IMPORT",
      input: importInput,
      jobId: skippedJob.id,
    });
    await image(unreadable, source.url, "unreadable.png");
    await call(unreadable, "record_source_inventory", {
      sources: [{ url: source.url, totalQuestions: 2 }],
    });
    await unreadable.tools.skip_questions.execute!(
      {
        items: [
          { id: "page:q1", sourceUrl: source.url, reason: "题目模糊" },
          { id: "page:q2", sourceUrl: source.url, reason: "题目被遮挡" },
        ],
      },
      { toolCallId: randomUUID(), messages: [], context: undefined },
    );
    await call(unreadable, "finish", { summary: "全部2题无法辨认，已跳过" });
    await unreadable.commit();
    const persistedSkip = await db.aiJob.findUniqueOrThrow({ where: { id: skippedJob.id } });
    assert.equal(persistedSkip.status, "COMPLETED");
    assert.equal(
      (persistedSkip.result as { result: { skipped: unknown[] } }).result.skipped.length,
      2,
    );
    assert.equal(await db.question.count(), beforeQuestions);
    console.log(
      "✓ An entirely unreadable import completes normally and persists every skip reason without saving questions",
    );

    // Class batch tools run against a real database and sandbox, without model calls.
    const secondStudent = (
      await command({
        type: "student.save",
        student: { classroomId, name: "学生", studentNumber: "000002", userId: null },
      })
    ).id;
    const batchPaperId = (
      await command({
        type: "paper.save",
        paper: {
          name: "班级作业",
          kind: "HOMEWORK",
          subject: "数学",
          grade: "高一",
          instructions: "",
          layout: { paperSize: "A4", columns: 1 },
          items: [{ questionId: mixedId, score: 10, section: "综合" }],
        },
      })
    ).id;
    const batchPaper = (await loadState(actor)).papers.find((p) => p.id === batchPaperId)!;
    const createGrading = async (request: { input: unknown; jobId: string }) => {
      const task = await createGradingFeatures({ userId: "teacher", ...request });
      tasks.push(task);
      return task;
    };
    const batchAssessmentId = (
      await command({
        type: "assessment.save",
        assessment: {
          name: "班级批量",
          kind: "HOMEWORK",
          classroomIds: [classroomId],
          reviewScope: "CLASSROOM",
          papers: [
            {
              paperId: batchPaperId,
              subject: "数学",
              gradingMode: "SINGLE",
              arbitrationThreshold: 2,
              conversion: { enabled: false, bands: [] },
            },
          ],
        },
      })
    ).id;
    const sourceBuffer = await readFile(
      (await db.platformAsset.findUniqueOrThrow({ where: { id: source.id } })).path,
    );
    const secondPage = await saveImage("teacher", sourceBuffer, "第二位学生.png");
    const continuationPage = await saveImage("teacher", sourceBuffer, "第一位学生续页.png");
    const secondContinuation = await saveImage("teacher", sourceBuffer, "第二位学生续页.png");
    const batchInput = {
      assessmentId: batchAssessmentId,
      classroomId,
      paperId: batchPaperId,
      assetUrls: [source.url, continuationPage.url, secondPage.url, secondContinuation.url],
      pagesPerStudent: 2,
      studentIds: [studentId, secondStudent],
    };
    await assert.rejects(
      createGradingFeatures({
        userId: "teacher",
        input: { ...batchInput, assetUrls: batchInput.assetUrls.slice(1) },
      }),
      /扫描页数/,
    );
    const batchJob = await makeJob("GRADE", batchInput);
    const batch = await createGrading({ input: batchInput, jobId: batchJob.id });
    let homeworkAgents = 0;
    await batch.run({
      model: async () => {
        throw new Error("练习册应使用 Agent");
      },
      agent: async (agent) => {
        homeworkAgents++;
        assert.equal(agent.tools.register_submission, undefined);
        assert.equal(agent.tools.defer_pages, undefined);
        const assigned = JSON.parse(agent.prompt) as { studentId: string; sources: string[] };
        assert.deepEqual(
          assigned.sources,
          assigned.studentId === studentId
            ? batchInput.assetUrls.slice(0, 2)
            : batchInput.assetUrls.slice(2),
        );
        await call(agent, "read_answer", {});
        for (const [index, url] of assigned.sources.entries())
          await image(agent, url, `ordered-${index}.png`);
        const answer = (await call(agent, "record_answers", {
          items: [
            {
              studentId: assigned.studentId,
              itemId: batchPaper.items[0].id,
              text: "2，4。步骤正确",
              regions: assigned.sources.map((sourceUrl) => ({
                sourceUrl,
                x: 0.1,
                y: 0.1,
                width: 0.5,
                height: 0.3,
              })),
            },
          ],
        })) as { images: string[] };
        for (const [index, url] of answer.images.entries())
          await image(agent, url, `crop-${index}.png`);
        const grade = {
          studentId: assigned.studentId,
          itemId: batchPaper.items[0].id,
          score: 10,
          feedback: "正确",
          partScores: [
            { partId: "1", score: 4, feedback: "正确" },
            { partId: "2", score: 6, feedback: "正确" },
          ],
        };
        await assert.rejects(
          call(agent, "propose_grade", { items: [{ ...grade, score: 11 }] }),
          /满分/,
        );
        await call(agent, "propose_grade", { items: [grade] });
        await call(agent, "finish", { summary: "本学生练习册完成" });
      },
    });
    await batch.commit();
    assert.equal(homeworkAgents, 2);
    const batchSubs = await db.scanSubmission.findMany({
      where: { assessmentId: batchAssessmentId },
    });
    assert.equal(batchSubs.length, 2);
    assert(batchSubs.every((s) => s.status === "GRADED" && s.sourceFiles.length === 2));
    assert.equal(await db.review.count({ where: { aiJobId: batchJob.id } }), 2);
    assert.equal(await db.reviewEvent.count({ where: { aiJobId: batchJob.id } }), 2);
    await assert.rejects(
      createGradingFeatures({ userId: "teacher", input: batchInput }),
      /已有评分/,
    );
    console.log(
      "✓ Ordered homework pages are program-assigned to isolated per-student agents; crops, scores, history and task completion are atomic",
    );

    const confirmedStudent = (
      await command({
        type: "student.save",
        student: { classroomId, name: "待核对", studentNumber: "000003", userId: null },
      })
    ).id;
    const unreadableInput = {
      ...batchInput,
      assetUrls: [secondPage.url],
      pagesPerStudent: 1,
      studentIds: [confirmedStudent],
    };
    const unreadableJob = await makeJob("GRADE", unreadableInput);
    const unreadableHomework = await createGrading({
      input: unreadableInput,
      jobId: unreadableJob.id,
    });
    const skipHomework = async (agent: AgentTask) => {
      const data = JSON.parse(agent.prompt) as { studentId: string; sources: string[] };
      for (const [index, url] of data.sources.entries())
        await image(agent, url, `skip-${index}.png`);
      await call(agent, "skip_questions", {
        items: [
          {
            studentId: data.studentId,
            itemId: batchPaper.items[0].id,
            reason: "作答模糊待人工核对",
          },
        ],
      });
      await call(agent, "finish", { summary: "待人工核对" });
    };
    await unreadableHomework.run({
      agent: skipHomework,
      model: async () => {
        throw new Error("unexpected model");
      },
    });
    await unreadableHomework.commit();
    assert.equal(await db.review.count({ where: { aiJobId: unreadableJob.id } }), 0);
    const unreadableSubmission = await db.scanSubmission.findFirstOrThrow({
      where: { assessmentId: batchAssessmentId, studentId: confirmedStudent },
    });
    const existingInput = {
      assessmentId: batchAssessmentId,
      classroomId,
      paperId: batchPaperId,
      submissionIds: [unreadableSubmission.id],
    };
    const staleJob = await makeJob("GRADE", existingInput);
    const stale = await createGrading({ input: existingInput, jobId: staleJob.id });
    const revokedJob = await makeJob("GRADE", existingInput);
    const revoked = await createGrading({ input: existingInput, jobId: revokedJob.id });
    for (const task of [stale, revoked])
      await task.run({
        agent: skipHomework,
        model: async () => {
          throw new Error("unexpected model");
        },
      });
    await db.teachingAssignment.deleteMany({
      where: { userId: "teacher", role: "SUBJECT_TEACHER", classroomId },
    });
    await assert.rejects(revoked.commit(), /权限|不存在/);
    await db.teachingAssignment.create({
      data: { userId: "teacher", role: "SUBJECT_TEACHER", classroomId, subject: "数学" },
    });
    await command({
      type: "review.save",
      review: {
        submissionId: unreadableSubmission.id,
        itemId: batchPaper.items[0].id,
        round: "FIRST",
        score: 5,
        feedback: "人工已评分",
        partScores: [
          { partId: "1", score: 4, feedback: "正确" },
          { partId: "2", score: 1, feedback: "不完整" },
        ],
      },
    });
    await assert.rejects(stale.commit(), /范围|已有评分|变化/);
    assert.equal(await db.review.count({ where: { aiJobId: staleJob.id } }), 0);
    console.log(
      "✓ Unreadable answers remain ungraded; permission revocation and concurrent human reviews prevent stale commits",
    );

    const { generateCardTemplate } = await import("../src/server/platform/cards");
    const { renderCardSvg } = await import("../src/server/platform/print");
    const card = generateCardTemplate(paper);
    await db.cardTemplate.create({
      data: {
        id: card.id,
        ownerId: "teacher",
        paperId,
        name: card.name,
        subject: card.subject,
        preset: false,
        layout: JSON.parse(JSON.stringify(card.layout)),
      },
    });
    const cardSource = await saveImage(
      "teacher",
      await sharp(Buffer.from(renderCardSvg(card)))
        .png()
        .toBuffer(),
      "考试答题卡.png",
    );
    const examInput = {
      assessmentId,
      classroomId,
      paperId,
      templateId: card.id,
      assetUrls: [cardSource.url],
      studentIds: [secondStudent],
    };
    await assert.rejects(
      createGradingFeatures({ userId: "teacher", input: { ...examInput, templateId: undefined } }),
      /答题卡模板/,
    );
    const examJob = await makeJob("GRADE", examInput);
    const exam = await createGrading({ input: examInput, jobId: examJob.id });
    let examCalls = 0;
    await exam.run({
      agent: async () => {
        throw new Error("考试不应启动 Agent");
      },
      model: async (task) => {
        examCalls++;
        assert.equal(task.scope.studentId, secondStudent);
        const content = task.messages[0].content as { type: string }[];
        assert(content.some((part) => part.type === "file"));
        return {
          grades: [
            {
              itemId: paper.items[0].id,
              score: 0,
              feedback: "作答区空白",
              partScores: [
                { partId: "1", score: 0, feedback: "未作答" },
                { partId: "2", score: 0, feedback: "未作答" },
              ],
            },
          ],
          skipped: [],
        };
      },
    });
    const examOutput = await exam.commit();
    assert.equal(examCalls, 1);
    assert.equal((examOutput.result as { templateId: string }).templateId, card.id);
    const savedExam = await db.scanSubmission.findUniqueOrThrow({
      where: {
        assessmentId_paperId_studentId: { assessmentId, paperId, studentId: secondStudent },
      },
    });
    assert.equal(savedExam.kind, "CARD");
    assert.equal(savedExam.templateId, card.id);
    assert.equal(await db.review.count({ where: { aiJobId: examJob.id } }), 1);
    console.log(
      "✓ Exams use actual template cropping and one structured model call per student without an agent loop",
    );

    const { executeAdmin, adminCommandSchema, loadAdmin } =
      await import("../src/server/platform/admin");
    await db.user.create({
      data: { id: "admin", name: "管理员", email: "admin@domain.test", role: "ADMIN" },
    });
    const reasoningProvider = await executeAdmin(
      "admin",
      adminCommandSchema.parse({
        type: "provider.save",
        provider: {
          name: "思考强度验收",
          apiType: "openai_responses",
          baseURL: "https://example.test/v1",
          apiKey: "isolated-test-key",
          models: [{ name: "reasoning-test", displayName: "测试模型", reasoningEffort: "high" }],
        },
      }),
    );
    let savedReasoning = (await loadAdmin("admin")).providers.find(
      (p) => p.id === reasoningProvider.id,
    )!;
    assert.equal(savedReasoning.models[0].reasoningEffort, "high");
    const { loadAiModel } = await import("../src/server/platform/ai/model");
    assert.equal((await loadAiModel("teacher", savedReasoning.models[0].id)).reasoning, "high");
    await executeAdmin(
      "admin",
      adminCommandSchema.parse({
        type: "provider.save",
        provider: {
          id: reasoningProvider.id,
          name: "思考强度验收",
          apiType: "openai_responses",
          baseURL: "https://example.test/v1",
          models: [{ name: "reasoning-test", displayName: "测试模型", reasoningEffort: "none" }],
        },
      }),
    );
    savedReasoning = (await loadAdmin("admin")).providers.find(
      (p) => p.id === reasoningProvider.id,
    )!;
    assert.equal(savedReasoning.models[0].reasoningEffort, "none");
    assert.equal((await loadAiModel("teacher", savedReasoning.models[0].id)).reasoning, "none");
    console.log(
      "✓ Per-model reasoning effort persists, reloads for administrators and reaches the runtime configuration",
    );
    const provider = await db.aiProvider.create({
      data: {
        name: "待删除服务",
        apiType: "openai_chat",
        baseURL: "https://example.test/v1",
        encryptedApiKey: "unused",
        models: { create: { name: "test-model", reasoningEfforts: ["default"] } },
      },
      include: { models: true },
    });
    const modelId = provider.models[0].id;
    await db.aiSetting.create({ data: { id: "test-preference", modelId } });
    const historical = await db.aiJob.create({
      data: { userId: "teacher", kind: "ENRICH", modelId, status: "COMPLETED", input: {} },
    });
    await assert.rejects(
      executeAdmin("teacher", { type: "provider.delete", id: provider.id }),
      /管理员权限/,
    );
    await executeAdmin("admin", { type: "provider.delete", id: provider.id });
    assert.equal(await db.aiProvider.findUnique({ where: { id: provider.id } }), null);
    assert.equal(await db.aiModel.findUnique({ where: { id: modelId } }), null);
    assert.equal(
      (await db.aiSetting.findUniqueOrThrow({ where: { id: "test-preference" } })).modelId,
      null,
    );
    assert.equal(
      (await db.aiJob.findUniqueOrThrow({ where: { id: historical.id } })).status,
      "COMPLETED",
    );
    console.log(
      "✓ Only administrators can delete a provider; associated models cascade, preferences reset and job history remains",
    );
    console.log("AI domain atomicity acceptance passed without external model calls.");
  } finally {
    await Promise.allSettled(tasks.map((features) => features.dispose()));
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
