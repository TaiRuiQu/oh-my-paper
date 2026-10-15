import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn, type ChildProcess } from "node:child_process";
import { Client } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { loadEnvironment } from "./load-env.mjs";
loadEnvironment();

async function main() {
  const temp = await mkdtemp(join(tmpdir(), "omp-semantic-"));
  const schema = `semantic_test_${randomUUID().replaceAll("-", "")}`;
  const prefix = `test_${randomUUID().replaceAll("-", "")}`;
  const versions: string[] = [];
  let qdrant: ChildProcess | undefined;
  let calls = 0;
  let broken = false;
  let wrongDimensions = false;
  let holdEmbedding: (() => void) | undefined;
  let embeddingStarted: (() => void) | undefined;
  const vectors = (text: string, dimensions: number) => {
    const vector = /二次|抛物线|quadratic/.test(text)
      ? [1, 0.05, 0.01]
      : /几何|三角形/.test(text)
        ? [0.02, 1, 0.01]
        : [0.02, 0.01, 1];
    return Array.from({ length: dimensions }, (_, i) => vector[i] ?? 0.01);
  };
  const embeddingServer = createServer(async (request, response) => {
    calls++;
    assert.equal(request.headers.authorization, "Bearer local-test-embedding-key");
    let body = "";
    for await (const chunk of request) body += chunk.toString();
    const input = JSON.parse(body) as { input: string[]; dimensions: number };
    if (embeddingStarted) {
      embeddingStarted();
      embeddingStarted = undefined;
      await new Promise<void>((resolve) => {
        holdEmbedding = resolve;
      });
    }
    if (broken) {
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({ error: { message: "local-test-embedding-key sensitive failure" } }),
      );
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        object: "list",
        data: input.input.map((text, index) => ({
          index,
          object: "embedding",
          embedding: vectors(text, wrongDimensions ? input.dimensions + 1 : input.dimensions),
        })),
        model: "local-test",
        usage: { prompt_tokens: 1, total_tokens: 1 },
      }),
    );
  });
  await new Promise<void>((resolve) => embeddingServer.listen(0, "127.0.0.1", resolve));
  const address = embeddingServer.address();
  assert(address && typeof address !== "string");
  const endpoint = `http://127.0.0.1:${address.port}/v1`;
  const binary =
    process.env.QDRANT_TEST_BINARY ||
    (existsSync(".local/qdrant/qdrant") ? resolve(".local/qdrant/qdrant") : undefined);
  if (binary) {
    const portServer = createServer();
    await new Promise<void>((resolve) => portServer.listen(0, "127.0.0.1", resolve));
    const portAddress = portServer.address();
    assert(portAddress && typeof portAddress !== "string");
    const port = portAddress.port;
    await new Promise<void>((resolve) => portServer.close(() => resolve()));
    process.env.QDRANT_URL = `http://127.0.0.1:${port}`;
    process.env.QDRANT_API_KEY = "local-test-qdrant-key";
    qdrant = spawn(binary, ["--disable-telemetry"], {
      cwd: temp,
      env: {
        ...process.env,
        QDRANT__SERVICE__HOST: "127.0.0.1",
        QDRANT__SERVICE__HTTP_PORT: String(port),
        QDRANT__SERVICE__GRPC_PORT: "0",
        QDRANT__SERVICE__API_KEY: process.env.QDRANT_API_KEY,
        QDRANT__STORAGE__STORAGE_PATH: join(temp, "qdrant"),
      },
      stdio: "ignore",
    });
  }
  assert(
    process.env.QDRANT_URL,
    "Set QDRANT_URL or QDRANT_TEST_BINARY to test a real Qdrant server.",
  );
  process.env.QDRANT_COLLECTION_PREFIX = prefix;
  const headers = { "api-key": process.env.QDRANT_API_KEY ?? "" };
  const sql = new Client({ connectionString: process.env.DATABASE_URL });
  const { PrismaClient } = await import("../src/generated/prisma/client");
  const db = new PrismaClient({
    adapter: new PrismaPg(
      { connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}` },
      { schema },
    ),
  });
  const globals = globalThis as typeof globalThis & { paperDb?: InstanceType<typeof PrismaClient> };
  const previous = globals.paperDb;
  globals.paperDb = db;
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try {
        ready = (await fetch(`${process.env.QDRANT_URL}/readyz`, { headers })).ok;
        if (ready) break;
      } catch {
        /* Startup may take a moment. */
      }
      if (qdrant?.exitCode !== null && qdrant?.exitCode !== undefined)
        throw new Error(`Qdrant exited with ${qdrant.exitCode}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert(ready, "Qdrant did not become ready.");
    await sql.connect();
    await sql.query(`CREATE SCHEMA "${schema}"`);
    await sql.query(`SET search_path TO "${schema}"`);
    for (const folder of (await readdir("prisma/migrations"))
      .filter((name) => /^\d/.test(name))
      .sort())
      await sql.query(await readFile(join("prisma/migrations", folder, "migration.sql"), "utf8"));
    for (const [id, role] of [
      ["admin", "ADMIN"],
      ["teacher", "TEACHER"],
      ["outside", "TEACHER"],
      ["student", "STUDENT"],
    ])
      await db.user.create({ data: { id, role, name: id, email: `${id}@semantic.invalid` } });
    const { executeAdmin, loadAdmin, adminCommandSchema } =
      await import("../src/server/platform/admin");
    const { executeCommand } = await import("../src/server/platform/service");
    const { queryQuestionBank } = await import("../src/server/platform/question-bank");
    const { runQuestionIndexOnce } = await import("../src/server/platform/search/indexer");
    const actor = { id: "teacher", name: "teacher", role: "TEACHER" as const };
    const admin = { id: "admin", name: "admin", role: "ADMIN" as const };
    const settings = {
      name: "测试向量模型",
      apiType: "openai" as const,
      baseURL: endpoint,
      model: "local-test",
      dimensions: 3,
      enabled: true,
    };
    const configure = (embedding = settings) =>
      executeAdmin(
        "admin",
        adminCommandSchema.parse({
          type: "embedding.save",
          embedding: { ...embedding, apiKey: "local-test-embedding-key" },
        }),
      );
    const question = (stem: string, subject = "数学", grade = "高一") => ({
      type: "SUBJECTIVE",
      subject,
      grade,
      difficulty: 0.5,
      knowledgeTags: [stem],
      content: {
        stem,
        options: [],
        answers: ["答案"],
        explanation: "解析",
        rubric: "给分",
        parts: [],
        images: [],
      },
    });
    const save = (stem: string, id?: string, subject?: string, grade?: string) =>
      executeCommand(
        { id: "teacher" },
        {
          type: "question.save",
          question: { ...question(stem, subject, grade), ...(id ? { id } : {}) },
        },
      );
    const search = (q = "抛物线的性质", filters = {}) =>
      queryQuestionBank(db, actor, { q, searchMode: "semantic", ...filters });
    const drain = async () => {
      for (let i = 0; i < 200 && (await runQuestionIndexOnce()); i++);
    };
    const existing = (await save("二次函数旧题")).id;
    await configure();
    versions.push(
      (await db.embeddingSetting.findUniqueOrThrow({ where: { id: "question-bank" } })).version,
    );
    assert.equal(calls, 0, "Saving configuration must not call a paid model.");
    const configPayload = await loadAdmin("admin");
    assert(configPayload.embedding?.hasApiKey);
    assert(!JSON.stringify(configPayload).includes("local-test-embedding-key"));
    assert(!JSON.stringify(configPayload).includes("encryptedApiKey"));
    assert(
      !(
        await db.embeddingSetting.findUniqueOrThrow({ where: { id: "question-bank" } })
      ).encryptedApiKey.includes("local-test-embedding-key"),
    );
    const preservedKey = (
      await db.embeddingSetting.findUniqueOrThrow({ where: { id: "question-bank" } })
    ).encryptedApiKey;
    await executeAdmin(
      "admin",
      adminCommandSchema.parse({ type: "embedding.save", embedding: settings }),
    );
    assert.equal(
      (await db.embeddingSetting.findUniqueOrThrow({ where: { id: "question-bank" } }))
        .encryptedApiKey,
      preservedKey,
    );
    await assert.rejects(
      executeAdmin("teacher", adminCommandSchema.parse({ type: "embedding.reindex" })),
      /管理员/,
    );
    assert.equal((await search()).total, 0);
    await executeAdmin("admin", adminCommandSchema.parse({ type: "embedding.reindex" }));
    await drain();
    assert.equal((await search()).questions[0].id, existing);
    console.log(
      "✓ Encrypted configuration, admin permissions and explicit existing-question backfill pass with real Qdrant.",
    );

    const geometry = (await save("三角形几何证明")).id;
    await save("quadratic physics example", undefined, "物理");
    await save("二次函数初中题", undefined, "数学", "初二");
    await executeCommand(
      { id: "outside" },
      { type: "question.save", question: question("二次函数他人私题") },
    );
    for (let i = 0; i < 23; i++) await save(`阅读理解测试 ${i}`);
    await drain();
    assert.match(JSON.stringify((await search()).questions[0].content), /二次|quadratic/);
    assert.equal((await search("几何三角形")).questions[0].id, geometry);
    const first = await search();
    const second = await queryQuestionBank(
      db,
      actor,
      { q: "抛物线的性质", searchMode: "semantic" },
      2,
    );
    assert.equal(first.total, 27);
    assert.equal(first.questions.length, 20);
    assert.equal(second.questions.length, 7);
    assert.equal(new Set([...first.questions, ...second.questions].map((row) => row.id)).size, 27);
    assert([...first.questions, ...second.questions].every((row) => row.ownerId === "teacher"));
    assert.equal(
      (await queryQuestionBank(db, admin, { q: "抛物线", searchMode: "semantic" })).total,
      28,
    );
    const filtered = await search("抛物线", { subject: "数学", grade: "高一", type: "SUBJECTIVE" });
    assert.equal(filtered.total, 25);
    assert(filtered.questions.every((row) => row.subject === "数学" && row.grade === "高一"));
    await assert.rejects(
      queryQuestionBank(
        db,
        { id: "student", name: "student", role: "STUDENT" },
        { q: "x", searchMode: "semantic" },
      ),
      /教师/,
    );
    await assert.rejects(search(""), /语义搜索/);
    const keyword = await queryQuestionBank(db, actor, { q: "三角形", searchMode: "keyword" });
    assert.equal(keyword.total, 1);
    console.log(
      "✓ Similarity ranking, distinct 20-row pages, teacher isolation, admin scope, filters and keyword mode pass.",
    );

    await save("阅读理解替换", existing);
    assert.equal(
      (await search()).total,
      26,
      "Edited questions must be hidden until resynchronized.",
    );
    await drain();
    assert.notEqual((await search()).questions[0].id, existing);
    await executeCommand({ id: "teacher" }, { type: "question.delete", id: geometry });
    assert.equal((await search("几何")).total, 26);
    await drain();
    assert.equal(await runQuestionIndexOnce(), false, "Repeated worker polling is idempotent.");
    console.log("✓ Create, edit, delete and idempotent outbox synchronization pass.");

    const raceId = (await save("二次函数慢请求")).id;
    const started = new Promise<void>((resolve) => {
      embeddingStarted = resolve;
    });
    const slow = runQuestionIndexOnce();
    await started;
    await save("几何慢请求已更新", raceId);
    await runQuestionIndexOnce();
    holdEmbedding!();
    await slow;
    assert.equal((await search("几何")).questions[0].id, raceId);
    const pointCount = await fetch(
      `${process.env.QDRANT_URL}/collections/${prefix}_${versions[0]}/points/count`,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ exact: true }),
      },
    );
    assert.equal(
      (await pointCount.json()).result.count,
      await db.question.count(),
      "Deleted and superseded points must be removed from Qdrant.",
    );
    console.log("✓ A slow superseded embedding cannot overwrite the current revision's vector.");

    broken = true;
    const failed = (await save("二次函数服务失败")).id;
    await drain();
    const status = await loadAdmin("admin");
    assert.equal(status.searchIndex.failed, 1);
    assert(!JSON.stringify(status).includes("sensitive failure"));
    assert(!JSON.stringify(status).includes("local-test-embedding-key"));
    assert(await db.question.findUnique({ where: { id: failed } }));
    const callsAfterFailure = calls;
    await runQuestionIndexOnce();
    assert.equal(calls, callsAfterFailure, "Failures must not retry paid requests automatically.");
    broken = false;
    wrongDimensions = true;
    await save("二次函数错误维度", failed);
    await drain();
    assert.match((await loadAdmin("admin")).searchIndex.lastError ?? "", /维度/);
    wrongDimensions = false;
    const workingQdrant = process.env.QDRANT_URL;
    const callsBeforeOutage = calls;
    process.env.QDRANT_URL = "http://127.0.0.1:1";
    await save("二次函数向量库中断", failed);
    await drain();
    assert.equal(
      calls,
      callsBeforeOutage,
      "A Qdrant outage must fail before spending model tokens.",
    );
    assert.equal((await queryQuestionBank(db, actor, { q: "向量库中断" })).total, 1);
    process.env.QDRANT_URL = workingQdrant;
    await configure({ ...settings, dimensions: 4, model: "local-test-v2" });
    const nextVersion = (
      await db.embeddingSetting.findUniqueOrThrow({ where: { id: "question-bank" } })
    ).version;
    assert.notEqual(nextVersion, versions[0]);
    versions.push(nextVersion);
    assert.equal(
      (await search()).total,
      0,
      "Old model vectors must not be mixed with a new model.",
    );
    await executeAdmin("admin", adminCommandSchema.parse({ type: "embedding.reindex" }));
    await drain();
    assert.equal((await loadAdmin("admin")).searchIndex.failed, 0);
    assert((await search()).total > 0);
    await configure({ ...settings, dimensions: 4, model: "local-test-v2", enabled: false });
    await save("停用期间二次函数变更", failed);
    assert.equal(await runQuestionIndexOnce(), false);
    await assert.rejects(search(), /尚未启用/);
    assert.equal((await queryQuestionBank(db, actor, { q: "停用期间" })).total, 1);
    await configure({ ...settings, dimensions: 4, model: "local-test-v2" });
    await drain();
    assert((await search()).questions.some((row) => row.id === failed));
    console.log(
      "✓ Model failure isolation, safe diagnostics, no automatic paid retry, dimension/version isolation and disabled-period edits pass.",
    );
    console.log(
      `Semantic search acceptance passed (${calls} local embedding HTTP requests; no external model calls).`,
    );
  } finally {
    holdEmbedding?.();
    globals.paperDb = previous;
    for (const version of versions)
      await fetch(`${process.env.QDRANT_URL}/collections/${prefix}_${version}`, {
        method: "DELETE",
        headers,
      }).catch(() => undefined);
    await db.$disconnect();
    await sql.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
    await sql.end();
    await new Promise<void>((resolve) => embeddingServer.close(() => resolve()));
    if (qdrant && qdrant.exitCode === null) {
      qdrant.kill("SIGTERM");
      await new Promise<void>((resolve) => qdrant!.once("exit", () => resolve()));
    }
    await rm(temp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
