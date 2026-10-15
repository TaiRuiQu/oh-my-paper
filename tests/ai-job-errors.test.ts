import { afterEach, expect, it, vi } from "vitest";
import { APICallError, RetryError } from "ai";

const db = vi.hoisted(() => ({ findFirst: vi.fn(), updateMany: vi.fn() }));
vi.mock("@/server/db/client", () => ({ getDb: () => ({ aiJob: db }) }));
vi.mock("@/server/platform/service", () => ({}));
vi.mock("@/server/platform/ai/runner", () => ({ runAiTask: vi.fn() }));
import { runClaimedAiJob } from "@/server/platform/ai-jobs";

afterEach(() => vi.restoreAllMocks());

it("saves a readable failure and logs model identity without retrying the whole task", async () => {
  const output = vi.spyOn(console, "error").mockImplementation(() => {});
  db.findFirst.mockResolvedValue({ id: "job" });
  db.updateMany.mockResolvedValue({ count: 1 });
  const runner = vi.fn(async (options) => {
    await options.onEvent({
      type: "start",
      model: {
        model: "configured-model",
        providerName: "学校 AI 网关",
        providerId: "provider",
        apiType: "openai_responses",
        apiKey: "must-not-be-logged",
      },
    });
    const failure = new APICallError({
      message: "Service Unavailable",
      url: "https://gateway.example/v1/responses",
      requestBodyValues: {},
      statusCode: 503,
    });
    throw new RetryError({
      message: "Failed after 3 attempts",
      reason: "maxRetriesExceeded",
      errors: [failure, failure, failure],
    });
  });
  await runClaimedAiJob(
    { id: "job", userId: "teacher", kind: "IMPORT", modelId: "model", input: {} } as Parameters<
      typeof runClaimedAiJob
    >[0],
    "worker",
    runner,
  );
  expect(runner).toHaveBeenCalledTimes(1);
  expect(JSON.parse(output.mock.calls[0][0])).toMatchObject({
    jobId: "job",
    kind: "IMPORT",
    modelId: "model",
    model: "configured-model",
    providerName: "学校 AI 网关",
    providerId: "provider",
    apiType: "openai_responses",
    attempts: 3,
  });
  expect(output.mock.calls[0][0]).not.toContain("must-not-be-logged");
  expect(db.updateMany).toHaveBeenLastCalledWith({
    where: { id: "job", status: "RUNNING", workerId: "worker" },
    data: {
      status: "FAILED",
      error: expect.stringMatching(/上游服务暂时不可用.*共尝试 3 次.*错误编号/),
      finishedAt: expect.any(Date),
    },
  });
});
