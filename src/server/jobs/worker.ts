import "server-only";
import { randomUUID } from "node:crypto";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/config/env";
import { logError } from "@/server/logger";
import { createJobClient, initializeQueues } from "./client";
import { EXAM_PARSE_QUEUE } from "@/contracts/exam-tasks";
import { examJobSchema, processExamTask } from "@/server/exams/tasks";
import { EXAM_AGENT_QUEUE } from "@/contracts/exam-agents";
import { agentJobSchema, processAgentTask } from "@/server/exams/agent-tasks";
import { WORKFLOW_QUEUE } from "@/contracts/workflows";
import { processWorkflow, workflowJobSchema } from "@/server/exams/workflows";
import { CARD_TEMPLATE_QUEUE, CARD_BATCH_QUEUE } from "@/contracts/answer-cards";
import { cardJobSchema, processCardTemplate, processCardBatch } from "@/server/answer-cards/tasks";
export async function startWorker() {
  const boss = createJobClient(true);
  try {
    await boss.start({ attempts: 5 });
    await initializeQueues(boss);
    await boss.work(
      EXAM_PARSE_QUEUE,
      { localConcurrency: getEnv().WORKER_CONCURRENCY, pollingIntervalSeconds: 1 },
      async (jobs) => {
        for (const job of jobs) {
          const parsed = examJobSchema.safeParse(job.data);
          if (!parsed.success) {
            logError("worker.job.invalid", parsed.error, {
              jobId: job.id,
              queue: EXAM_PARSE_QUEUE,
            });
            throw parsed.error;
          }
          await processExamTask(parsed.data.taskId, job.id, job.signal);
        }
      },
    );
    await boss.work(
      EXAM_AGENT_QUEUE,
      { localConcurrency: getEnv().WORKER_CONCURRENCY, pollingIntervalSeconds: 1 },
      async (jobs) => {
        for (const job of jobs) {
          const parsed = agentJobSchema.parse(job.data);
          await processAgentTask(parsed.taskId, job.id, job.signal);
        }
      },
    );
    await boss.work(
      WORKFLOW_QUEUE,
      { localConcurrency: 2, pollingIntervalSeconds: 1 },
      async (jobs) => {
        for (const job of jobs)
          await processWorkflow(workflowJobSchema.parse(job.data).workflowId, job.id);
      },
    );
    for (const [queue, process] of [
      [CARD_TEMPLATE_QUEUE, processCardTemplate],
      [CARD_BATCH_QUEUE, processCardBatch],
    ] as const)
      await boss.work(
        queue,
        { localConcurrency: getEnv().WORKER_CONCURRENCY, pollingIntervalSeconds: 1 },
        async (jobs) => {
          for (const job of jobs)
            await process(cardJobSchema.parse(job.data).id, job.id, job.signal);
        },
      );
    const id = randomUUID();
    const beat = () =>
      getDb().workerHeartbeat.upsert({
        where: { id },
        create: { id },
        update: { updatedAt: new Date() },
      });
    await beat();
    const timer = setInterval(
      () =>
        void beat().catch((error) => {
          logError("worker.heartbeat.failed", error);
        }),
      10_000,
    );
    timer.unref();
    boss.once("stopped", () => {
      clearInterval(timer);
      void getDb()
        .workerHeartbeat.deleteMany({ where: { id } })
        .catch((error) => {
          logError("worker.heartbeat.cleanup.failed", error);
        });
    });
    return boss;
  } catch (error) {
    await boss.stop().catch((cleanupError) => {
      logError("worker.queue.cleanup.failed", cleanupError);
    });
    throw error;
  }
}
