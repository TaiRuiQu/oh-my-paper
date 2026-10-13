import { loadEnvironment } from "../scripts/load-env.mjs";

if (process.argv.includes("--production")) Object.assign(process.env, { NODE_ENV: "production" });
loadEnvironment();

async function main() {
  // Environment is loaded before importing shared server modules.
  const { connectDatabase, disconnectDatabase } = await import("../src/server/db/client");
  const { initializeStorage } = await import("../src/server/storage");
  const { startWorker } = await import("../src/server/jobs/worker");
  const { logEvent, logError } = await import("../src/server/logger");
  await connectDatabase();
  await initializeStorage();
  const boss = await startWorker();
  logEvent("worker.ready");
  // Surface sandbox environment problems at boot instead of on the first exam:
  // container runtimes or host kernels may deny the mounts bwrap needs.
  const { verifySandboxEnvironment } = await import("../src/server/exams/python-sandbox");
  const sandbox = verifySandboxEnvironment();
  if (!sandbox.ok)
    logEvent("worker.sandbox.unavailable", {
      diagnostic: sandbox.diagnostic || "未知原因",
      remediation: sandbox.remediation || "",
    });

  let stopping = false;
  async function shutdown(signal: string) {
    if (stopping) return;
    stopping = true;
    logEvent("worker.stopping", { signal });
    const deadline = setTimeout(() => process.exit(1), 35_000);
    deadline.unref();
    try {
      await boss.stop({ graceful: true, timeout: 30_000 });
      await disconnectDatabase();
      clearTimeout(deadline);
      process.exit(0);
    } catch (error) {
      logError("worker.shutdown.failed", error, { signal });
      process.exit(1);
    }
  }
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch(async (error) => {
  const { logError } = await import("../src/server/logger");
  logError("worker.startup.failed", error);
  process.exit(1);
});
