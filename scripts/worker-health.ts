import { loadEnvironment } from "./load-env.mjs";
loadEnvironment();
async function main() {
  const { workerAvailable } = await import("../src/server/jobs/health");
  const { disconnectDatabase } = await import("../src/server/db/client");
  try {
    if (!(await workerAvailable())) {
      const { logError } = await import("../src/server/logger");
      logError(
        "worker.healthcheck.offline",
        new Error("No fresh worker heartbeat in the last 45 seconds."),
      );
      process.exitCode = 1;
    }
  } finally {
    await disconnectDatabase();
  }
}
main().catch(async (error) => {
  const { logError } = await import("../src/server/logger");
  logError("worker.healthcheck.failed", error);
  process.exitCode = 1;
});
