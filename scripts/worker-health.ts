import { loadEnvironment } from "./load-env.mjs";
loadEnvironment();
async function main() {
  const { workerAvailable } = await import("../src/server/jobs/health");
  const { disconnectDatabase } = await import("../src/server/db/client");
  try {
    process.exitCode = (await workerAvailable()) ? 0 : 1;
  } finally {
    await disconnectDatabase();
  }
}
main().catch(() => {
  process.exitCode = 1;
});
