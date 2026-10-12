import { describe, it, expect, vi } from "vitest";
const { findFirst } = vi.hoisted(() => ({ findFirst: vi.fn() }));
vi.mock("@/server/db/client", () => ({ getDb: () => ({ workerHeartbeat: { findFirst } }) }));
import { workerAvailable, requireWorker, WORKER_STALE_MS } from "@/server/jobs/health";
describe("worker availability", () => {
  it("rejects new jobs with an actionable 503 when no consumer is alive", async () => {
    findFirst.mockResolvedValue(null);
    expect(await workerAvailable()).toBe(false);
    await expect(requireWorker()).rejects.toMatchObject({ status: 503 });
    const where = findFirst.mock.calls.at(-1)![0].where;
    expect(Date.now() - where.updatedAt.gte.getTime()).toBeGreaterThanOrEqual(WORKER_STALE_MS);
  });
  it("accepts jobs when a consumer has a fresh database heartbeat", async () => {
    findFirst.mockResolvedValue({ id: "worker" });
    expect(await workerAvailable()).toBe(true);
    await expect(requireWorker()).resolves.toBeUndefined();
  });
});
