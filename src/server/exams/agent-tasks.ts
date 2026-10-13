import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, rm, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { ExamAgentTask as StoredTask } from "@/generated/prisma/client";
import {
  EXAM_AGENT_QUEUE,
  generatedAnswerSchema,
  gradedAnswerSchema,
  type ExamAgentKind,
  type ExamAgentTask,
  type AgentResult,
} from "@/contracts/exam-agents";
import { examQuestionCount } from "@/contracts/exams";
import { WORKFLOW_QUEUE } from "@/contracts/workflows";
import { providerSnapshotSchema, type ReasoningEffort } from "@/contracts/ai-providers";
import { getDb } from "@/server/db/client";
import { getStoragePaths } from "@/server/config/env";
import { getUserProvider } from "@/server/ai/user-settings";
import { requireCredits, taskCreditMeter } from "@/server/ai/credits";
import { decryptApiKey } from "@/server/ai/credentials";
import { createProviderExamModel } from "@/server/ai/providers";
import { getJobProducer } from "@/server/jobs/client";
import { enqueueInTransaction } from "@/server/jobs/transaction";
import { requireWorker } from "@/server/jobs/health";
import { AccessError, RequestError } from "@/server/http/errors";
import { AppError } from "@/server/errors";
import { logError } from "@/server/logger";
import { ownedExamTask, taskResult, taskDirectory } from "./tasks";
import { receiveExamUpload } from "./uploads";
import { activityWriter } from "./activity";
import { runAnswerAgent } from "./answer-agent";

