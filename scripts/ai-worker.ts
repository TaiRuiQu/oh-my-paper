import { randomUUID } from "node:crypto";
import { loadEnvironment } from "./load-env.mjs";
loadEnvironment();

async function main() {
  const { assertSandboxEnvironment } = await import("../src/server/ai/sandbox");
  assertSandboxEnvironment();
  const { claimAiJob, runClaimedAiJob } = await import("../src/server/platform/ai-jobs");
  const { disconnectDatabase } = await import("../src/server/db/client");
  const { logEvent, logError } = await import("../src/server/logger");
  const { runQuestionIndexOnce } = await import("../src/server/platform/search/indexer");
  const { runXiaozhiWorker } = await import("../src/server/xiaozhi/worker");
  const workerId = randomUUID();
  let stopping = false;
  process.on("SIGINT", () => {
    stopping = true;
  });
  process.on("SIGTERM", () => {
    stopping = true;
  });
  logEvent("platform.ai.worker.started", { workerId });
  const indexing = async () => {
    while (!stopping) {
      try {
        if (!(await runQuestionIndexOnce()))
          await new Promise((resolve) => setTimeout(resolve, 1500));
      } catch (error) {
        logError("platform.search.worker.poll.failed", error);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  };
  const indexingTask = indexing();
  const xiaozhiTask = runXiaozhiWorker(workerId, () => stopping);
  try {
    while (!stopping) {
      try {
        const job = await claimAiJob(workerId);
        if (job) await runClaimedAiJob(job, workerId);
        else await new Promise((resolve) => setTimeout(resolve, 1500));
      } catch (error) {
        logError("platform.ai.worker.poll.failed", error);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  } finally {
    stopping = true;
    await indexingTask;
    await xiaozhiTask;
    await disconnectDatabase();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
