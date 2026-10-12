import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { EXAM_PARSE_QUEUE, type ExamTaskSummary } from "@/contracts/exam-tasks";
import type { DigitalExam } from "@/contracts/exams";
import { providerSchema } from "@/contracts/ai-providers";
import { getDb } from "@/server/db/client";
import type { ExamTask } from "@/generated/prisma/client";
import { getStoragePaths } from "@/server/config/env";
import { AccessError, RequestError } from "@/server/http/errors";
import { getActiveProvider } from "@/server/ai/settings";
import { decryptApiKey } from "@/server/ai/credentials";
import { createProviderExamModel } from "@/server/ai/providers";
import { getJobProducer } from "@/server/jobs/client";
import { enqueueInTransaction } from "@/server/jobs/transaction";
import { receiveExamUpload } from "./uploads";
import { requireWorker } from "@/server/jobs/health";
import { parseExam } from "./parser";

export const examJobSchema = z.object({ taskId: z.uuid() });

export function taskSummary(task: ExamTask): ExamTaskSummary {
  return { id: task.id, name: task.name, status: task.status, page: task.page, totalPages: task.totalPages,
    phase: task.phase, error: task.error, outputKey: task.outputKey, model: task.model, createdAt: task.createdAt.toISOString() };
}

export async function listExamTasks(userId: string) {
  const tasks = await getDb().examTask.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 50 });
  return (await Promise.all(tasks.map(reconcileTask))).map(taskSummary);
}

async function reconcileTask(task: ExamTask) {
  if (!["QUEUED", "RUNNING"].includes(task.status)) return task;
  try {
    const job = await (await getJobProducer()).getJobById(EXAM_PARSE_QUEUE, task.jobId);
    if (!job || ["failed", "cancelled", "completed"].includes(job.state)) {
      await getDb().examTask.updateMany({ where: { id: task.id, jobId: task.jobId, status: { in: ["QUEUED", "RUNNING"] } },
        data: { status: "FAILED", phase: "failed", error: "后台任务已中断，请重新识别。" } });
      return await getDb().examTask.findUniqueOrThrow({ where: { id: task.id } });
    }
  } catch { /* A temporary queue outage must not prevent reading existing tasks. */ }
  return task;
}

export async function ownedExamTask(userId: string, id: string) {
  if (!z.uuid().safeParse(id).success) throw new AccessError(404, "试卷不存在。");
  const task = await getDb().examTask.findFirst({ where: { id, userId } });
  if (!task) throw new AccessError(404, "试卷不存在或无权访问。");
  return reconcileTask(task);
}

export function taskDirectory(id: string) {
  if (!z.uuid().safeParse(id).success) throw new Error("Invalid task identifier.");
  return join(getStoragePaths().storage, "exam-tasks", id);
}

export async function taskResult(task: ExamTask): Promise<DigitalExam | null> {
  if (task.status !== "COMPLETED" || !task.outputKey) return null;
  return JSON.parse(await readFile(join(taskDirectory(task.id), task.outputKey, "exam.json"), "utf8")) as DigitalExam;
}

export async function createExamTask(request: Request, userId: string, options: { autoGrade?: boolean; studentId?: string; batchId?: string } = {}) {
  await requireWorker();
  const provider = await getActiveProvider();
  const boss = await getJobProducer();
  const id = randomUUID(), jobId = randomUUID();
  const directory = taskDirectory(id);
  const uploaded = await receiveExamUpload(request, join(directory, "inputs"));
  try {
    const task = await getDb().$transaction(async (tx) => {
      // Serialize submissions per user, so concurrent requests cannot bypass the cap.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      const active = await tx.examTask.count({ where: { userId, status: { in: ["QUEUED", "RUNNING"] } } });
      if (active >= (options.batchId ? 100 : 3)) throw new RequestError(429, "你已有 3 份试卷正在识别，请等待完成后再上传。");
      const task = await tx.examTask.create({ data: { id, jobId, userId, name: uploaded[0].name,
        inputFiles: uploaded.map((_, index) => `inputs/${index + 1}.upload`),
        providerSnapshot: provider, model: provider.model, ...options } });
      await enqueueInTransaction(tx, boss, EXAM_PARSE_QUEUE, { taskId: id }, jobId);
      return task;
    });
    return taskSummary(task);
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function retryExamTask(userId: string, id: string) {
  await ownedExamTask(userId, id);
  await requireWorker();
  const provider = await getActiveProvider();
  const boss = await getJobProducer();
  const jobId = randomUUID();
  await getDb().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    if (await tx.examTask.count({ where: { userId, status: { in: ["QUEUED", "RUNNING"] } } }) >= 3) {
      throw new RequestError(429, "请等待当前识别任务完成后再重试。");
    }
    const updated = await tx.examTask.updateMany({ where: { id, userId, status: { in: ["FAILED", "COMPLETED"] } },
      data: { status: "QUEUED", jobId, providerSnapshot: provider, model: provider.model, attempt: null, outputKey: null,
        page: 0, totalPages: 0, phase: "queued", error: null } });
    if (!updated.count) throw new RequestError(409, "试卷正在识别中，请勿重复提交。");
    await enqueueInTransaction(tx, boss, EXAM_PARSE_QUEUE, { taskId: id }, jobId);
  });
}

export async function processExamTask(id: string, jobId: string, signal: AbortSignal) {
  const task = await getDb().examTask.findUnique({ where: { id } });
  if (!task || task.jobId !== jobId || !["QUEUED", "RUNNING"].includes(task.status)) return;
  const attempt = randomUUID();
  const claimed = await getDb().examTask.updateMany({ where: { id, jobId, status: { in: ["QUEUED", "RUNNING"] } },
    data: { status: "RUNNING", attempt, phase: "preparing", page: 0, totalPages: 0, error: null } });
  if (!claimed.count) return;
  const where = { id, jobId, attempt, status: "RUNNING" as const };
  const taskSignal = AbortSignal.any([signal, AbortSignal.timeout(30 * 60_000)]);
  try {
    const provider = providerSchema.extend({ encryptedApiKey: z.string().min(1) }).parse(task.providerSnapshot);
    const model = createProviderExamModel(provider, decryptApiKey(provider.encryptedApiKey));
    const directory = taskDirectory(id);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const exam = await parseExam({ files: task.inputFiles.map((key) => join(directory, key)),
      outputDir: join(directory, attempt), model, signal: taskSignal, promptPreset: provider.promptPreset,
      onProgress: async ({ page, total, phase }) => {
        await getDb().examTask.updateMany({ where, data: { page, totalPages: total, phase } });
      } });
    const failed = exam.pages.every((page) => page.status === "failed");
    await getDb().examTask.updateMany({ where, data: { status: failed ? "FAILED" : "COMPLETED", outputKey: attempt,
      phase: failed ? "failed" : "done", error: failed ? "未能识别任何页面。请让管理员检查接口、模型的图片能力和 API key，或上传更清晰的试卷后重试。" : null } });
  } catch (error) {
    // An interrupted worker leaves the claim for pg-boss to replay after expiry.
    if (signal.aborted) throw new Error("Exam worker interrupted.");
    await getDb().examTask.updateMany({ where, data: { status: "FAILED", phase: "failed",
      error: "识别失败，请检查文件是否损坏或加密，并让管理员检查 AI 配置后重试。" } });
    // Never log raw provider exceptions, input images, or secrets.
    if (!(error instanceof Error)) return;
  }
}