export const agentJobSchema = z.strictObject({ taskId: z.uuid() });
async function resumeAnswerUpload(
  tx: Parameters<typeof enqueueInTransaction>[0],
  boss: Parameters<typeof enqueueInTransaction>[1],
  userId: string,
  sourceId: string,
  answerTaskId: string,
) {
  const flows = await tx.gradingWorkflow.findMany({
    where: {
      userId,
      sourceId,
      kind: "ANSWER_UPLOAD",
      status: "FAILED",
      OR: [{ answerTaskId }, { answerTaskId: null }],
    },
  });
  for (const flow of flows) {
    const next = randomUUID();
    if (
      (
        await tx.gradingWorkflow.updateMany({
          where: { id: flow.id, jobId: flow.jobId, status: "FAILED" },
          data: { status: "QUEUED", error: null, jobId: next, answerTaskId },
        })
      ).count
    )
      await enqueueInTransaction(tx, boss, WORKFLOW_QUEUE, { workflowId: flow.id }, next);
  }
}
export function agentTaskDirectory(id: string) {
  if (!z.uuid().safeParse(id).success) throw new AccessError(404, "任务不存在。");
  return join(getStoragePaths().storage, "exam-agents", id);
}
function parseResult(task: Pick<StoredTask, "kind" | "result">): AgentResult {
  return z
    .strictObject({
      questions: z.array(task.kind === "ANSWER" ? generatedAnswerSchema : gradedAnswerSchema),
    })
    .parse(task.result);
}
export function agentTaskSummary(task: StoredTask): ExamAgentTask {
  const result = parseResult(task);
  return {
    id: task.id,
    examRevision: task.examRevision,
    kind: task.kind,
    ...(task.kind === "ANSWER"
      ? { answerSource: task.inputFiles.length ? ("UPLOAD" as const) : ("GENERATED" as const) }
      : {}),
    name: task.name,
    status: task.status,
    error: task.error,
    errorCode: task.errorCode,
    createdAt: task.createdAt.toISOString(),
    result,
    creditsSpent: task.creditsSpent?.toFixed(8) ?? "0",
    progress: {
      total: task.totalQuestions ?? (task.status === "COMPLETED" ? result.questions.length : null),
      completed: result.questions.length,
    },
    submissionId: task.submissionId,
  };
}
async function reconcile(task: StoredTask) {
  if (!["QUEUED", "RUNNING"].includes(task.status)) return task;
  try {
    const job = await (await getJobProducer()).getJobById(EXAM_AGENT_QUEUE, task.jobId);
    if (!job || ["failed", "cancelled", "completed"].includes(job.state)) {
      await getDb().examAgentTask.updateMany({
        where: { id: task.id, jobId: task.jobId, status: { in: ["QUEUED", "RUNNING"] } },
        data: { status: "FAILED", error: "后台任务已中断，已保存草稿保留，可以继续任务。" },
      });
      return getDb().examAgentTask.findUniqueOrThrow({ where: { id: task.id } });
    }
  } catch (error) {
    logError("exam.agent.reconcile.failed", error, { taskId: task.id });
  }
  return task;
}
export async function listAgentTasks(userId: string, sourceId: string) {
  const source = await ownedExamTask(userId, sourceId);
  if (!source.examId) return [];
  const [tasks, active, latestReference] = await Promise.all([
    getDb().examAgentTask.findMany({
      where: { examId: source.examId },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    getDb().examAgentTask.findMany({
      where: { examId: source.examId, status: { in: ["QUEUED", "RUNNING"] } },
    }),
    getDb().examAgentTask.findFirst({
      where: { examId: source.examId, kind: "ANSWER", status: "COMPLETED" },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const merged = new Map(tasks.map((task) => [task.id, task]));
  for (const task of active) merged.set(task.id, task);
  if (latestReference) merged.set(latestReference.id, latestReference);
  return (
    await Promise.all(
      [...merged.values()]
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map(reconcile),
    )
  ).map(agentTaskSummary);
}
export async function ownedAgentTask(userId: string, sourceId: string, id: string) {
  const source = await ownedExamTask(userId, sourceId);
  if (!z.uuid().safeParse(id).success || !source.examId) throw new AccessError(404, "任务不存在。");
  const task = await getDb().examAgentTask.findFirst({ where: { id, examId: source.examId } });
  if (!task) throw new AccessError(404, "任务不存在或无权访问。");
  return reconcile(task);
}
export async function createAgentTask(
  request: Request,
  userId: string,
  sourceId: string,
  kind: ExamAgentKind,
  workflow?: { id: string; jobId: string; files?: string[]; name?: string },
  answerUpload = false,
  explicitModelId?: string,
  explicitReasoningEffort?: ReasoningEffort,
) {
  const source = await ownedExamTask(userId, sourceId),
    exam = await taskResult(source);
  if (source.deletedAt && !workflow) throw new AccessError(404, "试卷已删除。");
  if (!exam || !source.outputKey) throw new RequestError(409, "请先完成试卷识别。");
  await requireCredits(userId);
  await requireWorker();
  const purpose = kind === "ANSWER" ? "answer" : "grading";
  const snapshots = workflow
    ? (await getDb().gradingWorkflow.findFirst({ where: { id: workflow.id, userId, sourceId } }))
        ?.modelSnapshots
    : null;
  const planned =
    snapshots && typeof snapshots === "object" && !Array.isArray(snapshots)
      ? snapshots[purpose]
      : null;
  const boss = await getJobProducer();
  let taskModelId = explicitModelId;
  let taskReasoningEffort = explicitReasoningEffort;
  // Reconcile interrupted runs before taking the per-exam lock.
  await listAgentTasks(userId, sourceId);
  const id = randomUUID(),
    jobId = randomUUID(),
    directory = agentTaskDirectory(id);
  let uploaded: { name: string }[] = [];
  if (kind === "GRADING" || answerUpload || workflow?.files?.length) {
    if (workflow?.files?.length) {
      await mkdir(join(directory, "inputs"), { recursive: true, mode: 0o700 });
      try {
        for (const [index, file] of workflow.files.entries())
          await copyFile(file, join(directory, "inputs", `${index + 1}.upload`));
        uploaded = workflow.files.map(() => ({
          name: workflow.name ?? (kind === "ANSWER" ? "上传标准答案" : "学生答卷"),
        }));
      } catch (error) {
        await rm(directory, { recursive: true, force: true });
        throw error;
      }
    } else
      uploaded = await receiveExamUpload(request, join(directory, "inputs"), {
        modelPurposes: [purpose],
        onModels: (models) => {
          taskModelId = models[purpose];
          taskReasoningEffort = models.reasoningEfforts?.[purpose];
        },
      });
  }
  try {
    const provider = planned
      ? providerSnapshotSchema.parse(planned)
      : await getUserProvider(userId, purpose, taskModelId, taskReasoningEffort);
    const saved = await getDb().$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      await requireCredits(userId, tx);
      await tx.$queryRaw`SELECT id FROM exams WHERE id = ${exam.id} FOR UPDATE`;
      const currentExam = await tx.exam.findUniqueOrThrow({ where: { id: exam.id } });
      if (currentExam.revision !== (exam.revision ?? 0))
        throw new RequestError(409, "试卷内容已更新，请重新提交任务。");
      let linkedAnswerId: string | undefined;
      if (
        kind === "ANSWER" &&
        !uploaded.length &&
        (await tx.gradingWorkflow.findFirst({
          where: {
            userId,
            sourceId,
            status: { in: ["QUEUED", "RUNNING"] },
            referenceFiles: { isEmpty: false },
          },
          select: { id: true },
        }))
      )
        throw new RequestError(409, "已上传的标准答案正在等待解析，请稍后查看。");
      if (workflow) {
        await tx.$queryRaw`SELECT id FROM grading_workflows WHERE id = ${workflow.id} FOR UPDATE`;
        const flow = await tx.gradingWorkflow.findFirst({
          where: {
            id: workflow.id,
            userId,
            sourceId,
            jobId: workflow.jobId,
            status: { in: ["QUEUED", "RUNNING"] },
          },
        });
        if (!flow || (kind === "ANSWER" ? flow.answerTaskId : flow.gradingTaskId))
          throw new RequestError(409, "任务状态已更新。");
        linkedAnswerId = flow.answerTaskId ?? undefined;
      }
      if (
        (await tx.examAgentTask.count({
          where: { exam: { userId }, status: { in: ["QUEUED", "RUNNING"] } },
        })) >= 3
      )
        throw new RequestError(429, "你已有 3 个答案或批改任务，请等待完成。");
      if (
        kind === "ANSWER" &&
        (await tx.examAgentTask.count({
          where: { examId: exam.id, kind, status: { in: ["QUEUED", "RUNNING"] } },
        }))
      )
        throw new RequestError(409, "该试卷正在生成答案。");
      let reference: unknown[] = [];
      if (kind === "GRADING") {
        const completed = await tx.examAgentTask.findFirst({
          where: {
            id: linkedAnswerId,
            examId: exam.id,
            examRevision: currentExam.revision,
            kind: "ANSWER",
            status: "COMPLETED",
          },
          orderBy: { createdAt: "desc" },
        });
        if (!completed) throw new RequestError(409, "请先生成完整标准答案，再上传学生答卷。");
        reference = parseResult(completed).questions;
        if (!reference.length)
          reference = await tx.questionAnswer.findMany({
            where: { examId: exam.id },
            select: { questionId: true, solution: true, gradingCriteria: true },
          });
        if (
          exam.sections.some((section) =>
            section.questions.some(
              (question) =>
                !reference.some(
                  (item) => (item as { questionId: string }).questionId === question.id,
                ),
            ),
          )
        )
          throw new RequestError(409, "标准答案尚未覆盖所有题目。");
      }
      const task = await tx.examAgentTask.create({
        data: {
          id,
          jobId,
          examId: exam.id,
          examRevision: currentExam.revision,
          totalQuestions: examQuestionCount(exam),
          kind,
          name:
            kind === "ANSWER" ? (uploaded.length ? "上传标准答案" : "标准答案") : uploaded[0].name,
          inputFiles: uploaded.map((_, index) => `inputs/${index + 1}.upload`),
          providerSnapshot: provider,
          reference: JSON.parse(JSON.stringify(reference)),
        },
      });
      await enqueueInTransaction(tx, boss, EXAM_AGENT_QUEUE, { taskId: id }, jobId);
      if (workflow)
        await tx.gradingWorkflow.update({
          where: { id: workflow.id },
          data: kind === "ANSWER" ? { answerTaskId: id, billAnswer: true } : { gradingTaskId: id },
        });
      else if (kind === "ANSWER") await resumeAnswerUpload(tx, boss, userId, sourceId, id);
      return task;
    });
    return agentTaskSummary(saved);
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch((cause) =>
      logError("exam.agent.upload.cleanup.failed", cause, { taskId: id }),
    );
    throw error;
  }
}
export async function retryAgentTask(
  userId: string,
  sourceId: string,
  id: string,
  modelId?: string,
  reasoningEffort?: ReasoningEffort,
) {
  const task = await ownedAgentTask(userId, sourceId, id);
  if (task.status !== "FAILED") throw new RequestError(409, "只有失败的任务可以继续。");
  await requireCredits(userId);
  await requireWorker();
  const provider = await getUserProvider(
      userId,
      task.kind === "ANSWER" ? "answer" : "grading",
      modelId,
      reasoningEffort,
    ),
    boss = await getJobProducer(),
    jobId = randomUUID();
  const saved = await getDb().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    await requireCredits(userId, tx);
    await tx.$queryRaw`SELECT id FROM exams WHERE id = ${task.examId} FOR UPDATE`;
    const currentExam = await tx.exam.findUniqueOrThrow({ where: { id: task.examId } });
    if (currentExam.revision !== task.examRevision)
      throw new RequestError(409, "试卷内容已更新，请为新版试卷重新开始任务。");
    if (
      (await tx.examAgentTask.count({
        where: { exam: { userId }, status: { in: ["QUEUED", "RUNNING"] } },
      })) >= 3
    )
      throw new RequestError(429, "已有 3 个答案或批改任务，请稍后继续。");
    if (
      task.kind === "ANSWER" &&
      (await tx.examAgentTask.count({
        where: { examId: task.examId, kind: "ANSWER", status: { in: ["QUEUED", "RUNNING"] } },
      }))
    )
      throw new RequestError(409, "该试卷已有答案任务运行中。");
    const changed = await tx.examAgentTask.updateMany({
      where: { id, jobId: task.jobId, status: "FAILED" },
      data: { jobId, status: "QUEUED", error: null, errorCode: null, providerSnapshot: provider },
    });
    if (!changed.count) throw new RequestError(409, "任务状态已变化，请刷新后重试。");
    await enqueueInTransaction(tx, boss, EXAM_AGENT_QUEUE, { taskId: id }, jobId);
    if (task.kind === "ANSWER") await resumeAnswerUpload(tx, boss, userId, sourceId, id);
    return tx.examAgentTask.findUniqueOrThrow({ where: { id } });
  });
  return agentTaskSummary(saved);
}
export async function processAgentTask(id: string, jobId: string, workerSignal: AbortSignal) {
  const db = getDb(),
    task = await db.examAgentTask.findUnique({ where: { id } });
  if (!task || task.jobId !== jobId || !["QUEUED", "RUNNING"].includes(task.status)) return;
  const attempt = randomUUID();
  const claimed = await db.examAgentTask.updateMany({
    where: { id, jobId, attempt: task.attempt, status: task.status },
    data: { status: "RUNNING", attempt, error: null, errorCode: null },
  });
  if (!claimed.count) return;
  const where = { id, jobId, attempt, status: "RUNNING" as const };
  const directory = join(agentTaskDirectory(id), attempt),
    emit = activityWriter(directory);
  let apiKey: string | undefined;
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const source = await db.examTask.findUnique({ where: { examId: task.examId } });
    if (!source || !source.outputKey)
      throw new AppError("试卷原始材料不可用。", "EXAM_SOURCE_MISSING", 422);
    const exam = await taskResult(source);
    if (!exam) throw new AppError("试卷尚未完成识别。", "EXAM_NOT_READY", 422);
    if ((exam.revision ?? 0) !== task.examRevision)
      throw new RequestError(409, "试卷内容已更新，请为新版试卷重新开始任务。");
    const provider = providerSnapshotSchema.parse(task.providerSnapshot);
    apiKey = decryptApiKey(provider.encryptedApiKey);
    const signal = AbortSignal.any([workerSignal, AbortSignal.timeout(25 * 60_000)]);
    const result = await runAnswerAgent({
      kind: task.kind,
      exam,
      sourceDirectory: join(taskDirectory(source.id), source.outputKey),
      files: task.inputFiles.map((key) => join(agentTaskDirectory(id), key)),
      outputDir: directory,
      model: createProviderExamModel(
        provider,
        apiKey,
        globalThis.fetch,
        taskCreditMeter({
          userId: source.userId,
          taskId: id,
          taskKind: task.kind,
          attempt,
          model: provider.model,
          providerId: provider.providerId,
          providerName: provider.name,
          modelId: provider.modelId,
          displayName: provider.displayName,
          multiplier: provider.creditMultiplier ?? 1,
        }),
      ),
      signal,
      onEvent: emit,
      reference: z.array(generatedAnswerSchema).parse(task.reference),
      initial: parseResult(task),
      onProgress: async (draft) => {
        signal.throwIfAborted();
        const saved = await db.examAgentTask.updateMany({
          where,
          data: { result: JSON.parse(JSON.stringify(draft)) },
        });
        if (!saved.count) throw new AppError("任务已切换执行实例，停止写入。", "AGENT_STALE", 409);
      },
    });
    signal.throwIfAborted();
    const published = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM exam_agent_tasks WHERE id = ${id} FOR UPDATE`;
      if (!(await tx.examAgentTask.findFirst({ where }))) return false;
      let submissionId: string | null = null;
      if (task.kind === "ANSWER") {
        await tx.examAnswer.upsert({
          where: { examId: task.examId },
          create: { examId: task.examId },
          update: {},
        });
        for (const item of z.array(generatedAnswerSchema).parse(result.questions)) {
          await tx.questionAnswer.upsert({
            where: { questionId: item.questionId },
            create: { ...item, examId: task.examId },
            update: { solution: item.solution, gradingCriteria: item.gradingCriteria },
          });
        }
      } else {
        const submission = await tx.submission.create({ data: { examId: task.examId } });
        submissionId = submission.id;
        await tx.submissionAnswer.createMany({
          data: z
            .array(gradedAnswerSchema)
            .parse(result.questions)
            .map((item) => ({ ...item, examId: task.examId, submissionId: submission.id })),
        });
      }
      await tx.examAgentTask.updateMany({ where, data: { status: "COMPLETED", submissionId } });
      return true;
    });
    if (published)
      await emit({
        type: "completed",
        text: `已完成 ${result.questions.length} 道题。`,
        data: { questions: result.questions.length },
      });
  } catch (error) {
    const diagnostic = logError(
      "exam.agent.failed",
      error,
      { taskId: id, jobId, attempt, kind: task.kind },
      { secrets: apiKey ? [apiKey] : [] },
    );
    const message = `${diagnostic.message}（错误编号：${diagnostic.errorId}）`;
    await db.examAgentTask.updateMany({
      where,
      data: { status: "FAILED", error: message, errorCode: diagnostic.code },
    });
    await emit({ type: "failed", text: message, data: diagnostic });
  }
}
