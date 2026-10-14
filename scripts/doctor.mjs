import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { loadEnvironment } from "./load-env.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
loadEnvironment();
const pgBin = resolve(root, ".tools/postgresql/usr/lib/postgresql/18/bin");
const toolEnv = {
  ...process.env,
  LD_LIBRARY_PATH: [
    resolve(root, ".tools/postgresql/usr/lib/x86_64-linux-gnu"),
    process.env.LD_LIBRARY_PATH,
  ]
    .filter(Boolean)
    .join(":"),
};
let failures = 0;
async function check(name, action) {
  try {
    const detail = await action();
    console.log(`✓ ${name}${detail ? ": " + detail : ""}`);
  } catch (error) {
    failures++;
    const { redactErrorText } = await import("../src/lib/error-message.ts");
    console.error(
      `✗ ${name}: ${redactErrorText(
        error.message || String(error),
        Object.entries(process.env)
          .filter(([key]) => /SECRET|PASSWORD|TOKEN|API_KEY|DATABASE_URL|ENCRYPTION_KEY/i.test(key))
          .map(([, value]) => value)
          .filter(Boolean),
      )} ${error.code || ""}`,
    );
  }
}
function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: toolEnv,
    encoding: "utf8",
    timeout: 15000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${command} exited with status ${result.status}: ${(result.stdout + result.stderr).trim()}`,
    );
  return (result.stdout + result.stderr).trim();
}
await check("Node.js / pnpm", () => {
  assert.equal(process.versions.node.split(".")[0], "24");
  const pnpm = run("pnpm", ["--version"]);
  assert.equal(pnpm.split(".")[0], "11");
  return `${process.version} / ${pnpm}`;
});
await check("项目依赖", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  const packages = { ...manifest.dependencies, ...manifest.devDependencies };
  for (const [name, expected] of Object.entries(packages)) {
    const installed = JSON.parse(
      readFileSync(resolve("node_modules", name, "package.json"), "utf8"),
    );
    assert.equal(installed.version, expected, name);
  }
  return `${Object.keys(packages).length} 个直接依赖版本匹配`;
});
await check("Poppler 页面检查和渲染工具", () => {
  const versions = [
    run(process.env.PDFTOPPM_PATH || "pdftoppm", ["-v"]),
    run(process.env.PDFINFO_PATH || "pdfinfo", ["-v"]),
  ];
  return versions.map((text) => text.split("\n")[0]).join(" / ");
});
await check("本地 Python 沙箱 / 图像与数值计算库", () =>
  run(process.execPath, [
    "--conditions=react-server",
    "--import",
    "tsx",
    "scripts/check-python-sandbox.ts",
  ]),
);
await check("中文字体", () => {
  const fonts = run("fc-match", ["Noto Sans CJK SC:lang=zh"]);
  assert.match(fonts, /Noto.*CJK/);
  return fonts;
});
await check("Sharp 图像处理", async () => {
  const { default: sharp } = await import("sharp");
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#fff" } })
    .png()
    .toBuffer();
  assert.equal((await sharp(png).metadata()).width, 2);
  return "PNG 创建和读取通过";
});
await check("AI SDK", async () => {
  const { generateText, Output } = await import("ai");
  assert.equal(typeof generateText, "function");
  assert.equal(typeof Output.object, "function");
  return "结构化生成可用";
});
await check("PostgreSQL 工具", () => run(resolve(pgBin, "psql"), ["--version"]));
await check("PostgreSQL 连接", async () => {
  assert.ok(process.env.DATABASE_URL);
  const { Client } = await import("pg");
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
    query_timeout: 5000,
  });
  try {
    await client.connect();
    const result = await client.query(
      "SELECT current_database() AS db, current_setting('server_version') AS version",
    );
    return `${result.rows[0].db} / ${result.rows[0].version}`;
  } finally {
    await client.end();
  }
});
await check("工程配置 / Prisma / 认证表 / 存储目录", () =>
  run(process.execPath, [
    "--conditions=react-server",
    "--import",
    "tsx",
    "-e",
    `(async () => {
    const { loadEnvironment } = await import('./scripts/load-env.mjs');
    loadEnvironment();
    const { getEnv } = await import('./src/server/config/env.ts');
    const { getDb, disconnectDatabase } = await import('./src/server/db/client.ts');
    const { initializeStorage } = await import('./src/server/storage.ts');
    getEnv();
    try {
      await getDb().user.count();
      await getDb().exam.count();
      await initializeStorage();
      console.log('环境校验、Prisma 查询与文件目录检查通过');
    } finally { await disconnectDatabase(); }
  })().catch(async error => { const {logError}=await import('./src/server/logger.ts'); logError('doctor.foundation.failed',error); process.exitCode = 1; });`,
  ]),
);
process.exitCode = failures ? 1 : 0;
