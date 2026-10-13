import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import sharp from "sharp";
import { loadEnvironment } from "./load-env.mjs";
loadEnvironment();
async function main() {
  const schema = `cards_test_${randomUUID().replaceAll("-", "")}`,
    root = await mkdtemp(join(tmpdir(), "cards-integration-")),
    connectionString = process.env.DATABASE_URL!;
  const sql = new Client({ connectionString }),
    { PrismaClient } = await import("../src/generated/prisma/client");
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString, options: `-c search_path=${schema}` }, { schema }),
  });
  (globalThis as typeof globalThis & { paperDb: InstanceType<typeof PrismaClient> }).paperDb = db;
  process.env.STORAGE_ROOT = root;
  process.env.QUEUE_SCHEMA = `${schema}_jobs`;
  const originalFetch = globalThis.fetch;
  let producer:
    Awaited<ReturnType<(typeof import("../src/server/jobs/client"))["getJobProducer"]>> | undefined;
  try {
    await sql.connect();
    await sql.query(`CREATE SCHEMA "${schema}"`);
    await sql.query(`SET search_path TO "${schema}"`);
    for (const folder of (await readdir("prisma/migrations")).filter((f) => /^\d/.test(f)).sort())
      await sql.query(await readFile(join("prisma/migrations", folder, "migration.sql"), "utf8"));
    const user = await db.user.create({
      data: { id: randomUUID(), name: "test", email: "cards-test@example.com", role: "ADMIN" },
    });
    const { saveProvider, activateModel } = await import("../src/server/ai/settings");
    const providerId = await saveProvider({
      name: "test",
      apiType: "openai_chat",
      baseURL: "https://test.example/v1",
      apiKey: "test-key",
      structuredOutputs: false,
      maxOutputTokens: 4096,
      timeoutSeconds: 60,
      maxConcurrency: 3,
      models: [{ name: "test", reasoningEfforts: ["default"], isPublic: true }],
    });
    const provider = await db.aiProvider.findUniqueOrThrow({
      where: { id: providerId },
      include: { models: true },
    });
    for (const purpose of ["exam", "grading"] as const)
      await activateModel(providerId, provider.models[0].id, "default", purpose);
    const examId = randomUUID(),
      sectionId = randomUUID(),
      questionIds = [randomUUID(), randomUUID()],
      sourceId = randomUUID();
    await db.exam.create({ data: { id: examId, userId: user.id, name: "test", totalScore: 4 } });
    await db.examSection.create({
      data: {
        id: sectionId,
        examId,
        position: 1,
        number: "一",
        title: "test",
        description: "",
        score: 4,
      },
    });
    await db.examQuestion.createMany({
      data: questionIds.map((id, position) => ({
        id,
        examId,
        sectionId,
        position: position + 1,
        number: position ? 18 : 1,
        description: "1+1=?",
        materials: [],
        subquestions: [],
        score: 2,
      })),
    });
    await db.examAnswer.create({ data: { examId } });
    await db.questionAnswer.createMany({
      data: questionIds.map((questionId) => ({
        questionId,
        examId,
        solution: "2",
        gradingCriteria: "2分",
      })),
    });
    await db.examTask.create({
      data: {
        id: sourceId,
        userId: user.id,
        examId,
        name: "test",
        status: "COMPLETED",
        inputFiles: [],
        providerSnapshot: {},
        jobId: randomUUID(),
        outputKey: "source",
      },
    });
    await mkdir(join(root, "exam-tasks", sourceId, "source"), { recursive: true });
    await db.workerHeartbeat.create({ data: { id: randomUUID() } });
    // Synthetic pages keep the database test independent of private example uploads.
    const front = await sharp({
        create: { width: 2000, height: 1000, channels: 3, background: "white" },
      })
        .jpeg()
        .toBuffer(),
      back = await sharp({
        create: { width: 2000, height: 1000, channels: 3, background: "#eeeeee" },
      })
        .jpeg()
        .toBuffer();
    const request = (path: string, names: string[]) => {
      const form = new FormData();
      names.forEach((name, i) =>
        form.append("files", new Blob([i % 2 ? back : front], { type: "image/jpeg" }), name),
      );
      return new Request(`http://localhost${path}`, { method: "POST", body: form });
    };
    const {
      createCardTemplate,
      processCardTemplate,
      createCardBatch,
      processCardBatch,
      retryCard,
      ownedTemplate,
      cardBatchDetail,
    } = await import("../src/server/answer-cards/tasks");
    const { getJobProducer } = await import("../src/server/jobs/client");
    producer = await getJobProducer();
    let layoutCalls = 0,
      gradeCalls = 0,
      active = 0,
      peak = 0,
      failOnce = true;
    const response = (content: unknown, finish = "stop") =>
      Response.json({
        id: randomUUID(),
        object: "chat.completion",
        created: 1,
        model: "test",
        choices: [{ index: 0, message: content, finish_reason: finish }],
        usage: { prompt_tokens: 20, completion_tokens: 20, total_tokens: 40 },
      });
    globalThis.fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      if (body.tools) {
        layoutCalls++;
        if (layoutCalls === 1)
          return response(
            {
              role: "assistant",
              content: null,
              tool_calls: questionIds.map((id, i) => ({
                id: randomUUID(),
                type: "function",
                function: {
                  name: "save_region",
                  arguments: JSON.stringify({
                    questionId: id,
                    boxes: [{ page: i + 1, x: 0.05, y: 0.3, width: 0.2, height: 0.2 }],
                  }),
                },
              })),
            },
            "tool_calls",
          );
        return response(
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: randomUUID(),
                type: "function",
                function: { name: "submit_regions", arguments: "{}" },
              },
            ],
          },
          "tool_calls",
        );
      }
      gradeCalls++;
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 30));
      active--;
      if (failOnce) {
        failOnce = false;
        return response({ role: "assistant", content: "invalid JSON" });
      }
      const content = body.messages.at(-1).content;
      const images = content.filter((p: { type: string }) => p.type === "image_url");
      assert.equal(images.length, 1);
      return response({
        role: "assistant",
        content: JSON.stringify({ answer: "2", correct: true, score: 2, feedback: "正确" }),
      });
    };
    const template = await createCardTemplate(
      request(`/api/exams/${sourceId}/answer-card-template`, ["front.jpg", "back.jpg"]),
      user.id,
      sourceId,
    );
    const storedTemplate = await ownedTemplate(user.id, template.id);
    await processCardTemplate(template.id, storedTemplate.jobId, new AbortController().signal);
    const ready = await ownedTemplate(user.id, template.id);
    assert.equal(ready.status, "COMPLETED");
    assert.equal(ready.pageCount, 2);
    assert.equal(layoutCalls, 2);
    await assert.rejects(ownedTemplate("other-user", template.id));
    const batch = await createCardBatch(
      request(`/api/answer-cards/templates/${template.id}/batches?filesPerStudent=2`, [
        "s1-front.jpg",
        "s1-back.jpg",
        "s2-front.jpg",
        "s2-back.jpg",
      ]),
      user.id,
      template.id,
    );
    let stored = await db.answerCardBatch.findUniqueOrThrow({ where: { id: batch.id } });
    await processCardBatch(batch.id, stored.jobId, new AbortController().signal);
    let detail = await cardBatchDetail(user.id, batch.id);
    assert.equal(detail.status, "FAILED");
    assert.equal(detail.completed, 3);
    assert.equal(gradeCalls, 4);
    assert(peak > 1 && peak <= 3);
    await retryCard(user.id, "batches", batch.id);
    stored = await db.answerCardBatch.findUniqueOrThrow({ where: { id: batch.id } });
    await processCardBatch(batch.id, stored.jobId, new AbortController().signal);
    detail = await cardBatchDetail(user.id, batch.id);
    assert.equal(detail.status, "COMPLETED");
    assert.equal(detail.completed, 4);
    assert.equal(gradeCalls, 5);
    assert.equal(await db.submission.count(), 2);
    assert.equal(await db.submissionAnswer.count(), 4);
    assert(
      (
        await db.answerCardBatch.findUniqueOrThrow({ where: { id: batch.id } })
      ).creditsSpent.greaterThan(0),
    );
    await db.user.update({ where: { id: user.id }, data: { role: "USER" } });
    await assert.rejects(cardBatchDetail("other-user", batch.id));
    console.log(
      "✓ Answer-card template, dual-page grouping, concurrent one-call grading, billing, ownership and missing-question-only retry",
    );
  } finally {
    globalThis.fetch = originalFetch;
    await producer?.stop();
    await db.$disconnect();
    await sql.query(`DROP SCHEMA IF EXISTS "${schema}_jobs" CASCADE`);
    await sql.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await sql.end();
    await rm(root, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
