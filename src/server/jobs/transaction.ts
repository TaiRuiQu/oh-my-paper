import "server-only";
import type { PgBoss } from "pg-boss";
import type { Prisma } from "@/generated/prisma/client";

export async function enqueueInTransaction(tx: Prisma.TransactionClient, boss: PgBoss, queue: string, data: object, jobId: string) {
  const id = await boss.send(queue, data, { id: jobId, heartbeatSeconds: 60,
    db: { executeSql: async (sql, values = []) => ({ rows: await tx.$queryRawUnsafe(sql, ...values) }) } });
  if (!id) throw new Error("Could not queue task.");
}
