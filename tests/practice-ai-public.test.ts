import { beforeEach, expect, it, vi } from "vitest";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import type { AiJob } from "@/generated/prisma/client";
import { projectAiJob } from "@/server/platform/ai-job-projection";
import { encodeAiProgress, decodeAiProgress } from "@/lib/ai-progress-codec";
import { aiJobResultLink } from "@/lib/ai-job-display";
const mock = vi.hoisted(() => ({
  get: vi.fn(),
  list: vi.fn(),
  subscribe: vi.fn(),
  actor: vi.fn(),
}));
vi.mock("@/server/platform/assets", () => ({ accessibleAsset: vi.fn(), assetId: vi.fn() }));
vi.mock("@/server/platform/ai-jobs", () => ({ getAiJob: mock.get, listAiJobs: mock.list }));
vi.mock("@/server/platform/ai-progress-notifications", () => ({
  subscribeAiProgress: mock.subscribe,
}));
vi.mock("@/server/platform/access", () => ({ getActor: mock.actor }));
vi.mock("@/server/config/env", () => ({
  getEnv: () => ({ AI_PROGRESS_FORMAT: "json", BETTER_AUTH_URL: "https://paper.test" }),
}));
import { aiProgressResponse } from "@/server/platform/ai-progress";
import { createXiaozhiTools } from "@/server/xiaozhi/tools";
const secret = "PRIVATE_REFERENCE_ANSWER_SENTINEL";
const databaseJob = (overrides = {}): AiJob =>
  ({
    id: "job",
    userId: "student",
    modelId: "model",
    kind: "PRACTICE_GRADE",
    status: "COMPLETED",
    input: {
      attemptId: "attempt",
      sessionId: "session",
      attemptFingerprint: secret,
      contentFingerprint: secret,
      reference: secret,
    },
    result: {
      summary: secret,
      sessionId: "session",
      attemptId: "attempt",
      counts: { CORRECT: 1, total: 1, answer: secret, feedback: secret },
    },
    events: [
      { type: "tool-input-start", input: secret },
      { type: "sandbox", stdout: secret, images: [{ url: secret }] },
    ],
    cost: { private: secret },
    error: secret,
    attempts: 1,
    createdAt: new Date("2026-11-01T00:00:00Z"),
    startedAt: new Date("2026-11-01T00:00:01Z"),
    finishedAt: new Date("2026-11-01T00:00:02Z"),
    workerId: secret,
    heartbeatAt: new Date(),
    ...overrides,
  }) as unknown as AiJob;
beforeEach(() => {
  vi.clearAllMocks();
  mock.actor.mockResolvedValue({ id: "student", role: "STUDENT" });
  mock.subscribe.mockResolvedValue(vi.fn());
  mock.get.mockResolvedValue(projectAiJob(databaseJob(), "STUDENT"));
  mock.list.mockResolvedValue({ models: [], jobs: [projectAiJob(databaseJob(), "STUDENT")] });
});
it.each(["STUDENT", "TEACHER", "ADMIN"])(
  "projects private practice jobs for %s through a strict allowlist",
  (role) => {
    const result = projectAiJob(databaseJob(), role);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(result).toMatchObject({
      input: null,
      result: null,
      cost: null,
      events: [],
      practice: { sessionId: "session", attemptId: "attempt", counts: { CORRECT: 1, total: 1 } },
    });
    expect(result.practice?.feedbackHref).toBe(
      role === "STUDENT" ? "/learning/practice/session" : "/homework/practice/reviews/attempt",
    );
    expect(aiJobResultLink(result)?.href).toBe(result.practice?.feedbackHref);
    expect(projectAiJob(result)).toEqual(result);
  },
);
it.each(["QUEUED", "RUNNING", "FAILED"])(
  "never exposes partial traces or errors while %s",
  (status) => {
    const result = projectAiJob(databaseJob({ status }), "STUDENT");
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(result.practice?.counts).toEqual({});
    expect(aiJobResultLink(result)).toBeUndefined();
    if (status === "FAILED") expect(result.error).toContain("重新读取");
  },
);
it("keeps unrelated existing job traces and result behavior intact", () => {
  const row = databaseJob({ kind: "IMPORT", error: null });
  const result = projectAiJob(row);
  expect(result.input).toEqual(row.input);
  expect(result.result).toEqual(row.result);
  expect(result.events).toEqual(row.events);
  expect(result).not.toHaveProperty("workerId");
});
it("round-trips safe practice metadata through the actual Protobuf codec", () => {
  const snapshot = { models: [], jobs: [projectAiJob(databaseJob(), "STUDENT")] };
  expect(decodeAiProgress(encodeAiProgress(snapshot))).toEqual(snapshot);
  expect(JSON.stringify(decodeAiProgress(encodeAiProgress(snapshot)))).not.toContain(secret);
});
it.each(["json", "protobuf"])(
  "filters practice snapshots on the actual %s SSE path",
  async (format) => {
    // Also defend the transport boundary when a raw DB row is supplied by a future caller.
    mock.get.mockResolvedValue(databaseJob());
    const response = await aiProgressResponse(
      new Request(`https://paper.test/api/platform/ai/job/events?format=${format}`),
      "student",
      new Date(Date.now() + 60_000),
      { jobId: "job" },
    );
    const body = await response.text();
    const encoded = body.split("data: ")[1].trim();
    const snapshot = format === "protobuf" ? decodeAiProgress(encoded) : JSON.parse(encoded);
    expect(JSON.stringify(snapshot)).not.toContain(secret);
    expect(snapshot.jobs[0].practice.feedbackHref).toBe("/learning/practice/session");
  },
);
it("small-paper waiting returns only the public status/counts/feedback entry", async () => {
  const waiting = createXiaozhiTools("student", "session=private").find(
    (tool) => tool.name === "wait_for_task",
  )!;
  const result = await waiting.execute(
    { id: "job", seconds: 1 },
    {} as ToolExecutionApi,
    BACKGROUND_CONTEXT,
  );
  expect(JSON.stringify(result)).not.toContain(secret);
  expect(JSON.stringify(result)).toContain("/learning/practice/session");
});
