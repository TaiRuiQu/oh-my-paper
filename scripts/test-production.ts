import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadEnvironment } from "./load-env.mjs";
loadEnvironment();

async function main() {
  const root = process.cwd();
  const directory = await mkdtemp(join(tmpdir(), "omp-production-"));
  const processes: ChildProcess[] = [];
  const logs: string[] = [];
  const origin = "http://localhost:3005";
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
    BETTER_AUTH_URL: origin,
    PORT: "3005",
    HOSTNAME: "127.0.0.1",
    STORAGE_ROOT: resolve("storage"),
    TEMP_ROOT: resolve("tmp"),
    CARD_SCAN_PYTHON: process.env.CARD_SCAN_PYTHON || resolve(".venv/bin/python"),
    PYTHON_SANDBOX_VENV: process.env.PYTHON_SANDBOX_VENV || resolve(".venv"),
  };
  const start = (cmd: string, args: string[], cwd: string) => {
    const child = spawn(cmd, args, { cwd, env: environment, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout?.on("data", (chunk) => logs.push(String(chunk)));
    child.stderr?.on("data", (chunk) => logs.push(String(chunk)));
    processes.push(child);
    return child;
  };
  const finished = (child: ChildProcess) =>
    new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolve(code));
    });
  try {
    await cp(".next/standalone", join(directory, "web"), {
      recursive: true,
      verbatimSymlinks: true,
    });
    await mkdir(join(directory, "web/.next/static"), { recursive: true });
    await cp(".next/static", join(directory, "web/.next/static"), { recursive: true });
    await cp("public", join(directory, "web/public"), { recursive: true });
    await cp("tools/card-scan", join(directory, "web/tools/card-scan"), { recursive: true });
    await cp("build/ai-worker", join(directory, "worker"), {
      recursive: true,
      verbatimSymlinks: true,
    });
    const web = start(process.execPath, ["server.js"], join(directory, "web"));
    const worker = start(
      process.execPath,
      ["--conditions=react-server", "worker.mjs"],
      join(directory, "worker"),
    );
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      if (web.exitCode !== null || worker.exitCode !== null)
        throw new Error("Production artifact exited early");
      try {
        ready = (await fetch(`${origin}/api/health`)).ok;
      } catch {
        /* startup */
      }
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    assert(ready, "Standalone health must become available");
    assert.equal((await fetch(`${origin}/login`)).status, 200);
    assert(
      logs.some((line) => line.includes("platform.ai.worker.started")),
      "Independent worker must start without workspace dependencies",
    );
    console.log(
      "✓ Independent production Web and AI Worker start with only packaged runtime files",
    );
    const sandbox = start(
      process.execPath,
      ["--conditions=react-server", "sandbox-check.mjs"],
      join(directory, "worker"),
    );
    assert.equal(
      await finished(sandbox),
      0,
      "Packaged Python/shell sandbox must pass isolation checks",
    );
    console.log(
      "✓ Independently packaged Python/shell tools pass the full Bubblewrap isolation acceptance",
    );
    const http = start(
      process.execPath,
      ["--conditions=react-server", "--import", "tsx", "scripts/test-platform-http.ts"],
      root,
    );
    assert.equal(
      await finished(http),
      0,
      "HTTP workflow must pass against independent standalone server",
    );
    console.log(
      "✓ Production HTTP workflow, authenticated Word/SVG exports, server PDF rejection, role/session/CSRF, private diagrams, exam-scoped analytics and official peer ranks pass",
    );
    await writeFile(
      "v2-docs/evidence/production.json",
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          success: true,
          assertions: [
            "Web standalone复制到独立临时目录启动",
            "AI Worker独立打包启动",
            "独立打包的Python和shell通过真实Bubblewrap隔离验收",
            "真实HTTP注册角色、业务闭环、私有配图与学情筛选验证通过",
            "Word与答题卡SVG鉴权下载通过，PDF接口明确要求使用客户端浏览器",
          ],
          limits: [
            "使用本机Node/Python/PostgreSQL，未替代Docker或实体扫描仪验收",
            "客户端保存PDF及本机字体需在浏览器中独立验收",
          ],
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(logs.slice(-30).join("").slice(-10_000));
    throw error;
  } finally {
    for (const child of processes) if (child.exitCode === null) child.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 1000));
    for (const child of processes) if (child.exitCode === null) child.kill("SIGKILL");
    await rm(directory, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
