import "server-only";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { GradingWorkflow as StoredWorkflow } from "@/generated/prisma/client";
import { WORKFLOW_QUEUE, type GradingWorkflow, type WorkflowSummary } from "@/contracts/workflows";
import { getDb } from "@/server/db/client";
import { getStoragePaths } from "@/server/config/env";
import { requireWorker } from "@/server/jobs/health";
import { getUserProvider } from "@/server/ai/user-settings";
import { requireCredits } from "@/server/ai/credits";
import type { TaskModelSelection } from "@/contracts/user-ai";
import { sumCredits } from "@/lib/credits";
import { getJobProducer } from "@/server/jobs/client";
import { enqueueInTransaction } from "@/server/jobs/transaction";
import { AccessError, RequestError } from "@/server/http/errors";
import { logError } from "@/server/logger";
import { ownedExamTask, taskSummary, taskDirectory, retryExamTask } from "./tasks";
import { receiveExamUpload } from "./uploads";
import { createAgentTask, listAgentTasks, retryAgentTask, ownedAgentTask } from "./agent-tasks";

export const workflowJobSchema = z.strictObject({ workflowId: z.uuid() });
const active = ["QUEUED", "RUNNING"] as const;
function directory(id: string) {
  if (!z.uuid().safeParse(id).success) throw new AccessError(404, "批改记录不存在。");
  return join(getStoragePaths().storage, "grading-workflows", id);
}
export async function ownedWorkflow(userId: string, id: string) {
  if (!z.uuid().safeParse(id).success) throw new AccessError(404, "批改记录不存在。");
  const flow = await getDb().gradingWorkflow.findFirst({ where: { id, userId } });
  if (!flow) throw new AccessError(404, "批改记录不存在或无权访问。");
  return flow;
}
async function taskState(flow: StoredWorkflow) {
  const source = await ownedExamTask(flow.userId, flow.sourceId);
  const tasks = source.examId ? await listAgentTasks(flow.userId, flow.sourceId) : [];
  // Linked tasks can age out of the ordinary history window.
  for (const id of [flow.answerTaskId, flow.gradingTaskId])
    if (id && !tasks.some((task) => task.id === id)) {
      const { agentTaskSummary } = await import("./agent-tasks");
      tasks.push(agentTaskSummary(await ownedAgentTask(flow.userId, flow.sourceId, id)));
    }
  const answer = tasks.find((task) => task.id === flow.answerTaskId) ?? null;
  const grading = tasks.find((task) => task.id === flow.gradingTaskId) ?? null;
  return { source: taskSummary(source), answer, grading };
}
async function detail(flow: StoredWorkflow): Promise<GradingWorkflow> {
  const { source, answer, grading } = await taskState(flow);
  const recognition = source.progress ?? { total: null, completed: 0 };
  const total = recognition.total ?? answer?.progress?.total ?? grading?.progress?.total ?? null;
  return {
    id: flow.id,
    kind: flow.kind as GradingWorkflow["kind"],
    name: flow.name,
    status: flow.status,
    sourceId: flow.sourceId,
    error: flow.error,
    errorCode: flow.errorCode,
    createdAt: flow.createdAt.toISOString(),
    source,
    answer,
    grading,
    creditsSpent: sumCredits([
      ...(flow.kind === "QUICK" ? [source.creditsSpent] : []),
      flow.billAnswer ? answer?.creditsSpent : undefined,
      grading?.creditsSpent,
    ]),
    progress: {
      recognition,
      answer: answer?.progress ?? { total, completed: 0 },
      grading: grading?.progress ?? { total, completed: 0 },
    },
    stage:
      source.status !== "COMPLETED"
        ? "RECOGNITION"
        : !answer || answer.status !== "COMPLETED"
          ? "ANSWER"
          : "GRADING",
  };
}
export async function workflowDetail(userId: string, id: string) {
  const flow = await reconcile(await ownedWorkflow(userId, id));
  if (flow.kind === "ANSWER_UPLOAD") throw new AccessError(404, "批改记录不存在。");
  return detail(flow);
}
export async function answerUploadState(userId: string, sourceId: string) {
  const flow = await getDb().gradingWorkflow.findFirst({
    where: { userId, sourceId, kind: "ANSWER_UPLOAD", answerTaskId: null },
    orderBy: { createdAt: "desc" },
  });
  if (!flow) return null;
  const current = await reconcile(flow);
  return current.status === "COMPLETED"
    ? null
    : { status: current.status, createdAt: current.createdAt.toISOString() };
}
export async function retryAnswerUpload(userId: string, sourceId: string) {
  await ownedExamTask(userId, sourceId);
  const flow = await getDb().gradingWorkflow.findFirst({
    where: { userId, sourceId, kind: "ANSWER_UPLOAD", answerTaskId: null },
    orderBy: { createdAt: "desc" },
  });
  if (!flow) throw new AccessError(404, "答案上传记录不存在。");
  return retryWorkflow(userId, flow.id);
}
async function reconcile(flow: StoredWorkflow) {
  if (active.includes(flow.status as (typeof active)[number])) {
    try {
      const job = await (await getJobProducer()).getJobById(WORKFLOW_QUEUE, flow.jobId);
      if (!job || ["failed", "cancelled", "completed"].includes(job.state)) {
        const changed = await getDb().gradingWorkflow.updateMany({
          where: { id: flow.id, jobId: flow.jobId, status: { in: [...active] } },
          data: { status: "FAILED", error: "流程中断，请重试。" },
        });
        if (changed.count)
          return { ...flow, status: "FAILED" as const, error: "流程中断，请重试。" };
        return getDb().gradingWorkflow.findUniqueOrThrow({ where: { id: flow.id } });
      }
    } catch (error) {
      logError("workflow.reconcile.failed", error, { workflowId: flow.id });
    }
  }
  return flow;
}
export async function listWorkflows(userId: string) {
  const flows = await getDb().gradingWorkflow.findMany({
    where: { userId, kind: { in: ["GRADING", "QUICK"] } },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { source: true },
  });
  return Promise.all(
    flows.map(async (flow): Promise<WorkflowSummary> => {
      const current = await reconcile(flow);
      return {
        id: current.id,
        kind: current.kind as WorkflowSummary["kind"],
        name: current.name,
        status: current.status,
        sourceId: current.sourceId,
        createdAt: current.createdAt.toISOString(),
        source: { ...taskSummary(flow.source), error: null },
      };
    }),
  );
}

