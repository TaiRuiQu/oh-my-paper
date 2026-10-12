import "server-only";
import { PgBoss } from "pg-boss";
import { getEnv } from "@/server/config/env";
import { logEvent } from "@/server/logger";
import { FRAMEWORK_PING_QUEUE, pingJobSchema, type PingJob } from "@/contracts/jobs";
import { EXAM_PARSE_QUEUE } from "@/contracts/exam-tasks";
import { PRACTICE_QUEUE } from "@/contracts/learning";
import { GRADING_QUEUE } from "@/contracts/grading";

export function createJobClient(worker = false) {
  const boss = new PgBoss({
    connectionString: getEnv().DATABASE_URL,
    schema: "pgboss",
    supervise: worker,
    schedule: worker,
    connectionTimeoutMillis: 5000,
  });
  boss.on("error", () => logEvent("queue.error"));
  return boss;
}

export async function initializeQueues(boss: PgBoss) {
  await boss.createQueue(FRAMEWORK_PING_QUEUE, { retryLimit: 3, retryDelay: 2, retryBackoff: true, expireInSeconds: 60 });
  await boss.createQueue(EXAM_PARSE_QUEUE, { retryLimit: 2, retryDelay: 10, expireInSeconds: 43200, heartbeatSeconds: 60 });
  await boss.createQueue(PRACTICE_QUEUE, { retryLimit: 2, retryDelay: 10, expireInSeconds: 900, heartbeatSeconds: 60 });
  await boss.createQueue(GRADING_QUEUE, { retryLimit: 2, retryDelay: 10, expireInSeconds: 43200, heartbeatSeconds: 60 });
}

let producer: Promise<PgBoss> | undefined;

export function getJobProducer() {
  producer ??= (async () => {
    const boss = createJobClient();
    try {
      await boss.start({ attempts: 5 });
      await initializeQueues(boss);
      return boss;
    } catch {
      await boss.stop().catch(() => undefined);
      producer = undefined;
      throw new Error("Queue unavailable.");
    }
  })();
  return producer;
}

export async function enqueuePing(data: PingJob) {
  return (await getJobProducer()).send(FRAMEWORK_PING_QUEUE, pingJobSchema.parse(data));
}
