import "server-only";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { GRADING_QUEUE, gradeRequestSchema, gradeResultSchema, type GradeSubmission, type GradeReviewInput, type GradeTaskSummary, type GradeResult } from "@/contracts/grading";
import { providerSchema } from "@/contracts/ai-providers";
import type { DigitalExam } from "@/contracts/exams";
import type { GradeTask, Prisma } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { AccessError, RequestError } from "@/server/http/errors";
import { getActiveProvider } from "@/server/ai/settings";
import { decryptApiKey } from "@/server/ai/credentials";
import { createProviderExamModel } from "@/server/ai/providers";
import { ownedExamTask, taskDirectory, taskResult } from "@/server/exams/tasks";
import { getJobProducer } from "@/server/jobs/client";
import { enqueueInTransaction } from "@/server/jobs/transaction";
import { requireWorker } from "@/server/jobs/health";
import { gradeExam } from "./service";
import { GRADING_PROMPT_VERSION } from "./prompts";
import { applyGradeReview } from "./score";
import { questionToText } from "@/lib/grading-defaults";

export const gradingJobSchema = z.object({ taskId: z.uuid() });
const asJSON = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export function gradeTaskSummary(task: GradeTask): GradeTaskSummary {
  return { id: task.id, examTaskId: task.examTaskId, status: task.status, progress: task.progress, total: task.total,
    phase: task.phase, error: task.error, model: task.model, createdAt: task.createdAt.toISOString(), examOutputKey: task.examOutputKey };
}
async function reconcile(task: GradeTask) {
  if (!["QUEUED", "RUNNING"].includes(task.status)) return task;
  try {
    const job = await (await getJobProducer()).getJobById(GRADING_QUEUE, task.jobId);
    if (!job || ["failed", "cancelled", "completed"].includes(job.state)) {
      await getDb().gradeTask.updateMany({ where: { id: task.id, jobId: task.jobId, status: { in: ["QUEUED", "RUNNING"] } },
        data: { status: "FAILED", error: "后台批改已中断，请重新提交批改。", phase: "failed" } });
      return getDb().gradeTask.findUniqueOrThrow({ where: { id: task.id } });
    }
  } catch { /* Preserve access during transient queue outages. */ }
  return task;
}
export async function listGradeTasks(userId: string, examTaskId: string) {
  await ownedExamTask(userId, examTaskId);
  const tasks = await getDb().gradeTask.findMany({ where: { examTaskId }, orderBy: { createdAt: "desc" }, take: 30 });
  return (await Promise.all(tasks.map(reconcile))).map(gradeTaskSummary);
}
export async function ownedGradeTask(userId: string, id: string) {
  if (!z.uuid().safeParse(id).success) throw new AccessError(404, "批改记录不存在。");
  const task = await getDb().gradeTask.findFirst({ where: { id, examTask: { OR: [{ userId }, { student: { accountId: userId } }] } }, include: { examTask: { select: { userId: true } } } });
  if (!task) throw new AccessError(404, "批改记录不存在或无权访问。");
  return { ...await reconcile(task), examTask: task.examTask };
}
export function gradeTaskResult(task: GradeTask): GradeResult | null {
  if (!task.result) return null;
  const result = gradeResultSchema.parse(task.result);
  const input = task.input as unknown as { exam: DigitalExam };
  result.questions = result.questions.map((item) => {
    const question = input.exam.questions.find((q) => q.id === item.questionId);
    return question ? { ...item, questionText: item.questionText || questionToText(question), sourcePage: question.regions[0].page } : item;
  });
  return result;
}

