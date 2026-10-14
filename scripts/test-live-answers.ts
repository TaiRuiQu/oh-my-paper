import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { loadEnvironment } from "./load-env.mjs";

// Opt-in paid test: use a dedicated account/key. No credentials enter the report.
loadEnvironment();
async function main() {
  const apiKey = process.env.LIVE_AI_KEY_FILE
    ? (await readFile(process.env.LIVE_AI_KEY_FILE, "utf8")).trim()
    : process.env.LIVE_AI_API_KEY;
  assert(apiKey, "Set LIVE_AI_API_KEY or LIVE_AI_KEY_FILE to run this paid live test.");
  const baseURL = process.env.LIVE_AI_BASE_URL ?? "https://api.deepseek.com";
  const model = process.env.LIVE_AI_MODEL ?? "deepseek-flash";
  const schema = `live_answers_${randomUUID().replaceAll("-", "")}`;
  const root = await mkdtemp(join(tmpdir(), "paper-live-answers-"));
  const connectionString = process.env.DATABASE_URL!;
  const sql = new Client({ connectionString, connectionTimeoutMillis: 5000 });
  const { PrismaClient } = await import("../src/generated/prisma/client");
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString, options: `-c search_path=${schema}` }, { schema }),
  });
  (globalThis as typeof globalThis & { paperDb: InstanceType<typeof PrismaClient> }).paperDb = db;
  process.env.STORAGE_ROOT = root;
  const originalFetch = globalThis.fetch;
  const started = Date.now();
  let calls = 0;
  try {
    await sql.connect();
    await sql.query(`CREATE SCHEMA "${schema}"`);
    await sql.query(`SET search_path TO "${schema}"`);
    for (const folder of (await readdir("prisma/migrations")).filter((f) => /^\d/.test(f)).sort())
      await sql.query(await readFile(join("prisma/migrations", folder, "migration.sql"), "utf8"));
    const userId = randomUUID(),
      examId = randomUUID(),
      sectionId = randomUUID();
    const sourceId = randomUUID(),
      taskId = randomUUID(),
      jobId = randomUUID();
    const questionIds = [randomUUID(), randomUUID()];
    await db.user.create({
      data: { id: userId, name: "Live test", email: "live@example.invalid", credits: 1000 },
    });
    const { saveProvider, activateModel, getActiveProvider } =
      await import("../src/server/ai/settings");
    const providerId = await saveProvider({
      name: "Live Responses test",
      apiType: "openai_responses",
      baseURL,
      apiKey,
      structuredOutputs: false,
      maxOutputTokens: 4096,
      timeoutSeconds: 120,
      maxConcurrency: 1,
      models: [{ name: model, reasoningEfforts: ["default"] }],
    });
    const savedModel = await db.aiModel.findFirstOrThrow({ where: { providerId } });
    await activateModel(providerId, savedModel.id, "default", "answer");
    const snapshot = await getActiveProvider("answer");
    await db.exam.create({ data: { id: examId, userId, name: "流式答案实测", totalScore: 5 } });
    await db.examSection.create({
      data: {
        id: sectionId,
        examId,
        position: 1,
        number: "一",
        title: "计算题",
        description: "写出计算步骤。",
        score: 5,
      },
    });
    await db.examQuestion.createMany({
      data: questionIds.map((id, index) => ({
        id,
        examId,
        sectionId,
        position: index + 1,
        number: index + 1,
        description: index ? "解方程：$2x+3=11$。" : "计算：$7\\times8$。",
        score: index ? 3 : 2,
        materials: [],
        subquestions: [],
      })),
    });
    await db.examTask.create({
      data: {
        id: sourceId,
        userId,
        examId,
        name: "Live test",
        status: "COMPLETED",
        inputFiles: [],
        providerSnapshot: snapshot,
        jobId: randomUUID(),
        outputKey: "source",
      },
    });
    await mkdir(join(root, "exam-tasks", sourceId, "source"), { recursive: true });
    await db.examAgentTask.create({
      data: {
        id: taskId,
        examId,
        kind: "ANSWER",
        name: "Live answer test",
        inputFiles: [],
        providerSnapshot: snapshot,
        jobId,
        totalQuestions: 2,
      },
    });
    globalThis.fetch = async (input, init) => {
      const request = JSON.parse(String(init?.body));
      assert.equal(request.stream, true);
      assert.equal(request.store, false);
      assert.equal(request.model, model);
      calls++;
      console.log(`Live model request ${calls}: ${String(input)}`);
      return originalFetch(input, init);
    };
    const { processAgentTask, agentTaskDirectory } =
      await import("../src/server/exams/agent-tasks");
    await processAgentTask(taskId, jobId, AbortSignal.timeout(5 * 60_000));
    const task = await db.examAgentTask.findUniqueOrThrow({ where: { id: taskId } });
    assert.equal(task.status, "COMPLETED", task.error ?? "Answer task did not complete");
    const answers = await db.questionAnswer.findMany({
      where: { examId },
      orderBy: { questionId: "asc" },
    });
    assert.equal(answers.length, 2);
    assert(answers.find((a) => a.questionId === questionIds[0])?.solution.includes("56"));
    assert(answers.find((a) => a.questionId === questionIds[1])?.solution.includes("4"));
    const usage = await db.creditUsage.findMany({ where: { taskId } });
    assert.equal(usage.length, calls);
    assert(usage.every((u) => u.inputTokens > 0 && u.outputTokens > 0));
    assert(task.creditsSpent.greaterThan(0));
    const activity = (
      await readFile(join(agentTaskDirectory(taskId), task.attempt!, "agent.jsonl"), "utf8")
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const tools = activity.filter((e) => e.type === "tool_call").map((e) => e.tool);
    assert(tools.includes("list_questions"));
    assert(tools.includes("append_answers"));
    assert(tools.includes("submit_answers"));
    const report = {
      baseURL,
      model,
      status: task.status,
      durationMs: Date.now() - started,
      calls,
      tools,
      answers,
      usage: usage.map((u) => ({
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
        cachedTokens: u.cachedTokens,
      })),
      creditsSpent: task.creditsSpent.toString(),
    };
    await mkdir(".local", { recursive: true });
    await writeFile(".local/live-answers-report.json", JSON.stringify(report, null, 2), {
      mode: 0o600,
    });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    globalThis.fetch = originalFetch;
    await db.$disconnect();
    await sql.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await sql.end();
    await rm(root, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Live answer test failed");
  process.exitCode = 1;
});
