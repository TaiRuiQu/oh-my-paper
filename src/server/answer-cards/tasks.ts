import "server-only";
import { randomUUID } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import { mkdir, rm } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import sharp from "sharp";
import { z } from "zod";
import type {
  AnswerCardTemplate,
  AnswerCardBatch,
  AnswerCardStudent,
} from "@/generated/prisma/client";
import {
  CARD_TEMPLATE_QUEUE,
  CARD_BATCH_QUEUE,
  cardRegionsSchema,
  type CardTemplate,
  type CardBatch,
} from "@/contracts/answer-cards";
import { generatedAnswerSchema } from "@/contracts/exam-agents";
import { providerSnapshotSchema, type ProviderSnapshot } from "@/contracts/ai-providers";
import type { TaskModelSelection } from "@/contracts/user-ai";
import type { Exam } from "@/contracts/exams";
import { getDb } from "@/server/db/client";
import { getStoragePaths } from "@/server/config/env";
import { requireCredits, taskCreditMeter } from "@/server/ai/credits";
import { getUserProvider } from "@/server/ai/user-settings";
import { createProviderExamModel } from "@/server/ai/providers";
import { decryptApiKey } from "@/server/ai/credentials";
import { getJobProducer } from "@/server/jobs/client";
import { enqueueInTransaction } from "@/server/jobs/transaction";
import { requireWorker } from "@/server/jobs/health";
import { AppError } from "@/server/errors";
import { AccessError, RequestError } from "@/server/http/errors";
import { logError } from "@/server/logger";
import { ownedExamTask, taskResult, taskDirectory } from "@/server/exams/tasks";
import { receiveExamUpload } from "@/server/exams/uploads";
import { prepareDocuments, DEFAULT_LIMITS } from "@/server/exams/documents";
import { activityWriter } from "@/server/exams/activity";
import { markCardTemplate, validateCardRegions } from "./layout";
import { gradeCardQuestion, mapConcurrent, cardResultSchema } from "./grading";
export const cardJobSchema = z.strictObject({ id: z.uuid() });
async function isCardAdmin(userId: string) {
  return (
    (await getDb().user.findUnique({ where: { id: userId }, select: { role: true } }))?.role ===
    "ADMIN"
  );
}
export function cardDirectory(kind: "templates" | "batches", id: string) {
  if (!z.uuid().safeParse(id).success) throw new AccessError(404, "答题卡任务不存在。");
  return join(getStoragePaths().storage, "answer-cards", kind, id);
}
export async function ownedTemplate(userId: string, id: string) {
  if (!z.uuid().safeParse(id).success) throw new AccessError(404, "模板不存在。");
  const template = await getDb().answerCardTemplate.findFirst({ where: { id, userId } });
  if (!template) throw new AccessError(404, "模板不存在或无权访问。");
  return template;
}
function templateSummary(t: AnswerCardTemplate, isAdmin = false): CardTemplate {
  return {
    id: t.id,
    sourceId: t.sourceId,
    name: t.name,
    status: t.status,
    pageCount: t.pageCount,
    regions: t.status === "COMPLETED" ? cardRegionsSchema.parse(t.regions) : [],
    error: t.error ? (isAdmin ? t.error : "区域标记未能完成，请重试或上传更清晰的模板。") : null,
    createdAt: t.createdAt.toISOString(),
    creditsSpent: t.creditsSpent.toFixed(8),
  };
}
function batchSummary(
  b: AnswerCardBatch & { students: AnswerCardStudent[] },
  isAdmin = false,
  detail = false,
): CardBatch {
  const exam = b.examSnapshot as unknown as Exam,
    questions = exam.sections.flatMap((s) => s.questions).length;
  const completed = b.students.reduce(
    (sum, s) => sum + cardResultSchema.parse(s.result).questions.length,
    0,
  );
  return {
    id: b.id,
    templateId: b.templateId,
    name: b.name,
    status: b.status,
    createdAt: b.createdAt.toISOString(),
    creditsSpent: b.creditsSpent.toFixed(8),
    error: b.error
      ? isAdmin
        ? b.error
        : "部分答题卡未能完成，已完成的结果保留。请重试未完成题目。"
      : null,
    total: questions * b.students.length,
    completed,
    students: b.students.map((s) => ({
      id: s.id,
      name: s.name,
      status: s.status,
      completed: cardResultSchema.parse(s.result).questions.length,
      result:
        detail && (s.status === "COMPLETED" || isAdmin)
          ? cardResultSchema.parse(s.result)
          : { questions: [] },
      error: s.error
        ? isAdmin
          ? s.error
          : "未能完成，请检查页面顺序、清晰度及模板是否一致后重试。"
        : null,
    })),
    ...(detail ? { exam } : {}),
  };
}
async function reconcile(kind: "templates" | "batches", id: string, jobId: string, status: string) {
  if (!["QUEUED", "RUNNING"].includes(status)) return;
  const queue = kind === "templates" ? CARD_TEMPLATE_QUEUE : CARD_BATCH_QUEUE;
  try {
    const job = await (await getJobProducer()).getJobById(queue, jobId);
    if (!job || ["failed", "cancelled", "completed"].includes(job.state)) {
      const args = {
        where: { id, jobId, status: { in: ["QUEUED" as const, "RUNNING" as const] } },
        data: { status: "FAILED" as const, error: "后台任务中断，已保存结果保留，请重试。" },
      };
      if (kind === "templates") await getDb().answerCardTemplate.updateMany(args);
      else await getDb().answerCardBatch.updateMany(args);
    }
  } catch (error) {
    logError("card.reconcile.failed", error, { id });
  }
}
export async function listCards(userId: string) {
  const db = getDb(),
    admin = await isCardAdmin(userId);
  const [templates, batches] = await Promise.all([
    db.answerCardTemplate.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 50 }),
    db.answerCardBatch.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { students: { orderBy: { position: "asc" } } },
    }),
  ]);
  await Promise.all([
    ...templates.map((t) => reconcile("templates", t.id, t.jobId, t.status)),
    ...batches.map((b) => reconcile("batches", b.id, b.jobId, b.status)),
  ]);
  const [freshTemplates, freshBatches] = await Promise.all([
    db.answerCardTemplate.findMany({
      where: { id: { in: templates.map((t) => t.id) } },
      orderBy: { createdAt: "desc" },
    }),
    db.answerCardBatch.findMany({
      where: { id: { in: batches.map((b) => b.id) } },
      orderBy: { createdAt: "desc" },
      include: { students: { orderBy: { position: "asc" } } },
    }),
  ]);
  return {
    templates: freshTemplates.map((t) => templateSummary(t, admin)),
    batches: freshBatches.map((b) => batchSummary(b, admin)),
  };
}
export async function cardBatchDetail(userId: string, id: string) {
  if (!z.uuid().safeParse(id).success) throw new AccessError(404, "批改记录不存在。");
  let batch = await getDb().answerCardBatch.findFirst({
    where: { id, userId },
    include: {
      students: { orderBy: { position: "asc" } },
      template: { select: { sourceId: true } },
    },
  });
  if (!batch) throw new AccessError(404, "批改记录不存在或无权访问。");
  await reconcile("batches", id, batch.jobId, batch.status);
  batch = await getDb().answerCardBatch.findUniqueOrThrow({
    where: { id },
    include: {
      students: { orderBy: { position: "asc" } },
      template: { select: { sourceId: true } },
    },
  });
  return {
    ...batchSummary(batch, await isCardAdmin(userId), true),
    sourceId: batch.template.sourceId,
  };
}
async function lockAndLimit(tx: Parameters<typeof enqueueInTransaction>[0], userId: string) {
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
  await requireCredits(userId, tx);
  const status = { in: ["QUEUED", "RUNNING"] as ("QUEUED" | "RUNNING")[] };
  if (
    (await tx.answerCardBatch.count({ where: { userId, status } })) +
      (await tx.answerCardTemplate.count({ where: { userId, status } })) >=
    3
  )
    throw new RequestError(429, "已有 3 个答题卡任务，请等待完成。");
}
export async function createCardTemplate(request: Request, userId: string, sourceId: string) {
  const source = await ownedExamTask(userId, sourceId),
    exam = await taskResult(source);
  if (source.deletedAt || !exam) throw new RequestError(409, "请先完成试卷识别。");
  await requireCredits(userId);
  await requireWorker();
  const id = uuidv7(),
    jobId = randomUUID(),
    directory = cardDirectory("templates", id);
  let models: TaskModelSelection = {};
  const files = await receiveExamUpload(request, join(directory, "inputs"), {
    modelPurposes: ["exam"],
    onModels: (value) => {
      models = value;
    },
  });
  try {
    const provider = await getUserProvider(
        userId,
        "exam",
        models.exam,
        models.reasoningEfforts?.exam,
      ),
      boss = await getJobProducer();
    const saved = await getDb().$transaction(async (tx) => {
      await lockAndLimit(tx, userId);
      await tx.$queryRaw`SELECT id FROM exams WHERE id = ${exam.id} FOR UPDATE`;
      const current = await tx.exam.findUniqueOrThrow({ where: { id: exam.id } });
      if (current.revision !== exam.revision)
        throw new RequestError(409, "试卷已更新，请重新提交模板。");
      const t = await tx.answerCardTemplate.create({
        data: {
          id,
          jobId,
          userId,
          sourceId,
          examRevision: current.revision,
          name: `${exam.name} · ${files[0].name}`,
          inputFiles: files.map((f) => relative(directory, f.path)),
          providerSnapshot: provider,
        },
      });
      await enqueueInTransaction(tx, boss, CARD_TEMPLATE_QUEUE, { id }, jobId);
      return t;
    });
    return templateSummary(saved);
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
export async function createCardBatch(request: Request, userId: string, templateId: string) {
  const template = await ownedTemplate(userId, templateId),
    source = await ownedExamTask(userId, template.sourceId),
    exam = await taskResult(source);
  if (
    template.status !== "COMPLETED" ||
    !exam ||
    source.deletedAt ||
    exam.revision !== template.examRevision
  )
    throw new RequestError(409, "请选择已完成标记且与当前试卷版本一致的模板。");
  const perStudent = Number(new URL(request.url).searchParams.get("filesPerStudent") ?? "1");
  if (!Number.isInteger(perStudent) || perStudent < 1 || perStudent > 20)
    throw new RequestError(400, "每位学生的文件数必须为 1–20。");
  await requireCredits(userId);
  await requireWorker();
  const id = uuidv7(),
    jobId = randomUUID(),
    directory = cardDirectory("batches", id);
  let models: TaskModelSelection = {};
  const files = await receiveExamUpload(request, join(directory, "inputs"), {
    modelPurposes: ["grading"],
    onModels: (value) => {
      models = value;
    },
  });
  try {
    if (files.length % perStudent || (perStudent > 1 && files.some((f) => /\.pdf$/i.test(f.name))))
      throw new RequestError(
        400,
        "图片按每位学生的文件数分组，不能留有余页；PDF 请每位学生合并为一个文件。",
      );
    const provider = await getUserProvider(
        userId,
        "grading",
        models.grading,
        models.reasoningEfforts?.grading,
      ),
      boss = await getJobProducer();
    const batch = await getDb().$transaction(async (tx) => {
      await lockAndLimit(tx, userId);
      await tx.$queryRaw`SELECT id FROM exams WHERE id = ${exam.id} FOR UPDATE`;
      if (
        (await tx.exam.findUniqueOrThrow({ where: { id: exam.id } })).revision !==
        template.examRevision
      )
        throw new RequestError(409, "试卷版本已更新，请重新标记模板。");
      const reference = await tx.questionAnswer.findMany({
        where: { examId: exam.id },
        select: { questionId: true, solution: true, gradingCriteria: true },
      });
      if (
        exam.sections.some((s) =>
          s.questions.some((q) => !reference.some((r) => r.questionId === q.id)),
        )
      )
        throw new RequestError(409, "请先在试卷详情页上传或生成覆盖全部题目的标准答案。");
      const students = Array.from({ length: files.length / perStudent }, (_, i) => ({
        name: basename(files[i * perStudent].name).replace(/\.[^.]+$/, ""),
        position: i,
        inputFiles: files
          .slice(i * perStudent, (i + 1) * perStudent)
          .map((f) => relative(directory, f.path)),
      }));
      const b = await tx.answerCardBatch.create({
        data: {
          id,
          jobId,
          userId,
          templateId,
          name: `${exam.name} · ${students.length} 份答题卡`,
          examSnapshot: JSON.parse(JSON.stringify(exam)),
          reference,
          providerSnapshot: provider,
          students: { create: students },
        },
        include: { students: { orderBy: { position: "asc" } } },
      });
      await enqueueInTransaction(tx, boss, CARD_BATCH_QUEUE, { id }, jobId);
      return b;
    });
    return batchSummary(batch);
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
export async function retryCard(userId: string, kind: "templates" | "batches", id: string) {
  const db = getDb(),
    args = { where: { id, userId } };
  const task =
    kind === "templates"
      ? await db.answerCardTemplate.findFirst(args)
      : await db.answerCardBatch.findFirst(args);
  if (!task) throw new AccessError(404, "任务不存在。");
  await reconcile(kind, id, task.jobId, task.status);
  const latest =
    kind === "templates"
      ? await db.answerCardTemplate.findUniqueOrThrow({ where: { id } })
      : await db.answerCardBatch.findUniqueOrThrow({ where: { id } });
  if (latest.status !== "FAILED") throw new RequestError(409, "只有失败任务可以重试。");
  if (kind === "templates") {
    const t = await ownedTemplate(userId, id),
      source = await ownedExamTask(userId, t.sourceId),
      exam = await taskResult(source);
    if (!exam || source.deletedAt || exam.revision !== t.examRevision)
      throw new RequestError(409, "试卷已更新，请重新上传模板。");
  }
  await requireCredits(userId);
  await requireWorker();
  const boss = await getJobProducer(),
    jobId = randomUUID();
  await db.$transaction(async (tx) => {
    await lockAndLimit(tx, userId);
    const args = {
      where: { id, userId, jobId: latest.jobId, status: "FAILED" as const },
      data: { status: "QUEUED" as const, jobId, error: null, errorCode: null },
    };
    const updated =
      kind === "templates"
        ? await tx.answerCardTemplate.updateMany(args)
        : await tx.answerCardBatch.updateMany(args);
    if (!updated.count) throw new RequestError(409, "任务状态已变化，请刷新。");
    await enqueueInTransaction(
      tx,
      boss,
      kind === "templates" ? CARD_TEMPLATE_QUEUE : CARD_BATCH_QUEUE,
      { id },
      jobId,
    );
  });
}
function cardModel(
  task: { id: string; userId: string; providerSnapshot: unknown },
  kind: "CARD_TEMPLATE" | "CARD_BATCH",
  attempt: string,
  key: string,
) {
  const p = providerSnapshotSchema.parse(task.providerSnapshot);
  return createProviderExamModel(
    p,
    key,
    globalThis.fetch,
    taskCreditMeter({
      userId: task.userId,
      taskId: task.id,
      taskKind: kind,
      attempt,
      model: p.model,
      providerId: p.providerId,
      providerName: p.name,
      modelId: p.modelId,
      displayName: p.displayName,
      multiplier: p.creditMultiplier ?? 1,
    }),
    task.id,
  );
}
export async function processCardTemplate(id: string, jobId: string, workerSignal: AbortSignal) {
  const db = getDb(),
    task = await db.answerCardTemplate.findUnique({ where: { id } });
  if (!task || task.jobId !== jobId || !["QUEUED", "RUNNING"].includes(task.status)) return;
  const attempt = randomUUID(),
    where = { id, jobId, attempt, status: "RUNNING" as const };
  if (
    !(
      await db.answerCardTemplate.updateMany({
        where: { id, jobId, attempt: task.attempt, status: task.status },
        data: { attempt, status: "RUNNING", error: null },
      })
    ).count
  )
    return;
  let key: string | undefined;
  try {
    const source = await ownedExamTask(task.userId, task.sourceId),
      exam = await taskResult(source);
    if (!exam || exam.revision !== task.examRevision)
      throw new AppError("试卷版本已更新。", "CARD_REVISION_CHANGED", 409);
    key = decryptApiKey(providerSnapshotSchema.parse(task.providerSnapshot).encryptedApiKey);
    const outputDir = join(cardDirectory("templates", id), attempt),
      signal = AbortSignal.any([workerSignal, AbortSignal.timeout(25 * 60_000)]);
    const result = await markCardTemplate({
      exam,
      files: task.inputFiles.map((f) => join(cardDirectory("templates", id), f)),
      outputDir,
      model: cardModel(task, "CARD_TEMPLATE", attempt, key),
      signal,
      onEvent: activityWriter(outputDir),
    });
    signal.throwIfAborted();
    await db.answerCardTemplate.updateMany({
      where,
      data: {
        status: "COMPLETED",
        regions: result.regions,
        pageCount: result.pages.length,
        outputKey: attempt,
      },
    });
  } catch (error) {
    const d = logError(
      "card.template.failed",
      error,
      { id, attempt },
      { secrets: key ? [key] : [] },
    );
    await db.answerCardTemplate.updateMany({
      where,
      data: { status: "FAILED", error: d.message, errorCode: d.code },
    });
  }
}
export async function processCardBatch(id: string, jobId: string, workerSignal: AbortSignal) {
  const db = getDb(),
    task = await db.answerCardBatch.findUnique({
      where: { id },
      include: { template: true, students: { orderBy: { position: "asc" } } },
    });
  if (!task || task.jobId !== jobId || !["QUEUED", "RUNNING"].includes(task.status)) return;
  const attempt = randomUUID(),
    where = { id, jobId, attempt, status: "RUNNING" as const };
  if (
    !(
      await db.answerCardBatch.updateMany({
        where: { id, jobId, attempt: task.attempt, status: task.status },
        data: { attempt, status: "RUNNING", error: null },
      })
    ).count
  )
    return;
  let key: string | undefined;
  const controller = new AbortController(),
    signal = AbortSignal.any([workerSignal, controller.signal, AbortSignal.timeout(25 * 60_000)]);
  try {
    const exam = task.examSnapshot as unknown as Exam,
      source = await ownedExamTask(task.userId, task.template.sourceId);
    if (!source.outputKey || !task.template.outputKey) throw new Error("Source images unavailable");
    const reference = z.array(generatedAnswerSchema).parse(task.reference),
      provider: ProviderSnapshot = providerSnapshotSchema.parse(task.providerSnapshot);
    key = decryptApiKey(provider.encryptedApiKey);
    const regions = validateCardRegions(
      task.template.regions,
      exam,
      Array.from({ length: task.template.pageCount }, (_, i) => ({ page: i + 1 })),
    );
    const templateDir = join(cardDirectory("templates", task.template.id), task.template.outputKey);
    // Prepare each student's pages, then run a flat work pool across all students and questions.
    const prepared: {
      student: AnswerCardStudent;
      pages: Awaited<ReturnType<typeof prepareDocuments>>;
    }[] = [];
    await mapConcurrent(
      task.students.filter((s) => s.status !== "COMPLETED"),
      2,
      async (student) => {
        signal.throwIfAborted();
        try {
          await db.answerCardStudent.update({
            where: { id: student.id },
            data: { status: "RUNNING", error: null },
          });
          await mkdir(join(cardDirectory("batches", id), attempt, student.id), {
            recursive: true,
            mode: 0o700,
          });
          const pages = await prepareDocuments(
            student.inputFiles.map((f) => join(cardDirectory("batches", id), f)),
            join(cardDirectory("batches", id), attempt, student.id),
            DEFAULT_LIMITS,
            signal,
          );
          if (pages.length !== task.template.pageCount)
            throw new Error(`Expected ${task.template.pageCount} pages, received ${pages.length}`);
          for (const page of pages) {
            const info = await sharp(
              join(templateDir, "pages", `${String(page.page).padStart(3, "0")}.jpg`),
            ).metadata();
            if (Math.abs(page.width / page.height / (info.width! / info.height!) - 1) > 0.04)
              throw new Error("Page orientation or aspect ratio differs from template");
          }
          prepared.push({ student, pages });
        } catch (error) {
          if (signal.aborted) throw error;
          const d = logError("card.student.prepare.failed", error, {
            batchId: id,
            studentId: student.id,
          });
          await db.answerCardStudent.update({
            where: { id: student.id },
            data: { status: "FAILED", error: d.message },
          });
        }
      },
    );
    const jobs = prepared.flatMap((p) =>
      regions
        .filter(
          (r) =>
            !cardResultSchema
              .parse(p.student.result)
              .questions.some((q) => q.questionId === r.questionId),
        )
        .map((region) => ({ ...p, region })),
    );
    await mapConcurrent(jobs, provider.maxConcurrency, async (job) => {
      signal.throwIfAborted();
      try {
        const result = await gradeCardQuestion({
          exam,
          region: job.region,
          reference: reference.find((r) => r.questionId === job.region.questionId)!,
          pages: job.pages,
          sourceDirectory: join(taskDirectory(source.id), source.outputKey!),
          model: cardModel(task, "CARD_BATCH", attempt, key!),
          signal,
        });
        signal.throwIfAborted();
        await db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM answer_card_batches WHERE id = ${id} FOR UPDATE`;
          if (!(await tx.answerCardBatch.findFirst({ where })))
            throw new AppError("执行实例已更新。", "AGENT_STALE", 409);
          const current = await tx.answerCardStudent.findUniqueOrThrow({
              where: { id: job.student.id },
            }),
            saved = cardResultSchema.parse(current.result);
          saved.questions = saved.questions.filter((q) => q.questionId !== result.questionId);
          saved.questions.push(result);
          await tx.answerCardStudent.update({
            where: { id: current.id },
            data: { result: JSON.parse(JSON.stringify(saved)) },
          });
        });
      } catch (error) {
        if (
          error instanceof AppError &&
          ["AI_USAGE_UNAVAILABLE", "AGENT_STALE", "CREDIT_SETTLEMENT_FAILED"].includes(error.code)
        ) {
          controller.abort(error);
          throw error;
        }
        if (signal.aborted) throw error;
        const d = logError(
          "card.question.failed",
          error,
          { batchId: id, studentId: job.student.id, questionId: job.region.questionId },
          { secrets: key ? [key] : [] },
        );
        await db.answerCardStudent.update({
          where: { id: job.student.id },
          data: { error: d.message },
        });
      }
    });
    signal.throwIfAborted();
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM answer_card_batches WHERE id = ${id} FOR UPDATE`;
      if (!(await tx.answerCardBatch.findFirst({ where }))) return;
      const students = await tx.answerCardStudent.findMany({ where: { batchId: id } });
      let failed = false;
      for (const student of students) {
        if (student.status === "COMPLETED") continue;
        const results = cardResultSchema.parse(student.result).questions;
        if (results.length !== regions.length) {
          failed = true;
          await tx.answerCardStudent.update({
            where: { id: student.id },
            data: { status: "FAILED" },
          });
          continue;
        }
        const submission = await tx.submission.create({ data: { examId: exam.id } });
        await tx.submissionAnswer.createMany({
          data: results.map((q) => ({ ...q, examId: exam.id, submissionId: submission.id })),
        });
        await tx.answerCardStudent.update({
          where: { id: student.id },
          data: { status: "COMPLETED", submissionId: submission.id, error: null },
        });
      }
      await tx.answerCardBatch.updateMany({
        where,
        data: {
          status: failed ? "FAILED" : "COMPLETED",
          error: failed ? "部分题目评分失败，重试只调用未完成题目。" : null,
        },
      });
    });
  } catch (error) {
    controller.abort(error);
    const d = logError("card.batch.failed", error, { id, attempt }, { secrets: key ? [key] : [] });
    await db.answerCardBatch.updateMany({
      where,
      data: { status: "FAILED", error: d.message, errorCode: d.code },
    });
  }
}
