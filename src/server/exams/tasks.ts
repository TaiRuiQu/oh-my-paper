import "server-only";
import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { EXAM_PARSE_QUEUE, type ExamTaskSummary } from "@/contracts/exam-tasks";
import type { DigitalExam } from "@/contracts/exams";
import { pipelineSnapshotSchema } from "@/contracts/ai-providers";
import { getDb } from "@/server/db/client";
import type { ExamTask } from "@/generated/prisma/client";
import { getStoragePaths } from "@/server/config/env";
import { AccessError, RequestError } from "@/server/http/errors";
import { getPipelineProviderSnapshot } from "@/server/ai/settings";
import { modelsFromSnapshot } from "@/server/ai/pipeline";
import { getJobProducer } from "@/server/jobs/client";
import { enqueueInTransaction } from "@/server/jobs/transaction";
import { receiveExamUpload } from "./uploads";
import { requireWorker } from "@/server/jobs/health";
import { parseExam, persistExam } from "./parser";
import { pipelineRuntime } from "./runtime";
import { solveExamQuestions } from "./solutions";

export const examJobSchema = z.object({ taskId: z.uuid() });

export function taskSummary(task: ExamTask): ExamTaskSummary {
  const workflow = pipelineSnapshotSchema.parse(task.providerSnapshot).workflow;
  return { id: task.id, name: task.name, status: task.status, page: task.page, totalPages: task.totalPages,
    phase: task.phase, error: task.error, outputKey: task.outputKey, autoGrade: task.autoGrade, batchId: task.batchId,
    generateAnswers: workflow.generateAnswers, templateTaskId: workflow.template?.taskId, model: task.model, createdAt: task.createdAt.toISOString() };
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

export async function createExamTask(request: Request, userId: string, options: { autoGrade?: boolean; studentId?: string; batchId?: string; generateAnswers?: boolean; templateTaskId?: string } = {}) {
  await requireWorker();
  const provider = await getPipelineProviderSnapshot();
  provider.workflow.generateAnswers = options.generateAnswers ?? true;
  if (options.templateTaskId) {
    const source = await ownedExamTask(userId, options.templateTaskId), template = await taskResult(source);
    if (!template?.questions.length || !source.outputKey || source.autoGrade) throw new RequestError(409, "请选择已保存的题套。");
    if (template.questions.some((q) => !q.solution?.sufficient || !q.solution.answer.trim())) throw new RequestError(409, "题套标准答案尚未完整，请先补充或生成答案。");
    provider.workflow.template = { taskId: source.id, outputKey: source.outputKey };
  }
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
        providerSnapshot: provider, model: provider.model, autoGrade: options.autoGrade ?? false,
        studentId: options.studentId, batchId: options.batchId } });
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
  const original = await ownedExamTask(userId, id);
  await requireWorker();
  const provider = await getPipelineProviderSnapshot();
  const previous = pipelineSnapshotSchema.parse(original.providerSnapshot).workflow;
  provider.workflow = { ...previous };
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

export async function generateExamSolutionsTask(userId: string, id: string) {
  const original = await ownedExamTask(userId, id), exam = await taskResult(original);
  if (!exam?.questions.length || !original.outputKey) throw new RequestError(409, "请先保存包含题目的题套。");
  await requireWorker();
  const provider = await getPipelineProviderSnapshot(), boss = await getJobProducer(), jobId = randomUUID();
  provider.workflow = { ...pipelineSnapshotSchema.parse(original.providerSnapshot).workflow,
    generateAnswers: true, solveOnly: true, sourceOutputKey: original.outputKey };
  await getDb().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    if (await tx.examTask.count({ where: { userId, status: { in: ["QUEUED", "RUNNING"] } } }) >= 3) throw new RequestError(429, "请等待当前任务完成后再生成答案。");
    const updated = await tx.examTask.updateMany({ where: { id, userId, status: "COMPLETED", outputKey: original.outputKey },
      data: { status: "QUEUED", jobId, providerSnapshot: provider, model: provider.stages.solution?.model ?? provider.model,
        phase: "solving", page: 0, totalPages: exam.questions.length, error: null } });
    if (!updated.count) throw new RequestError(409, "题套已更新，请刷新后重试。");
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
    const { snapshot: provider, model, models, stagePresets } = modelsFromSnapshot(task.providerSnapshot);
    const directory = taskDirectory(id);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const batch = task.batchId ? await getDb().gradeBatch.findUnique({ where: { id: task.batchId }, include: { template: true } }) : null;
    let template: DigitalExam | undefined;
    const templateSource = provider.workflow.template ?? (batch?.templateId && batch.templateOutputKey && batch.template?.userId === task.userId
      ? { taskId: batch.templateId, outputKey: batch.templateOutputKey } : undefined);
    if (templateSource) {
      template = JSON.parse(await readFile(join(taskDirectory(templateSource.taskId), templateSource.outputKey, "exam.json"), "utf8"));
      template!.template = templateSource;
    }
    const onProgress = async ({ page, total, phase }: { page: number; total: number; phase: string }) => {
      await getDb().examTask.updateMany({ where, data: { page, totalPages: total, phase } });
    };
    let exam: DigitalExam;
    if (provider.workflow.solveOnly && provider.workflow.sourceOutputKey) {
      const outputDir = join(directory, attempt);
      await cp(join(directory, provider.workflow.sourceOutputKey), outputDir, { recursive: true });
      exam = JSON.parse(await readFile(join(outputDir, "exam.json"), "utf8"));
      const runtime = pipelineRuntime(exam, model, models, taskSignal, stagePresets);
      await solveExamQuestions({ exam, outputDir, generate: runtime.generate, modelName: runtime.pick("solution").name,
        concurrency: runtime.pick("solution").maxConcurrency ?? 3, generateAnswers: true, signal: taskSignal,
        onProgress: (page, total) => onProgress({ phase: "solving", page, total }) });
      exam.pipeline = { version: exam.pipeline?.version ?? "exam-pipeline-4-crop-agents", generateAnswers: true,
        models: { ...exam.pipeline?.models, solution: runtime.pick("solution").name } };
      exam.verification.status = exam.pages.some((p) => p.status === "failed") ? "partial" :
        exam.verification.findings.length || exam.questions.some((q) => q.status !== "ready") ? "needs_review" : "verified";
      await persistExam(outputDir, exam);
    } else exam = await parseExam({ template,
      ...(templateSource ? { loadTemplateFigure: (key: string) => readFile(join(taskDirectory(templateSource.taskId), templateSource.outputKey, key)) } : {}),
      files: task.inputFiles.map((key) => join(directory, key)),
      outputDir: join(directory, attempt), model, models, stagePresets, signal: taskSignal, promptPreset: provider.promptPreset,
      generateAnswers: provider.workflow.generateAnswers, extractStudentAnswers: task.autoGrade, onProgress });
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
