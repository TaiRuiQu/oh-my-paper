import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { AccessError, RequestError } from "@/server/http/errors";
import { getActor, loadState } from "./service";
import { assertCanReview } from "./access";
import { batchGradingContext, type BatchGradingInput } from "./batch-grading";
import { consolidationContext } from "./revision-papers";
import type { ConsolidationPaperInput } from "@/contracts/revision-papers";
import { aiRequestSchema } from "@/contracts/platform-ai";
import { runAiTask } from "./ai/runner";
import type { LogContext } from "@/server/logger";

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export async function getAiJob(userId: string, id: string) {
  await getActor(userId);
  const job = await getDb().aiJob.findFirst({ where: { id, userId } });
  if (!job) throw new AccessError(404, "AI 任务不存在。");
  return job;
}

export async function listAiJobs(userId: string) {
  await getActor(userId);
  const models = await getDb().aiModel.findMany({
    where: { isPublic: true },
    select: { id: true, name: true, displayName: true },
    orderBy: { name: "asc" },
  });
  const jobs = await getDb().aiJob.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return {
    models: models.map((model) => ({
      id: model.id,
      name: model.displayName || model.name,
    })),
    jobs,
  };
}

export async function enqueueAiJob(userId: string, raw: unknown) {
  const parsed = aiRequestSchema.safeParse(raw);
  if (!parsed.success)
    throw new RequestError(400, parsed.error.issues.map((issue) => issue.message).join(" "));
  const { kind, modelId, input } = parsed.data;
  const actor = await getActor(userId);
  if (actor.role === "STUDENT" && kind !== "RECOMMEND" && kind !== "CONSOLIDATE")
    throw new AccessError(403, "需要教师权限。");
  const state = await loadState(actor, undefined, {
    reviewing: kind === "GRADE" || kind === "BATCH_GRADE",
  });
  const ids = input as Record<string, unknown>;
  if (kind === "CONSOLIDATE") {
    const request = input as ConsolidationPaperInput;
    const context = await consolidationContext(userId, request);
    if (context.candidates.length < request.count)
      throw new RequestError(
        422,
        `题库中符合条件且未作答的题目只有 ${context.candidates.length} 道，请减少题数或补充题库。`,
      );
  }
  if (kind === "IMPORT" || kind === "BATCH_GRADE") {
    const urls = ids.assetUrls as string[];
    for (const url of urls) {
      const id = /^\/api\/platform\/assets\/([\w-]+)$/.exec(url)?.[1];
      const asset = id ? await getDb().platformAsset.findUnique({ where: { id } }) : null;
      if (!asset || (asset.ownerId !== actor.id && actor.role !== "ADMIN"))
        throw new AccessError(404, "导入图片不存在。");
    }
  }
  if (
    kind === "ENRICH" &&
    (ids.questionIds as string[]).some(
      (id) =>
        !state.questions.some(
          (question) =>
            question.id === id && (question.ownerId === userId || actor.role === "ADMIN"),
        ),
    )
  )
    throw new AccessError(404, "题目不存在。");
  if (
    kind === "TEMPLATE" &&
    !state.papers.some(
      (paper) => paper.id === ids.paperId && (paper.ownerId === userId || actor.role === "ADMIN"),
    )
  )
    throw new AccessError(404, "试卷不存在。");
  if (kind === "BATCH_GRADE") {
    await batchGradingContext(getDb(), state, input as BatchGradingInput);
  }
  if (kind === "GRADE") {
    const submission = state.submissions.find((submission) => submission.id === ids.submissionId);
    if (!submission) throw new AccessError(404, "答卷不存在。");
    const classroom = state.classrooms.find((row) =>
      row.students.some((student) => student.id === submission.studentId),
    );
    const assessment = state.assessments.find((a) => a.id === submission.assessmentId);
    const config = assessment?.papers.find((paper) => paper.paperId === submission.paperId);
    if (!classroom || !config || !assessment) throw new AccessError(404, "答卷不存在。");
    await assertCanReview(getDb(), state.actor, assessment, classroom.id, config.subject);
    if (
      state.assessments.find((assessment) => assessment.id === submission.assessmentId)?.published
    )
      throw new RequestError(409, "请先撤回发布，再进行 AI 阅卷。");
    if (
      state.reviews.some(
        (review) => review.submissionId === submission.id && review.round === "FIRST",
      )
    )
      throw new RequestError(409, "答卷已有第一评，不能自动覆盖。");
  }
  if (kind === "RECOMMEND") {
    const report = ids.studentId
      ? state.analytics.students.find((report) => report.studentId === ids.studentId)
      : state.analytics.students[0];
    if (!report) throw new AccessError(404, "学生学习报告不存在。");
  }
  if (!(await getDb().aiModel.findFirst({ where: { id: modelId, isPublic: true } })))
    throw new RequestError(400, "请选择已启用的模型。");
  const job = await getDb().$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(490223)`;
    if ((await tx.aiJob.count({ where: { userId, status: { in: ["QUEUED", "RUNNING"] } } })) >= 10)
      throw new RequestError(429, "已有 10 个 AI 任务正在排队或运行，请等待完成。");
    return tx.aiJob.create({ data: { userId, kind, modelId, input: json(input) } });
  });
  return { id: job.id };
}

export async function retryAiJob(userId: string, id: string) {
  await getActor(userId);
  const job = await getDb().aiJob.findUnique({ where: { id } });
  if (!job || job.userId !== userId) throw new AccessError(404, "AI 任务不存在。");
  if (job.status !== "FAILED") throw new RequestError(409, "只有失败任务可以重试。");
  const duplicate = await enqueueAiJob(userId, {
    kind: job.kind,
    modelId: job.modelId,
    input: job.input,
  });
  return duplicate;
}

export async function claimAiJob(workerId: string) {
  return getDb().$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(490224)`;
    // A crashed process cannot keep an unobserved job running indefinitely. Retrying is explicit,
    // because the provider might have billed the interrupted request.
    await tx.aiJob.updateMany({
      where: { status: "RUNNING", heartbeatAt: { lt: new Date(Date.now() - 90_000) } },
      data: { status: "FAILED", error: "任务执行进程中断，请重试。", finishedAt: new Date() },
    });
    const queued = await tx.aiJob.findMany({
      where: { status: "QUEUED" },
      orderBy: { createdAt: "asc" },
      take: 100,
    });
    for (const job of queued) {
      const model = await tx.aiModel.findUnique({
        where: { id: job.modelId },
        include: { provider: true },
      });
      if (!model || !model.isPublic) {
        await tx.aiJob.update({
          where: { id: job.id },
          data: {
            status: "FAILED",
            error: "模型已移除或停用，请重新选择模型。",
            finishedAt: new Date(),
          },
        });
        continue;
      }
      const siblingIds = (
        await tx.aiModel.findMany({ where: { providerId: model.providerId }, select: { id: true } })
      ).map((model) => model.id);
      if (
        (await tx.aiJob.count({ where: { modelId: { in: siblingIds }, status: "RUNNING" } })) >=
        model.provider.maxConcurrency
      )
        continue;
      return tx.aiJob.update({
        where: { id: job.id },
        data: {
          status: "RUNNING",
          workerId,
          heartbeatAt: new Date(),
          startedAt: new Date(),
          error: null,
          attempts: { increment: 1 },
        },
      });
    }
    return null;
  });
}

