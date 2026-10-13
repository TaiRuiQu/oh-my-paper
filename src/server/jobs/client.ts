import "server-only";
import { PgBoss } from "pg-boss";
import { getEnv } from "@/server/config/env";
import { logError } from "@/server/logger";
import { EXAM_PARSE_QUEUE } from "@/contracts/exam-tasks";
import { EXAM_AGENT_QUEUE } from "@/contracts/exam-agents";
import { WORKFLOW_QUEUE } from "@/contracts/workflows";
export function createJobClient(worker = false) {
  const boss = new PgBoss({
    connectionString: getEnv().DATABASE_URL,
    schema: getEnv().QUEUE_SCHEMA,
    supervise: worker,
    schedule: false,
    connectionTimeoutMillis: 5000,
  });
  boss.on("error", (error) => {
    logError("queue.error", error, { queue: EXAM_PARSE_QUEUE });
  });
  return boss;
}
export async function initializeQueues(boss: PgBoss) {
  for (const queue of [EXAM_PARSE_QUEUE, EXAM_AGENT_QUEUE, WORKFLOW_QUEUE])
    await boss.createQueue(queue, {
      retryLimit: 2,
      retryDelay: 10,
      expireInSeconds: 1800,
      heartbeatSeconds: 60,
    });
}
let producer: Promise<PgBoss> | undefined;
export function getJobProducer() {
  producer ??= (async () => {
    const boss = createJobClient();
    try {
      await boss.start({ attempts: 5 });
      await initializeQueues(boss);
      return boss;
    } catch (error) {
      await boss.stop().catch((cleanupError) => {
        logError("queue.cleanup.failed", cleanupError);
      });
      producer = undefined;
      throw error;
    }
  })();
  return producer;
}
