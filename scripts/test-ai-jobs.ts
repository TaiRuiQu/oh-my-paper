import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { loadEnvironment } from "./load-env.mjs";
import {
  claimAiJob,
  enqueueAiJob,
  getAiJob,
  listAiJobs,
  retryAiJob,
  runClaimedAiJob,
} from "../src/server/platform/ai-jobs";
import { RequestError } from "../src/server/http/errors";
import type { runAiTask } from "../src/server/platform/ai/runner";
loadEnvironment();
async function main() {
  const schema = `ai_jobs_test_${randomUUID().replaceAll("-", "")}`,
    connectionString = process.env.DATABASE_URL!;
  const sql = new Client({ connectionString });
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString, options: `-c search_path=${schema}` }, { schema }),
  });
  const globalDb = globalThis as typeof globalThis & { paperDb?: PrismaClient };
  const previous = globalDb.paperDb;
  globalDb.paperDb = db;
  const evidence: string[] = [];
  try {
    await sql.connect();
    await sql.query(`CREATE SCHEMA "${schema}"`);
    await sql.query(`SET search_path TO "${schema}"`);
    for (const folder of (await readdir("prisma/migrations")).filter((f) => /^\d/.test(f)).sort())
      await sql.query(await readFile(join("prisma/migrations", folder, "migration.sql"), "utf8"));
    for (const [id, role] of [
      ["teacher", "TEACHER"],
      ["outside", "TEACHER"],
      ["student", "STUDENT"],
      ["admin", "ADMIN"],
    ])
      await db.user.create({ data: { id, name: id, email: `${id}@jobs.test`, role } });
    const provider = await db.aiProvider.create({
      data: {
        name: "queue-test",
        apiType: "OPENAI",
        baseURL: "https://example.invalid",
        encryptedApiKey: "unused-test-adapter",
        maxConcurrency: 1,
      },
    });
    const model = await db.aiModel.create({
      data: {
        providerId: provider.id,
        name: "test-model",
        displayName: "queue adapter",
        isPublic: true,
        reasoningEfforts: ["default"],
      },
    });
    const request = {
      kind: "ASSEMBLE",
      modelId: model.id,
      input: {
        name: "queue paper",
        subject: "数学",
        grade: "高一",
        difficulty: 0.5,
        counts: [{ type: "SINGLE", count: 1, score: 5 }],
        knowledgeDistribution: [{ tag: "函数", percent: 100 }],
      },
    };
    await assert.rejects(enqueueAiJob("student", request), /教师权限/);
    await assert.rejects(enqueueAiJob("teacher", { ...request, modelId: "missing" }), /已启用/);
    await assert.rejects(
      enqueueAiJob("teacher", {
        kind: "ENRICH",
        modelId: model.id,
        input: { questionIds: ["other-account-question"] },
      }),
      /题目不存在/,
    );
    await assert.rejects(
      enqueueAiJob("teacher", {
        kind: "TEMPLATE",
        modelId: model.id,
        input: { paperId: "other-account-paper" },
      }),
      /试卷不存在/,
    );
    await assert.rejects(
      enqueueAiJob("teacher", {
        kind: "IMPORT",
        modelId: model.id,
        input: { assetUrls: [`/api/platform/assets/${randomUUID()}`] },
      }),
      /图片不存在/,
    );
    evidence.push("数据库角色、公开模型、题目／试卷／图片资源授权验证");
    const first = await enqueueAiJob("teacher", request),
      second = await enqueueAiJob("outside", request);
    assert.equal((await listAiJobs("teacher")).jobs.length, 1);
    assert.equal((await listAiJobs("outside")).jobs[0].id, second.id);
    assert.equal((await getAiJob("teacher", first.id)).id, first.id);
    await assert.rejects(getAiJob("outside", first.id), /AI 任务不存在/);
    await assert.rejects(getAiJob("student", first.id), /AI 任务不存在/);
    await assert.rejects(getAiJob("admin", first.id), /AI 任务不存在/);
    await assert.rejects(getAiJob("teacher", "missing-job"), /AI 任务不存在/);
    assert.deepEqual(Object.keys((await listAiJobs("teacher")).models[0]).sort(), ["id", "name"]);
    const claims = await Promise.all([claimAiJob("worker-a"), claimAiJob("worker-b")]);
    assert.equal(claims.filter(Boolean).length, 1);
    const job = claims.find(Boolean)!;
    assert.equal(job.id, first.id);
    assert.equal(job.attempts, 1);
    assert.equal(
      await claimAiJob("worker-c"),
      null,
      "provider concurrency includes other model tasks",
    );
    await assert.rejects(
      runClaimedAiJob(job, "foreign-worker", async () => {
        throw new Error("must not run");
      }),
      /执行进程/,
    );
    let calls = 0;
    const adapter: typeof runAiTask = async (options) => {
      calls++;
      assert.equal(options.jobId, first.id);
      await options.onEvent?.({ type: "test-tool", name: "fake-persist" });
      return { summary: "queue mechanics only", result: { savedId: "fixture" } };
    };
    await runClaimedAiJob(job, job.workerId!, adapter);
    let persisted = await db.aiJob.findUniqueOrThrow({ where: { id: first.id } });
    assert.equal(persisted.status, "COMPLETED");
    assert.ok(persisted.finishedAt);
    assert.equal((persisted.events as unknown[]).length, 1);
    assert.equal(calls, 1);
    await assert.rejects(runClaimedAiJob(job, job.workerId!, adapter), /任务已结束/);
    assert.equal(calls, 1);
    evidence.push(
      "跨 worker 原子claim、供应商并发限制、worker租约身份、持久化events/result及完成后不重复执行",
    );
    const failing = await claimAiJob("worker-fail");
    assert.equal(failing?.id, second.id);
    await runClaimedAiJob(failing!, "worker-fail", async () => {
      throw new RequestError(422, "测试任务未完成");
    });
    persisted = await db.aiJob.findUniqueOrThrow({ where: { id: second.id } });
    assert.equal(persisted.status, "FAILED");
    assert.equal(persisted.error, "测试任务未完成");
    await assert.rejects(retryAiJob("teacher", second.id), /不存在/);
    await assert.rejects(retryAiJob("teacher", first.id), /失败任务/);
    const retry = await retryAiJob("outside", second.id);
    assert.notEqual(retry.id, second.id);
    assert.equal((await db.aiJob.findUniqueOrThrow({ where: { id: retry.id } })).status, "QUEUED");
    const stale = await claimAiJob("crashed-worker");
    assert.equal(stale?.id, retry.id);
    await db.aiJob.update({
      where: { id: retry.id },
      data: { heartbeatAt: new Date(Date.now() - 120_000) },
    });
    assert.equal(await claimAiJob("restart-worker"), null);
    assert.equal((await db.aiJob.findUniqueOrThrow({ where: { id: retry.id } })).status, "FAILED");
    evidence.push("失败保留、仅本人显式重试新任务、心跳过期后失败且不自动重复计费");
    await db.aiModel.update({ where: { id: model.id }, data: { isPublic: false } });
    await assert.rejects(enqueueAiJob("teacher", request), /已启用/);
    await db.aiModel.update({ where: { id: model.id }, data: { isPublic: true } });
    const disabled = await enqueueAiJob("teacher", request);
    await db.aiModel.update({ where: { id: model.id }, data: { isPublic: false } });
    assert.equal(await claimAiJob("disabled-worker"), null);
    assert.equal(
      (await db.aiJob.findUniqueOrThrow({ where: { id: disabled.id } })).status,
      "FAILED",
    );
    await db.aiModel.update({ where: { id: model.id }, data: { isPublic: true } });
    const queued = await Promise.all(
      Array.from({ length: 11 }, () =>
        enqueueAiJob("teacher", request).then(
          (value) => ({ ok: true, id: value.id }),
          (error) => ({ ok: false, error }),
        ),
      ),
    );
    assert.equal(queued.filter((r) => r.ok).length, 10);
    assert.equal(queued.filter((r) => !r.ok).length, 1);
    const denied = queued.find((r) => !r.ok)! as { ok: false; error: unknown };
    assert.ok(denied.error instanceof RequestError);
    assert.equal(denied.error.status, 429);
    evidence.push("停用模型排队失败、并发入队十任务上限、用户任务列表隔离");
    console.log(
      JSON.stringify(
        {
          ok: true,
          scope: "durable PostgreSQL queue and security; fake adapter does not validate live AI",
          evidence,
        },
        null,
        2,
      ),
    );
  } finally {
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
