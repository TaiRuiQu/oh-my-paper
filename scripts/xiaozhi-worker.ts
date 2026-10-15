import { randomUUID } from "node:crypto";
import { loadEnvironment } from "./load-env.mjs";
loadEnvironment();
async function main() {
  const { runXiaozhiWorker } = await import("../src/server/xiaozhi/worker");
  const { disconnectDatabase } = await import("../src/server/db/client");
  let stopping = false;
  process.on("SIGINT", () => {
    stopping = true;
  });
  process.on("SIGTERM", () => {
    stopping = true;
  });
  try {
    await runXiaozhiWorker(randomUUID(), () => stopping);
  } finally {
    await disconnectDatabase();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
