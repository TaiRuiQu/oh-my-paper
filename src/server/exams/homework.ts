import "server-only";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, rename, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { v7 as uuidv7 } from "uuid";
import type { ProviderSnapshot } from "@/contracts/ai-providers";
import type { TaskModelSelection } from "@/contracts/user-ai";
import { EXAM_PARSE_QUEUE } from "@/contracts/exam-tasks";
import { MAX_PENDING_HOMEWORK, WORKFLOW_QUEUE } from "@/contracts/workflows";
import { groupStudentUploads } from "@/lib/student-uploads";
import { getStoragePaths } from "@/server/config/env";
import { getDb } from "@/server/db/client";
import { getUserProvider } from "@/server/ai/user-settings";
import { requireCredits } from "@/server/ai/credits";
import { requireWorker } from "@/server/jobs/health";
import { getJobProducer } from "@/server/jobs/client";
import { enqueueInTransaction } from "@/server/jobs/transaction";
import { RequestError } from "@/server/http/errors";
import { logError } from "@/server/logger";
import { ownedExamTask, taskDirectory } from "./tasks";
import { receiveExamUpload } from "./uploads";

export async function createHomeworkBatch(request: Request, userId: string) {
  const params = new URL(request.url).searchParams;
  const sourceId = params.get("exam") || null;
  const source = sourceId ? await ownedExamTask(userId, sourceId) : null;
  if (source && (source.deletedAt || source.status !== "COMPLETED" || !source.examId))
    throw new RequestError(409, "请选择已添加完成的试卷。");
  await requireCredits(userId);
  await requireWorker();
  const staging = join(getStoragePaths().storage, "homework-uploads", randomUUID());
  const directories: string[] = [];
  let committed = false;
  let models: TaskModelSelection = {};
  try {
    const uploads = await receiveExamUpload(request, staging, {
      allowAnswers: !source,
      modelPurposes: source ? ["answer", "grading"] : ["exam", "answer", "grading"],
      onModels: (value) => {
        models = value;
      },
    });
    let groups: (typeof uploads)[];
    try {
      groups = groupStudentUploads(uploads.filter((f) => f.field === "files"));
    } catch (cause) {
      throw new RequestError(400, (cause as Error).message, { cause });
    }
    const references = uploads.filter((f) => f.field === "answerFiles");
    const snapshots: Record<string, ProviderSnapshot> = {};
    const sourceExam = source?.examId
      ? await getDb().exam.findUniqueOrThrow({ where: { id: source.examId } })
      : null;
    const hasReference =
      sourceExam &&
      (await getDb().examAgentTask.findFirst({
        where: {
          examId: source!.examId!,
          examRevision: sourceExam.revision,
          kind: "ANSWER",
          status: "COMPLETED",
        },
        select: { id: true },
      }));
    const purposes = source
      ? hasReference
        ? (["grading"] as const)
        : (["answer", "grading"] as const)
      : (["exam", "answer", "grading"] as const);
    for (const purpose of purposes)
      snapshots[purpose] = await getUserProvider(
        userId,
        purpose,
        models[purpose],
        models.reasoningEfforts?.[purpose],
      );
    const prepared: {
      id: string;
      taskId: string;
      name: string;
      inputs: string[];
      referenceFiles: string[];
    }[] = [];
    for (const group of groups) {
      const id = randomUUID(),
        taskId = source?.id ?? uuidv7();
      const directory = source
        ? join(getStoragePaths().storage, "grading-workflows", id)
        : taskDirectory(taskId);
      directories.push(directory);
      await mkdir(join(directory, "inputs"), { recursive: true, mode: 0o700 });
      const inputs: string[] = [],
        referenceFiles: string[] = [];
      for (const [index, file] of group.entries()) {
        const destination = join(directory, "inputs", `${index + 1}.upload`);
        await rename(file.path, destination);
        inputs.push(relative(directory, destination));
      }
      for (const [index, file] of references.entries()) {
        const destination = join(directory, "inputs", `answer-${index + 1}.upload`);
        await copyFile(file.path, destination);
        referenceFiles.push(relative(directory, destination));
      }
      prepared.push({ id, taskId, name: group[0].name, inputs, referenceFiles });
    }
    const boss = await getJobProducer();
    const workflows = await getDb().$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      await requireCredits(userId, tx);
      // Queue a complete upload together; the Worker and provider still bound execution concurrency.
      if (
        (await tx.gradingWorkflow.count({
          where: { userId, status: { in: ["QUEUED", "RUNNING"] } },
        })) +
          prepared.length >
        MAX_PENDING_HOMEWORK
      )
        throw new RequestError(429, "待批改作业将超过 40 份，请等待部分完成后再上传。");
      let answerTaskId: string | null = null;
      if (source?.examId) {
        await tx.$queryRaw`SELECT id FROM exams WHERE id = ${source.examId} FOR UPDATE`;
        const exam = await tx.exam.findUniqueOrThrow({ where: { id: source.examId } });
        if (exam.revision !== sourceExam?.revision)
          throw new RequestError(409, "试卷已更新，请重新提交作业。");
        answerTaskId =
          (
            await tx.examAgentTask.findFirst({
              where: {
                examId: source.examId,
                examRevision: exam.revision,
                kind: "ANSWER",
                status: "COMPLETED",
              },
              orderBy: { createdAt: "desc" },
              select: { id: true },
            })
          )?.id ?? null;
      }
      const created = [];
      for (const item of prepared) {
        if (!source) {
          const parseJobId = randomUUID();
          await tx.examTask.create({
            data: {
              id: item.taskId,
              userId,
              jobId: parseJobId,
              name: item.name,
              inputFiles: item.inputs,
              providerSnapshot: snapshots.exam,
            },
          });
          await enqueueInTransaction(
            tx,
            boss,
            EXAM_PARSE_QUEUE,
            { taskId: item.taskId },
            parseJobId,
          );
        }
        const jobId = randomUUID();
        const flow = await tx.gradingWorkflow.create({
          data: {
            id: item.id,
            userId,
            sourceId: item.taskId,
            name: item.name,
            jobId,
            kind: source ? "GRADING" : "QUICK",
            modelSnapshots: snapshots,
            answerTaskId,
            inputFiles: source ? item.inputs : [],
            referenceFiles: item.referenceFiles,
          },
        });
        await enqueueInTransaction(tx, boss, WORKFLOW_QUEUE, { workflowId: flow.id }, jobId);
        created.push({ id: flow.id, kind: source ? ("GRADING" as const) : ("QUICK" as const) });
      }
      return created;
    });
    committed = true;
    return workflows;
  } finally {
    for (const directory of [staging, ...(!committed ? directories : [])])
      await rm(directory, { recursive: true, force: true }).catch((error) => {
        logError("homework.upload.cleanup.failed", error);
      });
  }
}
