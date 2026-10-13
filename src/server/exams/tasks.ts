import "server-only";
import { randomUUID } from "node:crypto";
import { rm, mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { z } from "zod";
import { EXAM_PARSE_QUEUE, type ExamTaskSummary } from "@/contracts/exam-tasks";
import { sectionSchema, examQuestionCount, examLayoutSchema, type Exam } from "@/contracts/exams";
import { providerSnapshotSchema } from "@/contracts/ai-providers";
import type { ExamTask } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { getStoragePaths } from "@/server/config/env";
import { AccessError, RequestError } from "@/server/http/errors";
import { getUserProvider } from "@/server/ai/user-settings";
import { requireCredits, taskCreditMeter } from "@/server/ai/credits";
import { createProviderExamModel } from "@/server/ai/providers";
import { decryptApiKey } from "@/server/ai/credentials";
import { getJobProducer } from "@/server/jobs/client";
import { enqueueInTransaction } from "@/server/jobs/transaction";
import { requireWorker } from "@/server/jobs/health";
import { receiveExamUpload } from "./uploads";
import { AppError } from "@/server/errors";
import { logError, logEvent } from "@/server/logger";
import { activityWriter } from "./activity";
import { parseExam } from "./parser";
import type { TaskModelSelection } from "@/contracts/user-ai";
import { WORKFLOW_QUEUE } from "@/contracts/workflows";

export const examJobSchema = z.strictObject({ taskId: z.uuid() });
export function taskSummary(task: ExamTask): ExamTaskSummary {
  return {
    id: task.id,
    name: task.name,
    status: task.status,
    error: task.error,
    errorCode: task.errorCode,
    createdAt: task.createdAt.toISOString(),
    deletedAt: task.deletedAt?.toISOString() ?? null,
    creditsSpent: task.creditsSpent?.toFixed(8) ?? "0",
    progress: { total: task.totalQuestions ?? null, completed: task.parsedQuestions ?? 0 },
  };
}
async function reconcileTask(task: ExamTask) {
  if (!["QUEUED", "RUNNING"].includes(task.status)) return task;
  try {
    const job = await (await getJobProducer()).getJobById(EXAM_PARSE_QUEUE, task.jobId);
    if (!job || ["failed", "cancelled", "completed"].includes(job.state)) {
      logError(
        "exam.queue.interrupted",
        new AppError(`后台任务已中断，队列状态：${job?.state ?? "missing"}。`, "QUEUE_INTERRUPTED"),
        { taskId: task.id, jobId: task.jobId },
      );
      await getDb().examTask.updateMany({
        where: { id: task.id, jobId: task.jobId, status: { in: ["QUEUED", "RUNNING"] } },
        data: {
          status: "FAILED",
          error: `后台任务已中断（队列状态：${job?.state ?? "missing"}），请重新上传试卷。`,
        },
      });
      return await getDb().examTask.findUniqueOrThrow({ where: { id: task.id } });
    }
  } catch (error) {
    logError("exam.queue.reconcile.failed", error, { taskId: task.id, jobId: task.jobId });
    /* Existing results remain readable during a queue outage. */
  }
  return task;
}
export async function listExamTasks(userId: string) {
  const tasks = await getDb().examTask.findMany({
    where: { userId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      workflows: {
        where: { kind: "ANSWER_UPLOAD", status: { in: ["QUEUED", "RUNNING"] } },
        select: { id: true },
      },
      exam: {
        select: {
          answer: { select: { examId: true } },
          agentTasks: {
            where: { kind: "ANSWER", status: { in: ["QUEUED", "RUNNING"] } },
            select: { id: true },
          },
        },
      },
    },
  });
  return Promise.all(
    tasks.map(async (task) => ({
      ...taskSummary(await reconcileTask(task)),
      answerStatus: task.exam?.answer
        ? ("READY" as const)
        : task.exam?.agentTasks.length || task.workflows.length
          ? ("PROCESSING" as const)
          : ("MISSING" as const),
    })),
  );
}
export async function ownedExamTask(userId: string, id: string) {
  if (!z.uuid().safeParse(id).success) throw new AccessError(404, "试卷不存在。");
  const task = await getDb().examTask.findFirst({ where: { id, userId } });
  if (!task) throw new AccessError(404, "试卷不存在或无权访问。");
  return reconcileTask(task);
}
export function taskDirectory(id: string) {
  if (!z.uuid().safeParse(id).success)
    throw new AppError("试卷任务 ID 格式无效。", "TASK_ID_INVALID", 400);
  return join(getStoragePaths().storage, "exam-tasks", id);
}
export async function taskResult(task: ExamTask): Promise<Exam | null> {
  if (task.status !== "COMPLETED" || !task.examId) return null;
  const exam = await getDb().exam.findFirst({
    where: { id: task.examId, userId: task.userId },
    include: {
      sections: {
        orderBy: { position: "asc" },
        include: { questions: { orderBy: { position: "asc" } } },
      },
    },
  });
  if (!exam) return null;
  return {
    id: exam.id,
    revision: exam.revision,
    name: exam.name,
    totalScore: exam.totalScore,
    ...(exam.layout ? { layout: examLayoutSchema.parse(exam.layout) } : {}),
    sections: exam.sections.map((section) => {
      const parsed = sectionSchema.parse({
        number: section.number,
        title: section.title,
        description: section.description,
        score: section.score,
        questions: section.questions.map((question) => ({
          number: question.number,
          description: question.description,
          materials: question.materials,
          score: question.score,
          subquestions: question.subquestions,
        })),
      });
      return {
        id: section.id,
        ...parsed,
        questions: parsed.questions.map((question, index) => ({
          id: section.questions[index].id,
          ...question,
        })),
      };
    }),
  };
}
export async function createExamTask(request: Request, userId: string, quick = false) {
  await requireCredits(userId);
  await requireWorker();
  const boss = await getJobProducer();
  const modelSnapshots: Record<string, import("@/contracts/ai-providers").ProviderSnapshot> = {};
  let models: TaskModelSelection = {};
  const id = randomUUID(),
    jobId = randomUUID(),
    directory = taskDirectory(id);
  const allUploads = await receiveExamUpload(request, join(directory, "inputs"), {
    allowAnswers: true,
    modelPurposes: quick ? ["exam", "answer", "grading"] : ["exam", "answer"],
    onModels: (selection) => {
      models = selection;
    },
  });
  const uploaded = allUploads.filter((file) => file.field === "files");
  const referenceUploads = allUploads.filter((file) => file.field === "answerFiles");
  try {
    const provider = await getUserProvider(
      userId,
      "exam",
      models.exam,
      models.reasoningEfforts?.exam,
    );
    if (quick || referenceUploads.length)
      modelSnapshots.answer = await getUserProvider(
        userId,
        "answer",
        models.answer,
        models.reasoningEfforts?.answer,
      );
    if (quick)
      modelSnapshots.grading = await getUserProvider(
        userId,
        "grading",
        models.grading,
        models.reasoningEfforts?.grading,
      );
    const task = await getDb().$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      await requireCredits(userId, tx);
      if (
        (await tx.examTask.count({ where: { userId, status: { in: ["QUEUED", "RUNNING"] } } })) >= 3
      )
        throw new RequestError(429, "你已有 3 份试卷正在解析，请等待完成后再上传。");
      const task = await tx.examTask.create({
        data: {
          id,
          userId,
          jobId,
          name: uploaded[0].name,
          inputFiles: uploaded.map((file) => `inputs/${basename(file.path)}`),
          providerSnapshot: provider,
        },
      });
      await enqueueInTransaction(tx, boss, EXAM_PARSE_QUEUE, { taskId: id }, jobId);
      if (quick || referenceUploads.length) {
        if (
          (await tx.gradingWorkflow.count({
            where: { userId, status: { in: ["QUEUED", "RUNNING"] } },
          })) >= 3
        )
          throw new RequestError(429, "已有 3 份答卷正在处理，请稍后再上传。");
        const workflow = await tx.gradingWorkflow.create({
          data: {
            userId,
            sourceId: id,
            kind: quick ? "QUICK" : "ANSWER_UPLOAD",
            name: uploaded[0].name,
            inputFiles: [],
            modelSnapshots,
            referenceFiles: referenceUploads.map((file) => `inputs/${basename(file.path)}`),
            jobId: randomUUID(),
          },
        });
        await enqueueInTransaction(
          tx,
          boss,
          WORKFLOW_QUEUE,
          { workflowId: workflow.id },
          workflow.jobId,
        );
      }
      return task;
    });
    return taskSummary(task);
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch((cleanupError) => {
      logError("exam.upload.cleanup.failed", cleanupError, { taskId: id });
    });
    throw error;
  }
}
export async function processExamTask(id: string, jobId: string, signal: AbortSignal) {
  try {
    await runExamTask(id, jobId, signal);
  } catch (error) {
    logError("exam.worker.failed", error, { taskId: id, jobId });
    throw error;
  }
}
async function runExamTask(id: string, jobId: string, signal: AbortSignal) {
  const task = await getDb().examTask.findUnique({ where: { id } });
  if (!task || task.jobId !== jobId || !["QUEUED", "RUNNING"].includes(task.status)) return;
  const attempt = randomUUID();
  const claimed = await getDb().examTask.updateMany({
    where: { id, jobId, attempt: task.attempt, status: task.status },
    data: {
      status: "RUNNING",
      attempt,
      error: null,
      errorCode: null,
      totalQuestions: null,
      parsedQuestions: 0,
    },
  });
  if (!claimed.count) return;
  const where = { id, jobId, attempt, status: "RUNNING" as const };
  let phase = "provider_config",
    apiKey: string | undefined;
  const emit = activityWriter(join(taskDirectory(id), attempt));
  const context = { taskId: id, jobId, attempt };
  logEvent("exam.started", context);
  try {
    const provider = providerSnapshotSchema.parse(task.providerSnapshot);
    apiKey = decryptApiKey(provider.encryptedApiKey);
    const directory = taskDirectory(id);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const exam = await parseExam({
      files: task.inputFiles.map((key) => join(directory, key)),
      outputDir: join(directory, attempt),
      model: createProviderExamModel(
        provider,
        apiKey,
        globalThis.fetch,
        taskCreditMeter({
          userId: task.userId,
          taskId: id,
          taskKind: "EXAM",
          attempt,
          model: provider.model,
          providerId: provider.providerId,
          providerName: provider.name,
          modelId: provider.modelId,
          displayName: provider.displayName,
          multiplier: provider.creditMultiplier ?? 1,
        }),
      ),
      onEvent: emit,
      onQuestionProgress: async (progress) => {
        const changed = await getDb().examTask.updateMany({
          where,
          data: { totalQuestions: progress.total, parsedQuestions: progress.completed },
        });
        if (!changed.count)
          throw new AppError("Task attempt changed; stop saving progress.", "EXAM_STALE", 409);
      },
      onPhase: (value) => {
        phase = value;
      },
      signal: AbortSignal.any([signal, AbortSignal.timeout(25 * 60_000)]),
    });
    phase = "database_publish";
    const published = await getDb().$transaction(async (tx) => {
      // Serialize claim checks and publication so a stale worker cannot publish.
      await tx.$queryRaw`SELECT id FROM exam_tasks WHERE id = ${id} FOR UPDATE`;
      if (!(await tx.examTask.findFirst({ where }))) return false;
      let questionPosition = 0;
      const saved = await tx.exam.create({
        data: {
          userId: task.userId,
          name: exam.name,
          totalScore: exam.totalScore,
          ...(exam.layout ? { layout: exam.layout } : {}),
          sections: {
            create: exam.sections.map((section, position) => ({
              position: position + 1,
              number: section.number,
              title: section.title,
              description: section.description,
              score: section.score,
            })),
          },
        },
        include: { sections: { orderBy: { position: "asc" } } },
      });
      for (const [sectionIndex, section] of exam.sections.entries()) {
        await tx.examQuestion.createMany({
          data: section.questions.map((question) => ({
            id: randomUUID(),
            examId: saved.id,
            sectionId: saved.sections[sectionIndex].id,
            position: ++questionPosition,
            ...question,
          })),
        });
      }
      await tx.examTask.updateMany({
        where,
        data: {
          status: "COMPLETED",
          examId: saved.id,
          name: saved.name,
          outputKey: attempt,
          totalQuestions: examQuestionCount(exam),
          parsedQuestions: examQuestionCount(exam),
        },
      });
      return true;
    });
    if (!published) return;
    await emit({
      type: "completed",
      text: `解析完成，共 ${exam.sections.length} 道大题、${examQuestionCount(exam)} 道小题。`,
      data: { sections: exam.sections.length, questions: examQuestionCount(exam) },
    });
    logEvent("exam.completed", context);
  } catch (error) {
    const diagnostic = logError(
      "exam.parse.failed",
      error,
      { ...context, phase },
      { secrets: apiKey ? [apiKey] : [] },
    );
    const detail = `${diagnostic.message}（阶段：${phase}；错误编号：${diagnostic.errorId}）`;
    await mkdir(join(taskDirectory(id), attempt), { recursive: true, mode: 0o700 }).catch(
      (storageError) => {
        logError("exam.activity.directory.failed", storageError, context);
      },
    );
    await emit({ type: "failed", text: detail, data: diagnostic });
    // pg-boss replays interrupted jobs; each replay writes to a fresh directory.
    if (signal.aborted)
      throw new AppError("Worker 已中断，任务等待队列重新执行。", "WORKER_INTERRUPTED", 503, {
        cause: error,
      });
    await getDb().examTask.updateMany({
      where,
      data: {
        status: "FAILED",
        error: detail,
        errorCode: diagnostic.code,
      },
    });
  }
}

