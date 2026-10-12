import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadEnvironment } from "./load-env.mjs";

loadEnvironment();

async function main() {
  const { createJobClient, initializeQueues } = await import("../src/server/jobs/client");
  const { FRAMEWORK_PING_QUEUE } = await import("../src/contracts/jobs");
  const producer = createJobClient();
  const retryQueue = `framework.retry.${randomUUID()}`;
  let createdRetryQueue = false;
  async function waitForCompletion(queue: string, id: string) {
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      const job = await producer.getJobById(queue, id);
      if (job?.state === "completed") return job;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error("Timed out waiting for job completion");
  }
  try {
    await producer.start();
    await initializeQueues(producer);
    const id = await producer.send(FRAMEWORK_PING_QUEUE, { message: "smoke-test" });
    assert.ok(id);
    // This queue has no consumer here: the separate Worker process must handle it.
    await waitForCompletion(FRAMEWORK_PING_QUEUE, id);
    await producer.createQueue(retryQueue, { retryLimit: 1, retryDelay: 1, expireInSeconds: 30 });
    createdRetryQueue = true;
    let attempts = 0;
    await producer.work(retryQueue, { pollingIntervalSeconds: 0.5 }, async () => {
      if (++attempts === 1) throw new Error("Intentional retry probe");
      return { ok: true };
    });
    const retryId = await producer.send(retryQueue, {});
    assert.ok(retryId);
    const result = await waitForCompletion(retryQueue, retryId);
    assert.equal(result.retryCount, 1);
    assert.equal(attempts, 2);
    console.log(
      "Queue passed: separate Worker consumed a persistent job and a failed task retried successfully.",
    );
  } finally {
    if (createdRetryQueue) {
      await producer.offWork(retryQueue);
      await producer.deleteQueue(retryQueue);
    }
    await producer.stop({ graceful: true, timeout: 5000 });
  }
}

main().catch(() => {
  console.error("Queue test failed. Ensure PostgreSQL and the separate Worker are running.");
  process.exitCode = 1;
});