export async function createGradeTask(userId: string, examTaskId: string, submissions: GradeSubmission[]) {
  await requireWorker();
  const task = await ownedExamTask(userId, examTaskId);
  const exam = await taskResult(task);
  if (!exam || !task.outputKey) throw new RequestError(409, "请等待试卷识别完成后再批改。");
  const input = gradeRequestSchema.parse({ submissions });
  const ids = input.submissions.map((s) => s.questionId);
  if (new Set(ids).size !== ids.length || ids.some((id) => !exam.questions.some((q) => q.id === id))) throw new RequestError(400, "批改题目重复或不属于当前试卷。");
  const provider = await getActiveProvider("grading"), boss = await getJobProducer();
  const id = randomUUID(), jobId = randomUUID();
  return getDb().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const current = await tx.examTask.findFirst({ where: { id: examTaskId, userId, status: "COMPLETED", outputKey: task.outputKey } });
    if (!current) throw new RequestError(409, "试卷识别结果已改变，请刷新页面后重新提交。");
    if (await tx.gradeTask.count({ where: { examTaskId, status: { in: ["QUEUED", "RUNNING"] } } })) throw new RequestError(409, "这份试卷已有批改任务，请等待完成。");
    if (await tx.gradeTask.count({ where: { examTask: { userId }, status: { in: ["QUEUED", "RUNNING"] } } }) >= 3) throw new RequestError(429, "已有 3 个批改任务，请等待完成后再提交。");
    const grade = await tx.gradeTask.create({ data: { id, jobId, examTaskId, examOutputKey: task.outputKey!,
      input: asJSON({ exam, submissions: input.submissions }), providerSnapshot: provider, model: provider.model,
      promptVersion: `${GRADING_PROMPT_VERSION}/${provider.promptPreset}`, total: submissions.length } });
    await enqueueInTransaction(tx, boss, GRADING_QUEUE, { taskId: id }, jobId);
    return gradeTaskSummary(grade);
  });
}

export async function reviewGradeTask(userId: string, id: string, input: GradeReviewInput) {
  await ownedGradeTask(userId, id);
  return getDb().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM grade_tasks WHERE id = ${id} FOR UPDATE`;
    const task = await tx.gradeTask.findFirst({ where: { id, examTask: { userId } } });
    if (!task) throw new AccessError(404, "批改记录不存在。");
    if (task.status !== "COMPLETED" || !task.result) throw new RequestError(409, "请等待批改完成后再核对分数。");
    const result = gradeResultSchema.parse(task.result);
    let reviewed;
    try { reviewed = applyGradeReview(result, input, userId, new Date().toISOString()); }
    catch (error) { throw new RequestError(400, error instanceof Error ? error.message : "核对内容无效。"); }
    await tx.gradeTask.update({ where: { id }, data: { result: asJSON(reviewed) } });
    return reviewed;
  });
}

export async function processGradeTask(id: string, jobId: string, signal: AbortSignal) {
  const task = await getDb().gradeTask.findUnique({ where: { id } });
  if (!task || task.jobId !== jobId || !["QUEUED", "RUNNING"].includes(task.status)) return;
  const attempt = randomUUID();
  const claimed = await getDb().gradeTask.updateMany({ where: { id, jobId, status: { in: ["QUEUED", "RUNNING"] } }, data: { status: "RUNNING", attempt, phase: "preparing", error: null } });
  if (!claimed.count) return;
  const where = { id, jobId, attempt, status: "RUNNING" as const };
  try {
    const provider = providerSchema.extend({ encryptedApiKey: z.string() }).parse(task.providerSnapshot);
    const input = task.input as unknown as { exam: DigitalExam; submissions: GradeSubmission[] };
    const model = createProviderExamModel(provider, decryptApiKey(provider.encryptedApiKey));
    const result = await gradeExam({ exam: input.exam, submissions: gradeRequestSchema.parse(input).submissions,
      promptPreset: provider.promptPreset, model, signal: AbortSignal.any([signal, AbortSignal.timeout(2 * 60 * 60 * 1000)]), initialResult: gradeTaskResult(task) ?? undefined,
      loadFigure: async (asset) => {
        if (!asset.cleanKey || !/^figures\/figure-\d+\.png$/.test(asset.cleanKey)) throw new Error("Invalid grading figure.");
        return readFile(join(taskDirectory(task.examTaskId), task.examOutputKey, asset.cleanKey));
      },
      onProgress: async (progress, _total, phase, result) => {
        await getDb().gradeTask.updateMany({ where, data: { progress, phase, result: asJSON(result) } });
      } });
    await getDb().gradeTask.updateMany({ where, data: { status: "COMPLETED", phase: "done", progress: task.total, result: asJSON(result) } });
  } catch {
    if (signal.aborted) throw new Error("Grading worker interrupted.");
    await getDb().gradeTask.updateMany({ where, data: { status: "FAILED", phase: "failed", error: "批改任务未完成，请检查 AI 配置后重新提交。已处理题目的记录仍保留。" } });
  }
}
