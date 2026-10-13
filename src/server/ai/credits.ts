import "server-only";
import type { LanguageModelUsage } from "ai";
import { creditMultiplierSchema } from "@/contracts/ai-providers";
import { creditAmount } from "@/lib/credits";
import { getDb } from "@/server/db/client";
import { AppError } from "@/server/errors";
import type { Prisma } from "@/generated/prisma/client";

export async function requireCredits(userId: string, tx = getDb() as Prisma.TransactionClient) {
  const user = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: { credits: true, role: true },
  });
  if (user.role !== "ADMIN" && user.credits.lessThan(0))
    throw new AppError(
      "Credit 余额为负，无法创建新任务。当前任务会继续完成，已保存的结果保留。",
      "CREDITS_EXHAUSTED",
      402,
    );
}

export function usageCharge(usage: LanguageModelUsage, multiplier: number) {
  creditMultiplierSchema.parse(multiplier);
  const details = usage.inputTokenDetails;
  const input =
    usage.inputTokens ??
    (details?.noCacheTokens !== undefined &&
    details?.cacheReadTokens !== undefined &&
    details?.cacheWriteTokens !== undefined
      ? details.noCacheTokens + details.cacheReadTokens + details.cacheWriteTokens
      : undefined);
  const output =
    usage.outputTokens ??
    (usage.outputTokenDetails?.textTokens !== undefined &&
    usage.outputTokenDetails?.reasoningTokens !== undefined
      ? usage.outputTokenDetails.textTokens + usage.outputTokenDetails.reasoningTokens
      : undefined);
  const cached = details?.cacheReadTokens ?? 0;
  if (
    [input, output, cached].some((count) => !Number.isSafeInteger(count) || count! < 0) ||
    cached > input!
  )
    throw new AppError(
      "模型未返回有效 token 用量，已停止后续调用。请联系管理员检查模型接口。",
      "AI_USAGE_UNAVAILABLE",
      422,
    );
  const weighted =
    BigInt(input! - cached) * 10_000n + BigInt(cached) * 2_000n + BigInt(output!) * 50_000n;
  const multiplierUnits = BigInt(Math.round(multiplier * 10_000));
  return {
    inputTokens: input!,
    cachedTokens: cached,
    outputTokens: output!,
    credits: creditAmount((weighted * multiplierUnits) / 10_000n),
  };
}

export interface CreditMeter {
  beforeCall(): Promise<void>;
  record(callId: string, usage: LanguageModelUsage): Promise<void>;
}

export function taskCreditMeter(options: {
  userId: string;
  taskId: string;
  taskKind: "EXAM" | "ANSWER" | "GRADING";
  attempt: string;
  model: string;
  providerId: string;
  providerName: string;
  modelId?: string;
  displayName?: string;
  multiplier: number;
}): CreditMeter {
  return {
    beforeCall: async () => {
      const task =
        options.taskKind === "EXAM"
          ? await getDb().examTask.findUnique({
              where: { id: options.taskId },
              select: { status: true, attempt: true },
            })
          : await getDb().examAgentTask.findUnique({
              where: { id: options.taskId },
              select: { status: true, attempt: true },
            });
      if (task?.status !== "RUNNING" || task.attempt !== options.attempt)
        throw new AppError("任务执行实例已更新，停止模型调用。", "AGENT_STALE", 409);
    },
    record: async (id, usage) => {
      const charge = usageCharge(usage, options.multiplier);
      await getDb().$transaction(async (tx) => {
        // All concurrent tasks debit the same account under this lock. The call ID
        // makes callback replay idempotent, including after a task failure.
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${options.userId} FOR UPDATE`;
        if (await tx.creditUsage.findUnique({ where: { id } })) return;
        const modelId =
          options.modelId ??
          (
            await tx.aiModel.findFirst({
              where: { providerId: options.providerId, name: options.model },
              select: { id: true },
            })
          )?.id;
        await tx.creditUsage.create({
          data: {
            id,
            userId: options.userId,
            taskId: options.taskId,
            taskKind: options.taskKind,
            attempt: options.attempt,
            providerId: options.providerId,
            providerName: options.providerName,
            modelId,
            displayName: options.displayName ?? "",
            model: options.model,
            creditMultiplier: options.multiplier,
            ...charge,
          },
        });
        const user = await tx.user.findUniqueOrThrow({
          where: { id: options.userId },
          select: { role: true },
        });
        if (user.role !== "ADMIN")
          await tx.user.update({
            where: { id: options.userId },
            data: { credits: { decrement: charge.credits } },
          });
        // Count every paid call across retries. A stale call still consumed tokens.
        if (options.taskKind === "EXAM")
          await tx.examTask.update({
            where: { id: options.taskId },
            data: { creditsSpent: { increment: charge.credits } },
          });
        else
          await tx.examAgentTask.update({
            where: { id: options.taskId },
            data: { creditsSpent: { increment: charge.credits } },
          });
      });
    },
  };
}