export async function createGradingWorkflow(request: Request, userId: string, sourceId: string) {
  const source = await ownedExamTask(userId, sourceId);
  if (source.status !== "COMPLETED" || !source.examId)
    throw new RequestError(409, "请选择已添加完成的试卷。");
  await requireCredits(userId);
  await requireWorker();
  const modelSnapshots: Record<string, import("@/contracts/ai-providers").ProviderSnapshot> = {};
  let models: TaskModelSelection = {};
  const boss = await getJobProducer(),
    id = randomUUID(),
    jobId = randomUUID();
  const files = await receiveExamUpload(request, join(directory(id), "inputs"), {
    modelPurposes: ["answer", "grading"],
    onModels: (selection) => {
      models = selection;
    },
  });
  try {
    modelSnapshots.grading = await getUserProvider(userId, "grading", models.grading);
    if (
      !(await getDb().examAgentTask.findFirst({
        where: { examId: source.examId, kind: "ANSWER", status: "COMPLETED" },
      }))
    )
      modelSnapshots.answer = await getUserProvider(userId, "answer", models.answer);
    const flow = await getDb().$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      await requireCredits(userId, tx);
      if ((await tx.gradingWorkflow.count({ where: { userId, status: { in: [...active] } } })) >= 3)
        throw new RequestError(429, "已有 3 份答卷正在处理，请稍后再上传。");
      const reference = await tx.examAgentTask.findFirst({
        where: { examId: source.examId!, kind: "ANSWER", status: "COMPLETED" },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      const flow = await tx.gradingWorkflow.create({
        data: {
          id,
          userId,
          sourceId,
          kind: "GRADING",
          modelSnapshots,
          answerTaskId: reference?.id ?? null,
          name: files[0].name,
          inputFiles: files.map((_, index) => `inputs/${index + 1}.upload`),
          jobId,
        },
      });
      await enqueueInTransaction(tx, boss, WORKFLOW_QUEUE, { workflowId: id }, jobId);
      return flow;
    });
    return { id: flow.id };
  } catch (error) {
    await rm(directory(id), { recursive: true, force: true });
    throw error;
  }
}
export async function processWorkflow(id: string, jobId: string) {
  const flow = await getDb().gradingWorkflow.findFirst({
    where: { id, jobId, status: { in: [...active] } },
  });
  if (!flow) return;
  const where = { id, jobId, status: { in: [...active] } };
  if (!(await getDb().gradingWorkflow.updateMany({ where, data: { status: "RUNNING" } })).count)
    return;
  try {
    const state = await taskState(flow);
    if (state.source.status === "FAILED") throw new Error(state.source.error ?? "试卷处理失败。");
    if (state.source.status === "COMPLETED") {
      if (!flow.answerTaskId) {
        const tasks = await listAgentTasks(flow.userId, flow.sourceId);
        const reference =
          tasks.find(
            (task) =>
              task.kind === "ANSWER" &&
              (!flow.referenceFiles.length || task.answerSource === "UPLOAD") &&
              task.status === "COMPLETED",
          ) ??
          tasks.find(
            (task) =>
              task.kind === "ANSWER" &&
              (!flow.referenceFiles.length || task.answerSource === "UPLOAD") &&
              active.includes(task.status as (typeof active)[number]),
          );
        if (reference)
          await getDb().gradingWorkflow.updateMany({ where, data: { answerTaskId: reference.id } });
        else
          await createAgentTask(
            new Request("http://localhost"),
            flow.userId,
            flow.sourceId,
            "ANSWER",
            {
              id,
              jobId,
              ...(flow.referenceFiles.length
                ? {
                    files: flow.referenceFiles.map((key) =>
                      join(taskDirectory(flow.sourceId), key),
                    ),
                  }
                : {}),
            },
          );
      } else if (state.answer?.status === "FAILED")
        throw new Error(state.answer.error ?? "答案生成失败。");
      else if (state.answer?.status === "COMPLETED") {
        if (flow.kind === "ANSWER_UPLOAD") {
          await getDb().gradingWorkflow.updateMany({
            where,
            data: { status: "COMPLETED", error: null },
          });
          return;
        }
        if (!flow.gradingTaskId) {
          const source = await ownedExamTask(flow.userId, flow.sourceId);
          const files =
            flow.kind === "QUICK"
              ? source.inputFiles.map((key) => join(taskDirectory(source.id), key))
              : flow.inputFiles.map((key) => join(directory(id), key));
          await createAgentTask(
            new Request("http://localhost"),
            flow.userId,
            flow.sourceId,
            "GRADING",
            { id, jobId, files, name: flow.name },
          );
        } else if (state.grading?.status === "FAILED")
          throw new Error(state.grading.error ?? "批改失败。");
        else if (state.grading?.status === "COMPLETED") {
          await getDb().gradingWorkflow.updateMany({
            where,
            data: { status: "COMPLETED", error: null },
          });
          return;
        }
      }
    }
  } catch (error) {
    // A competing coordinator or a per-user concurrency cap is temporary.
    if (!(error instanceof RequestError && [409, 429].includes(error.status))) {
      const diagnostic = logError("workflow.failed", error, { workflowId: id });
      await getDb().gradingWorkflow.updateMany({
        where,
        data: { status: "FAILED", error: diagnostic.message, errorCode: diagnostic.code },
      });
      return;
    }
  }
  // Each poll atomically installs its successor. No browser or long-lived HTTP request is required.
  const boss = await getJobProducer();
  await getDb().$transaction(async (tx) => {
    const next = randomUUID();
    if (!(await tx.gradingWorkflow.updateMany({ where, data: { jobId: next } })).count) return;
    await enqueueInTransaction(tx, boss, WORKFLOW_QUEUE, { workflowId: id }, next, 5);
  });
}
export async function retryWorkflow(userId: string, id: string) {
  const flow = await ownedWorkflow(userId, id);
  if (flow.status !== "FAILED") throw new RequestError(409, "只有失败的批改可以重试。");
  await requireCredits(userId);
  await requireWorker();
  const state = await taskState(flow);
  if (state.source.status === "FAILED") await retryExamTask(userId, flow.sourceId);
  else if (state.answer?.status === "FAILED")
    await retryAgentTask(userId, flow.sourceId, state.answer.id);
  else if (state.grading?.status === "FAILED")
    await retryAgentTask(userId, flow.sourceId, state.grading.id);
  const boss = await getJobProducer(),
    jobId = randomUUID();
  await getDb().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    await requireCredits(userId, tx);
    if ((await tx.gradingWorkflow.count({ where: { userId, status: { in: [...active] } } })) >= 3)
      throw new RequestError(429, "已有 3 份答卷正在处理，请稍后重试。");
    if (
      !(
        await tx.gradingWorkflow.updateMany({
          where: { id, userId, jobId: flow.jobId, status: "FAILED" },
          data: { jobId, status: "QUEUED", error: null, errorCode: null },
        })
      ).count
    )
      throw new RequestError(409, "批改状态已更新，请刷新页面。");
    await enqueueInTransaction(tx, boss, WORKFLOW_QUEUE, { workflowId: id }, jobId);
  });
  return { id };
}
