import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import sharp from "sharp";
import { loadEnvironment } from "./load-env.mjs";
import type { AiKind } from "../src/contracts/platform-ai";
import type { PlatformCommand } from "../src/contracts/platform";
loadEnvironment();

async function main() {
  const { getDb } = await import("../src/server/db/client");
  const { PrismaClient } = await import("../src/generated/prisma/client");
  const source = await getDb().aiModel.findFirst({
    where: process.env.AI_LIVE_MODEL_ID
      ? { id: process.env.AI_LIVE_MODEL_ID }
      : { name: "ark-code-latest" },
    include: { provider: true },
  });
  if (!source)
    throw new Error("No configured live model; set AI_LIVE_MODEL_ID to a configured model ID.");
  const schema = `ai_live_${randomUUID().replaceAll("-", "")}`;
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
  const evidence: {
    kind: AiKind;
    success: boolean;
    summary?: string;
    error?: string;
    tools: string[];
  }[] = [];
  try {
    await sql.connect();
    await sql.query(`CREATE SCHEMA "${schema}"`);
    await sql.query(`SET search_path TO "${schema}"`);
    for (const folder of (await readdir("prisma/migrations"))
      .filter((name) => /^\d/.test(name))
      .sort())
      await sql.query(await readFile(join("prisma/migrations", folder, "migration.sql"), "utf8"));
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
        isPublic: true,
        reasoningEfforts: ["default"],
        reasoningEffort: source.reasoningEffort,
      },
    });
    await db.user.create({
      data: {
        id: "teacher",
        name: "Live 验收教师",
        email: "teacher@live.invalid",
        role: "TEACHER",
      },
    });
    await db.user.create({
      data: {
        id: "student",
        name: "Live 验收学生",
        email: "student@live.invalid",
        role: "STUDENT",
      },
    });
    const { executeCommand, loadState } = await import("../src/server/platform/service");
    const { saveImage } = await import("../src/server/platform/assets");
    const { runAiTask } = await import("../src/server/platform/ai/runner");
    const command = (command: PlatformCommand) => executeCommand({ id: "teacher" }, command);
    async function run(kind: AiKind, input: unknown, userId = "teacher") {
      const job = await db.aiJob.create({
        data: {
          userId,
          kind,
          modelId: model.id,
          input: JSON.parse(JSON.stringify(input)),
          status: "RUNNING",
          heartbeatAt: new Date(),
        },
      });
      const tools: string[] = [];
      console.log(`Live ${kind} started with ${model.name}`);
      try {
        const result = await runAiTask({
          userId,
          kind,
          input,
          modelId: model.id,
          jobId: job.id,
          onEvent: async (event) => {
            const row = event as { type?: string; name?: string; status?: string };
            if (row.type === "tool" && row.status === "started" && row.name) {
              tools.push(row.name);
              console.log(`${kind}: ${row.name}`);
            }
          },
        });
        assert.equal(
          (await db.aiJob.findUniqueOrThrow({ where: { id: job.id } })).status,
          "COMPLETED",
        );
        evidence.push({ kind, success: true, summary: result.summary, tools });
        console.log(`✓ Live ${kind}: ${result.summary}`);
        return result;
      } catch (error) {
        const { describeError } = await import("../src/server/logger");
        const diagnostic = describeError(error);
        evidence.push({ kind, success: false, error: diagnostic.message, tools });
        console.log(`✗ Live ${kind}: ${diagnostic.message}`);
        await db.aiJob.update({
          where: { id: job.id },
          data: { status: "FAILED", error: diagnostic.message, finishedAt: new Date() },
        });
        return null;
      }
    }
    const page = `<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="1400"><rect width="1100" height="1400" fill="white"/><g fill="black" font-family="Noto Sans CJK SC,sans-serif" font-size="26"><text x="45" y="55">高一数学练习（共5道顶层题，无参考答案）</text><text x="45" y="120">1. 单选题：2 + 3 的结果是（    ）</text><text x="65" y="170">A. 4      B. 5      C. 6      D. 7</text><text x="45" y="260">2. 多选题：下列方程中，解为 x = 2 的是（    ）</text><text x="65" y="310">A. x + 1 = 3     B. 2x = 4     C. x - 1 = 0     D. x = 3</text><text x="45" y="410">3. 填空题（两空）：若 x + 2 = 3，x = ____；若 y - 1 = 2，y = ____。</text><text x="45" y="510">4. 计算题：解方程 2x + 4 = 10，写出解题过程。</text><text x="45" y="620">5. 混合题：观察下图矩形 ABCD，长为4，宽为3。</text><text x="65" y="670">（1）填空：矩形面积为 ____。（2分）</text><text x="65" y="720">（2）写出矩形周长，并解释计算方法。（3分）</text></g><g stroke="black" stroke-width="3" fill="none"><rect x="150" y="820" width="400" height="300"/></g><g fill="black" font-family="sans-serif" font-size="26"><text x="118" y="812">A</text><text x="562" y="812">B</text><text x="562" y="1150">C</text><text x="118" y="1150">D</text><text x="340" y="795">4</text><text x="570" y="980">3</text></g></svg>`;
    const image = await saveImage(
      "teacher",
      await sharp(Buffer.from(page)).png().toBuffer(),
      "live-question-import.png",
    );
    await run("IMPORT", { assetUrls: [image.url], subject: "数学", grade: "高一" });
    const imported = (await loadState({ id: "teacher" })).questions;
    if (imported.length !== 5)
      evidence.push({
        kind: "IMPORT",
        success: false,
        error: `Expected exactly five imported questions, got ${imported.length}`,
        tools: [],
      });
    if (imported.length === 5) {
      assert.deepEqual(
        new Set(imported.map((question) => question.type)),
        new Set(["SINGLE", "MULTIPLE", "BLANK", "SUBJECTIVE", "MIXED"]),
      );
      assert.deepEqual(
        imported.find((question) => question.type === "MULTIPLE")!.content.answers.sort(),
        ["A", "B"],
      );
      assert.deepEqual(imported.find((question) => question.type === "BLANK")!.content.answers, [
        "1",
        "3",
      ]);
      const mixed = imported.find((question) => question.type === "MIXED")!;
      assert.equal(mixed.content.parts.length, 2);
      assert(mixed.content.images.length > 0, "Diagram must be preserved as an independent crop");
      assert(
        !mixed.content.images.includes(image.url),
        "Whole source page cannot replace the question diagram",
      );
      const cropped = await db.platformAsset.findUniqueOrThrow({
        where: { id: mixed.content.images[0].split("/").at(-1)! },
      });
      const dimensions = await sharp(cropped.path).metadata();
      assert(
        dimensions.width! < 1100 && dimensions.height! < 1400,
        "Saved diagram must be cropped pixels",
      );
    }
    const question = async (
      stem: string,
      type: "SINGLE" | "BLANK" | "SUBJECTIVE",
      answer: string,
      tag = "一元一次方程",
    ) =>
      (
        await command({
          type: "question.save",
          question: {
            type,
            subject: "数学",
            grade: "高一",
            difficulty: 0.4,
            knowledgeTags: [tag],
            content: {
              stem,
              options:
                type === "SINGLE"
                  ? [
                      { label: "A", text: "1" },
                      { label: "B", text: "2" },
                    ]
                  : [],
              answers: answer ? [answer] : [],
              explanation: "",
              rubric: answer ? "答案与合理过程正确得5分" : "",
              parts: [],
              images: [],
            },
          },
        })
      ).id;
    const first = await question("若 x + 2 = 3，则 x = ____。", "BLANK", "");
    const second = await question("解方程 2x + 4 = 10，写出过程。", "SUBJECTIVE", "x=3");
    await question("解方程 3x - 6 = 9。", "SUBJECTIVE", "x=5");
    await question("若 x - 7 = 2，则 x = ____。", "BLANK", "9");
    await question("解方程 4x = 20。", "SUBJECTIVE", "x=5");
    await run("ENRICH", { questionIds: [first, second] });
    const enriched = (await loadState({ id: "teacher" })).questions.find(
      (question) => question.id === first,
    )!;
    assert(enriched.content.answers.includes("1"), "AI must solve x+2=3 correctly");
    await run("ASSEMBLE", {
      name: "AI 实际组卷",
      subject: "数学",
      grade: "高一",
      difficulty: 0.4,
      difficultyTolerance: 0.2,
      counts: [
        { type: "BLANK", count: 1, score: 5 },
        { type: "SUBJECTIVE", count: 1, score: 5 },
      ],
      knowledgeDistribution: [{ tag: "一元一次方程", percent: 100 }],
      kind: "EXAM",
    });
    const paperId = (
      await command({
        type: "paper.save",
        paper: {
          name: "AI 阅卷验收卷",
          kind: "EXAM",
          subject: "数学",
          grade: "高一",
          instructions: "",
          layout: { paperSize: "A4", columns: 1 },
          items: [
            { questionId: first, score: 5, section: "填空" },
            { questionId: second, score: 5, section: "解答" },
          ],
        },
      })
    ).id;
    await run("TEMPLATE", { paperId });
    const classroomId = (
      await command({
        type: "classroom.save",
        classroom: { name: "AI验收班", stage: "高中", cohort: "2027届" },
      })
    ).id;
    await db.teachingAssignment.create({
      data: { userId: "teacher", role: "SUBJECT_TEACHER", classroomId, subject: "数学" },
    });
    const studentId = (
      await command({
        type: "student.save",
        student: { classroomId, name: "学生甲", studentNumber: "000001", userId: "student" },
      })
    ).id;
    const assessmentId = (
      await command({
        type: "assessment.save",
        assessment: {
          name: "AI 验收考试",
          kind: "EXAM",
          reviewScope: "CLASSROOM",
          classroomIds: [classroomId],
          papers: [
            {
              paperId,
              subject: "数学",
              gradingMode: "SINGLE",
              arbitrationThreshold: 0,
              conversion: { enabled: false, bands: [] },
            },
          ],
        },
      })
    ).id;
    const paper = (await loadState({ id: "teacher" })).papers.find(
      (paper) => paper.id === paperId,
    )!;
    const studentImage = await saveImage(
      "teacher",
      await sharp(
        Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="850" height="230"><rect width="850" height="230" fill="white"/><g fill="black" font-family="sans-serif" font-size="34"><text x="30" y="75">2x + 4 = 10</text><text x="30" y="130">2x = 6</text><text x="30" y="185">x = 3</text></g></svg>`,
        ),
      )
        .png()
        .toBuffer(),
      "student-work.png",
    );
    const submissionId = (
      await command({
        type: "submission.save",
        submission: {
          rosterRevision: (
            await db.assessment.findUniqueOrThrow({
              where: { id: assessmentId },
              select: { rosterRevision: true },
            })
          ).rosterRevision,
          assessmentId,
          paperId,
          studentId,
          kind: "WORKBOOK",
          sourceFiles: [studentImage.url],
          answers: [
            { itemId: paper.items[0].id, text: "2", images: [] },
            { itemId: paper.items[1].id, text: "", images: [studentImage.url] },
          ],
        },
      })
    ).id;
    await run("GRADE", {
      rosterRevision: (
        await db.assessment.findUniqueOrThrow({
          where: { id: assessmentId },
          select: { rosterRevision: true },
        })
      ).rosterRevision,
      assessmentId,
      classroomId,
      paperId,
      submissionIds: [submissionId],
    });
    const reviews = await db.review.findMany({
      where: { submissionId },
      orderBy: { itemId: "asc" },
    });
    assert.equal(reviews.length, 2);
    assert(reviews.every((review) => review.source === "AI" && review.aiJobId));
    assert.equal(
      reviews.find((review) => review.itemId === paper.items[0].id)!.score,
      0,
      "Incorrect answer 2 must score zero",
    );
    assert.equal(
      reviews.find((review) => review.itemId === paper.items[1].id)!.score,
      5,
      "Correct equation steps must score full marks",
    );
    await command({ type: "assessment.publish", id: assessmentId, published: true });
    await run("RECOMMEND", { studentId, count: 2, subject: "数学" }, "student");
    assert(
      evidence.every((row) => row.success),
      JSON.stringify(evidence.filter((row) => !row.success)),
    );
    console.log(
      "All six live AI task kinds passed with real provider calls and authoritative artifact assertions.",
    );
  } finally {
    await writeFile(
      "tmp/ai-live-evidence.json",
      JSON.stringify(
        { model: source.name, timestamp: new Date().toISOString(), evidence },
        null,
        2,
      ),
    );
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
