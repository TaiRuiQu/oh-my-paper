import "server-only";
import { getEnv } from "@/server/config/env";
import { logEvent } from "@/server/logger";
import { FRAMEWORK_PING_QUEUE, pingJobSchema } from "@/contracts/jobs";
import { createJobClient, initializeQueues } from "./client";
import { EXAM_PARSE_QUEUE } from "@/contracts/exam-tasks";
import { examJobSchema, processExamTask } from "@/server/exams/tasks";
import { GRADING_QUEUE } from "@/contracts/grading";
import { gradingJobSchema, processGradeTask } from "@/server/grading/tasks";

export async function startWorker() {
  const boss = createJobClient(true);
  try {
    await boss.start({ attempts: 5 });
    await initializeQueues(boss);
    await boss.work(GRADING_QUEUE, { localConcurrency: getEnv().WORKER_CONCURRENCY, pollingIntervalSeconds: 1 }, async (jobs) => {
      for (const job of jobs) await processGradeTask(gradingJobSchema.parse(job.data).taskId, job.id, job.signal);
    });
    await boss.work(EXAM_PARSE_QUEUE, { localConcurrency: getEnv().WORKER_CONCURRENCY, pollingIntervalSeconds: 1 }, async (jobs) => {
      for (const job of jobs) {
        const { taskId } = examJobSchema.parse(job.data);
        await processExamTask(taskId, job.id, job.signal);
      }
    });
    await boss.work(FRAMEWORK_PING_QUEUE, { localConcurrency: getEnv().WORKER_CONCURRENCY, pollingIntervalSeconds: 1 }, async (jobs) => {
      for (const job of jobs) {
        pingJobSchema.parse(job.data);
        logEvent("queue.ping.completed", { queue: FRAMEWORK_PING_QUEUE, jobId: job.id });
      }
      return { ok: true };
    });
    // Exercise scheduling without creating business jobs or invoking models.
    await boss.schedule(FRAMEWORK_PING_QUEUE, "*/15 * * * *", { message: "scheduled-ping" }, { tz: "UTC" });
    return boss;
  } catch {
    await boss.stop().catch(() => undefined);
    throw new Error("Worker queue startup failed.");
  }
}
