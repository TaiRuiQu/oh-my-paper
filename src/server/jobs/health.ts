import "server-only";
import { getDb } from "@/server/db/client";
import { RequestError } from "@/server/http/errors";

export const WORKER_STALE_MS = 45_000;
export async function workerAvailable() {
  return Boolean(await getDb().workerHeartbeat.findFirst({ where: { updatedAt: { gte: new Date(Date.now() - WORKER_STALE_MS) } } }));
}
export async function requireWorker() {
  if (!await workerAvailable()) throw new RequestError(503, "处理服务暂时离线，请稍后重新提交。已提交的试卷会在服务恢复后继续处理。");
}
