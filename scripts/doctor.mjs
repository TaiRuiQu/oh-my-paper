import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { loadEnvironment } from "./load-env.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
loadEnvironment();
let failures = 0;
async function check(name, action) {
  try {
    const detail = await action();
    console.log(`✓ ${name}${detail ? `: ${detail}` : ""}`);
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
      )}`,
    );
  }
}
function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
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
await check("Python / OpenCV / NumPy / Pillow", () => {
  const python =
    process.env.CARD_SCAN_PYTHON ||
    (existsSync(resolve(".venv/bin/python")) ? resolve(".venv/bin/python") : "python3");
  assert.ok(existsSync(resolve("tools/card-scan/scan.py")));
  return run(python, [
    "-c",
    "import cv2,numpy,PIL; print('OpenCV '+cv2.__version__+' / NumPy '+numpy.__version__+' / Pillow '+PIL.__version__)",
  ]);
});
await check("PDF 页面处理（Poppler）", () => {
  const info = run("pdfinfo", ["-v"]);
  const renderer = run("pdftoppm", ["-v"]);
  return `${info.split("\n")[0]} / ${renderer.split("\n")[0]}`;
});
await check("PDF 导出（Chromium）", () =>
  run(process.execPath, [
    "--conditions=react-server",
    "--import",
    "tsx",
    "-e",
    `(async()=>{const {chromiumPath}=await import('./src/server/platform/pdf-export.ts');const {execFileSync}=await import('node:child_process');console.log(execFileSync(await chromiumPath(),['--version'],{encoding:'utf8'}).trim());})().catch(error=>{console.error(error.message);process.exitCode=1;});`,
  ]),
);
await check("Sharp 图像处理", async () => {
  const { default: sharp } = await import("sharp");
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#fff" } })
    .png()
    .toBuffer();
  assert.equal((await sharp(png).metadata()).width, 2);
  return "PNG 创建和读取通过";
});
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
await check("v2 Prisma 数据模型 / 认证 / 存储目录", () =>
  run(process.execPath, [
    "--conditions=react-server",
    "--import",
    "tsx",
    "-e",
    `(async()=>{const {loadEnvironment}=await import('./scripts/load-env.mjs');loadEnvironment();const {getEnv}=await import('./src/server/config/env.ts');const {getDb,disconnectDatabase}=await import('./src/server/db/client.ts');const {initializeStorage}=await import('./src/server/storage.ts');getEnv();try{const db=getDb();await Promise.all([db.user.count(),db.question.count(),db.paper.count(),db.assessment.count(),db.scanSubmission.count(),db.review.count(),db.platformAsset.count()]);await initializeStorage();console.log('v2业务表与存储检查通过');}finally{await disconnectDatabase();}})().catch(async error=>{const {logError}=await import('./src/server/logger.ts');logError('doctor.platform.failed',error);process.exitCode=1;});`,
  ]),
);
process.exitCode = failures ? 1 : 0;