export async function runClaimedAiJob(
  job: NonNullable<Awaited<ReturnType<typeof claimAiJob>>>,
  workerId: string,
  runnerAdapter: typeof runAiTask = runAiTask,
) {
  const active = await getDb().aiJob.findFirst({
    where: { id: job.id, status: "RUNNING", workerId },
  });
  if (!active) throw new RequestError(409, "任务已结束或已由其他执行进程接管。");
  const timer = setInterval(() => {
    void getDb()
      .aiJob.updateMany({
        where: { id: job.id, status: "RUNNING", workerId },
        data: { heartbeatAt: new Date() },
      })
      .catch(() => {});
  }, 15_000);
  const events: unknown[] = [];
  const modelContext: LogContext = { modelId: job.modelId };
  try {
    const result = await runnerAdapter({
      userId: job.userId,
      kind: job.kind as Parameters<typeof runAiTask>[0]["kind"],
      input: job.input,
      modelId: job.modelId,
      jobId: job.id,
      onEvent: async (event) => {
        if (event && typeof event === "object" && !Array.isArray(event) && event.type === "start") {
          const model = event.model;
          if (model && typeof model === "object" && !Array.isArray(model))
            for (const key of ["model", "providerName", "providerId", "apiType"])
              if (typeof model[key] === "string") modelContext[key] = model[key];
        }
        if (events.length < 200) events.push(event);
        await getDb().aiJob.updateMany({
          where: { id: job.id, status: "RUNNING", workerId },
          data: {
            events: json(events),
            heartbeatAt: new Date(),
            // Persist independently of the bounded trace, before the atomic domain commit.
            ...(event && typeof event === "object" && !Array.isArray(event) && event.cost
              ? { cost: json(event.cost) }
              : {}),
          },
        });
      },
    });
    await getDb().aiJob.updateMany({
      where: { id: job.id, status: "RUNNING", workerId },
      data: { status: "COMPLETED", result: json(result), finishedAt: new Date() },
    });
  } catch (error) {
    const { logError } = await import("@/server/logger");
    const diagnostic = logError("platform.ai.job.failed", error, {
      jobId: job.id,
      kind: job.kind,
      ...modelContext,
    });
    const message =
      error instanceof RequestError || error instanceof AccessError
        ? error.message
        : `${diagnostic.message}（错误编号：${diagnostic.errorId}）`;
    await getDb().aiJob.updateMany({
      where: { id: job.id, status: "RUNNING", workerId },
      data: { status: "FAILED", error: message, finishedAt: new Date() },
    });
  } finally {
    clearInterval(timer);
  }
}
