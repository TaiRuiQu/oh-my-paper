import "server-only";
import { AppError } from "@/server/errors";
import type { PgBoss } from "pg-boss";
import type { Prisma } from "@/generated/prisma/client";

export async function enqueueInTransaction(
  tx: Prisma.TransactionClient,
  boss: PgBoss,
  queue: string,
  data: object,
  jobId: string,
  delaySeconds = 0,
) {
  const id = await boss.send(queue, data, {
    id: jobId,
    startAfter: delaySeconds,
    heartbeatSeconds: 60,
    db: {
      executeSql: async (sql, values = []) => ({ rows: await tx.$queryRawUnsafe(sql, ...values) }),
    },
  });
  if (!id) throw new AppError("任务未能写入后台队列，请检查队列连接后重试。", "QUEUE_SEND_FAILED");
}
