import "server-only";
import { randomUUID } from "node:crypto";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/config/env";
import { logEvent } from "@/server/logger";
import { FRAMEWORK_PING_QUEUE, pingJobSchema } from "@/contracts/jobs";
import { createJobClient, initializeQueues } from "./client";
import { EXAM_PARSE_QUEUE } from "@/contracts/exam-tasks";
import { examJobSchema, processExamTask } from "@/server/exams/tasks";
import { GRADING_QUEUE } from "@/contracts/grading";
import { PRACTICE_QUEUE } from "@/contracts/learning";
import { processPractice } from "@/server/learning/practice";
import { continueQuickGrade } from "@/server/pipeline/quick-grade";
import { gradingJobSchema, processGradeTask } from "@/server/grading/tasks";

export async function startWorker() {
  const boss = createJobClient(true);
  try {
    await boss.start({ attempts: 5 });
    await initializeQueues(boss);
    await boss.work(
      PRACTICE_QUEUE,
      { localConcurrency: getEnv().WORKER_CONCURRENCY, pollingIntervalSeconds: 1 },
      async (jobs) => {
        for (const job of jobs)
          await processPractice(examJobSchema.parse(job.data).taskId, job.id, job.signal);
      },
    );
    await boss.work(
      GRADING_QUEUE,
      { localConcurrency: getEnv().WORKER_CONCURRENCY, pollingIntervalSeconds: 1 },
      async (jobs) => {
        for (const job of jobs)
          await processGradeTask(gradingJobSchema.parse(job.data).taskId, job.id, job.signal);
      },
    );
    await boss.work(
      EXAM_PARSE_QUEUE,
      { localConcurrency: getEnv().WORKER_CONCURRENCY, pollingIntervalSeconds: 1 },
      async (jobs) => {
        for (const job of jobs) {
          const { taskId } = examJobSchema.parse(job.data);
          await processExamTask(taskId, job.id, job.signal);
          await continueQuickGrade(taskId);
        }
      },
    );
    await boss.work(
      FRAMEWORK_PING_QUEUE,
      { localConcurrency: getEnv().WORKER_CONCURRENCY, pollingIntervalSeconds: 1 },
      async (jobs) => {
        for (const job of jobs) {
          pingJobSchema.parse(job.data);
          logEvent("queue.ping.completed", { queue: FRAMEWORK_PING_QUEUE, jobId: job.id });
        }
        return { ok: true };
      },
    );
    // Exercise scheduling without creating business jobs or invoking models.
    await boss.schedule(
      FRAMEWORK_PING_QUEUE,
      "*/15 * * * *",
      { message: "scheduled-ping" },
      { tz: "UTC" },
    );
    const id = randomUUID();
    const beat = () =>
      getDb().workerHeartbeat.upsert({
        where: { id },
        create: { id },
        update: { updatedAt: new Date() },
      });
    await beat();
    await continueQuickGrade();
    const timer = setInterval(
      () => void beat().catch(() => logEvent("worker.heartbeat.failed")),
      10_000,
    );
    timer.unref();
    const sweep = setInterval(
      () => void continueQuickGrade().catch(() => logEvent("pipeline.sweep.failed")),
      30_000,
    );
    sweep.unref();
    boss.once("stopped", () => {
      clearInterval(timer);
      clearInterval(sweep);
      void getDb()
        .workerHeartbeat.deleteMany({ where: { id } })
        .catch(() => undefined);
    });
    return boss;
  } catch {
    await boss.stop().catch(() => undefined);
    throw new Error("Worker queue startup failed.");
  }
}
