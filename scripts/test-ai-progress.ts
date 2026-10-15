import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { loadEnvironment } from "./load-env.mjs";
import { aiProgressResponse } from "../src/server/platform/ai-progress";
import { subscribeAiProgress } from "../src/server/platform/ai-progress-notifications";
import { decodeAiProgress } from "../src/lib/ai-progress-codec";
import type { AiProgressSnapshot } from "../src/contracts/ai-progress";
loadEnvironment();

async function main() {
  const schema = `ai_progress_test_${randomUUID().replaceAll("-", "")}`;
  const connectionString = process.env.DATABASE_URL!;
  const isolatedUrl = new URL(connectionString);
  isolatedUrl.searchParams.set("schema", schema);
  process.env.DATABASE_URL = isolatedUrl.href;
  process.env.AI_PROGRESS_FORMAT = "protobuf";
  const sql = new Client({ connectionString });
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString, options: `-c search_path=${schema}` }, { schema }),
  });
  const globalDb = globalThis as typeof globalThis & { paperDb?: PrismaClient };
  const previous = globalDb.paperDb;
  globalDb.paperDb = db;
  const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
  let unsubscribe: (() => void) | undefined;
  async function next(reader: ReadableStreamDefaultReader<Uint8Array>) {
    let timer: ReturnType<typeof setTimeout>;
    try {
      return await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Timed out waiting for SSE push")), 5000);
        }),
      ]);
    } finally {
      clearTimeout(timer!);
    }
  }
  async function snapshot(reader: ReadableStreamDefaultReader<Uint8Array>) {
    const result = await next(reader);
    assert.equal(result.done, false);
    const text = new TextDecoder().decode(result.value);
    const data = text.split("data: ")[1]?.trim();
    assert.ok(data !== undefined, `Expected snapshot: ${text}`);
    return text.includes("event: snapshot-protobuf")
      ? decodeAiProgress(data)
      : (JSON.parse(data) as AiProgressSnapshot);
  }
  async function open(userId: string, jobId?: string, format?: string, search = false) {
    const response = await aiProgressResponse(
      new Request(`http://localhost/api/platform/ai/events${format ? `?format=${format}` : ""}`),
      userId,
      new Date(Date.now() + 60_000),
      { jobId, search },
    );
    assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
    const reader = response.body!.getReader();
    readers.push(reader);
    assert.equal(new TextDecoder().decode((await next(reader)).value), "retry: 3000\n\n");
    return reader;
  }
  try {
    await sql.connect();
    await sql.query(`CREATE SCHEMA "${schema}"`);
    await sql.query(`SET search_path TO "${schema}"`);
    for (const folder of (await readdir("prisma/migrations")).filter((f) => /^\d/.test(f)).sort())
      await sql.query(await readFile(join("prisma/migrations", folder, "migration.sql"), "utf8"));
    for (const id of ["teacher", "outside"])
      await db.user.create({
        data: { id, name: id, email: `${id}@progress.test`, role: "TEACHER" },
      });
    await db.user.create({
      data: { id: "admin", name: "admin", email: "admin@progress.test", role: "ADMIN" },
    });
    const job = await db.aiJob.create({
      data: {
        userId: "teacher",
        kind: "IMPORT",
        modelId: "test",
        input: { assetUrls: ["扫描页"] },
      },
    });
    const changes: unknown[] = [];
    unsubscribe = await subscribeAiProgress(
      (change) => changes.push(change),
      () => {
        throw new Error("Unexpected database listener disconnection");
      },
    );
    const list = await open("teacher", undefined, "json");
    assert.equal((await snapshot(list)).jobs[0].status, "QUEUED");
    const detail = await open("teacher", job.id);
    assert.equal((await snapshot(detail)).jobs[0].id, job.id);
    await assert.rejects(open("outside", job.id), /AI 任务不存在/);

    await db.aiJob.update({
      where: { id: job.id },
      data: {
        status: "RUNNING",
        startedAt: new Date(),
        events: [{ type: "tool", name: "inspect_image" }],
      },
    });
    assert.equal((await snapshot(list)).jobs[0].status, "RUNNING");
    assert.equal((await snapshot(detail)).jobs[0].events.length, 1);
    const count = changes.length;
    await db.aiJob.update({ where: { id: job.id }, data: { heartbeatAt: new Date() } });
    await sql.query("SELECT 1");
    assert.equal(changes.length, count, "lease heartbeat must not notify");

    await assert.rejects(
      db.$transaction(async (tx) => {
        await tx.aiJob.update({ where: { id: job.id }, data: { error: "must roll back" } });
        throw new Error("rollback");
      }),
      /rollback/,
    );
    await sql.query("SELECT 1");
    assert.equal(changes.length, count, "rolled-back progress must not notify");

    await db.$transaction(async (tx) => {
      await tx.aiJob.update({
        where: { id: job.id },
        data: {
          status: "COMPLETED",
          finishedAt: new Date(),
          result: { summary: "已保存全部题目" },
          cost: { usd: 0.002, cny: 0.014 },
        },
      });
      assert.equal(changes.length, count, "progress must not notify before commit");
    });
    assert.equal((await snapshot(list)).jobs[0].status, "COMPLETED");
    const completed = (await snapshot(detail)).jobs[0];
    assert.deepEqual(completed.result, { summary: "已保存全部题目" });
    assert.deepEqual(completed.cost, { usd: 0.002, cny: 0.014 });
    assert.equal((await next(detail)).done, true);

    // A reconnect obtains the complete committed state without replay or polling.
    const reconnected = await open("teacher", job.id);
    assert.equal((await snapshot(reconnected)).jobs[0].status, "COMPLETED");
    assert.equal((await next(reconnected)).done, true);
    const outside = await open("outside");
    assert.deepEqual((await snapshot(outside)).jobs, []);
    await assert.rejects(open("outside", undefined, undefined, true), /需要管理员权限/);
    const search = await open("admin", undefined, undefined, true);
    assert.equal((await snapshot(search)).searchConfiguration?.embedding, null);
    await db.embeddingSetting.create({
      data: {
        id: "question-bank",
        name: "向量模型",
        apiType: "openai",
        baseURL: "https://example.invalid",
        model: "embedding",
        dimensions: 8,
        encryptedApiKey: "private-test-secret",
        version: "test-version",
      },
    });
    const configured = (await snapshot(search)).searchConfiguration!;
    assert.equal(configured.embedding?.hasApiKey, true);
    assert.ok(!JSON.stringify(configured).includes("private-test-secret"));
    const question = await db.question.create({
      data: {
        ownerId: "teacher",
        type: "SINGLE",
        subject: "数学",
        grade: "高中一年级",
        difficulty: 0.5,
        knowledgeTags: [],
        content: { stem: "2 + 2 = ?" },
      },
    });
    assert.equal((await snapshot(search)).searchConfiguration?.searchIndex.pending, 1);
    await db.questionSearchIndex.update({
      where: { questionId: question.id },
      data: { status: "INDEXED" },
    });
    const indexed = (await snapshot(search)).searchConfiguration!.searchIndex;
    assert.equal(indexed.indexed, 1);
    assert.equal(indexed.pending, 0);
    console.log(
      JSON.stringify(
        {
          ok: true,
          evidence: [
            "Real PostgreSQL LISTEN/NOTIFY across independent connections",
            "JSON and runtime-selected Protobuf SSE snapshots",
            "Commit-only notifications; heartbeat and rollback do not notify",
            "User isolation, complete result/cost, terminal close and reconnect snapshot",
            "Administrator-only embedding progress and secret-free configuration",
          ],
        },
        null,
        2,
      ),
    );
  } finally {
    for (const reader of readers) await reader.cancel();
    unsubscribe?.();
    globalDb.paperDb = previous;
    await db.$disconnect();
    await sql.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await sql.end();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