export async function retryExamTask(userId: string, id: string) {
  const task = await ownedExamTask(userId, id);
  if (task.status !== "FAILED") throw new RequestError(409, "只有失败的试卷可以重试。");
  await requireCredits(userId);
  await requireWorker();
  const provider = await getUserProvider(userId),
    boss = await getJobProducer(),
    jobId = randomUUID();
  return getDb().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    await requireCredits(userId, tx);
    if (
      (await tx.examTask.count({ where: { userId, status: { in: ["QUEUED", "RUNNING"] } } })) >= 3
    )
      throw new RequestError(429, "已有 3 份试卷正在处理，请稍后重试。");
    if (
      !(
        await tx.examTask.updateMany({
          where: { id, jobId: task.jobId, status: "FAILED" },
          data: {
            status: "QUEUED",
            jobId,
            error: null,
            errorCode: null,
            providerSnapshot: provider,
            totalQuestions: null,
            parsedQuestions: 0,
          },
        })
      ).count
    )
      throw new RequestError(409, "试卷状态已更新，请刷新页面。");
    await enqueueInTransaction(tx, boss, EXAM_PARSE_QUEUE, { taskId: id }, jobId);
    for (const flow of await tx.gradingWorkflow.findMany({
      where: { userId, sourceId: id, kind: "ANSWER_UPLOAD", status: "FAILED", answerTaskId: null },
    })) {
      const next = randomUUID();
      if (
        (
          await tx.gradingWorkflow.updateMany({
            where: { id: flow.id, jobId: flow.jobId, status: "FAILED" },
            data: { status: "QUEUED", error: null, jobId: next },
          })
        ).count
      )
        await enqueueInTransaction(tx, boss, WORKFLOW_QUEUE, { workflowId: flow.id }, next);
    }
    return taskSummary(await tx.examTask.findUniqueOrThrow({ where: { id } }));
  });
}
