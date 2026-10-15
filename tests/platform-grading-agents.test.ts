import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { MockLanguageModelV4 } from "ai/test";
import type { PlatformState } from "@/contracts/platform";
import type { AgentTask } from "@/server/platform/ai/agent-task";
const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  loadState: vi.fn(),
  command: vi.fn(),
  scan: vi.fn(),
  readAsset: vi.fn(),
  model: vi.fn(),
  costAdd: vi.fn(),
  transaction: vi.fn(),
  job: vi.fn(),
  update: vi.fn(),
  assetCreate: vi.fn(),
  storage: { temp: "", storage: "" },
  sandboxes: [] as unknown[],
}));
vi.mock("@/server/platform/batch-grading", () => ({ batchGradingContext: mocks.context }));
vi.mock("@/server/platform/service", () => ({
  loadState: mocks.loadState,
  executeCommand: mocks.command,
}));
vi.mock("@/server/platform/scan", () => ({ processCardScan: mocks.scan }));
vi.mock("@/server/config/env", () => ({ getStoragePaths: () => mocks.storage }));
vi.mock("@/server/platform/assets", () => ({
  readOwnedAsset: mocks.readAsset,
  accessibleAsset: mocks.readAsset,
  assetId: (url: string) => url.split("/").at(-1),
}));
vi.mock("@/server/platform/ai/model", () => ({ loadAiModel: mocks.model }));
vi.mock("@/server/platform/ai/cost", () => ({
  createTaskCostTracker: async () => ({
    add: mocks.costAdd,
    snapshot: () => ({ steps: mocks.costAdd.mock.calls.length }),
  }),
}));
vi.mock("@/server/db/client", () => ({ getDb: () => ({ $transaction: mocks.transaction }) }));
vi.mock("@/server/platform/ai/sandbox-tools", async () => {
  const { tool } = await import("ai");
  const { z } = await import("zod");
  return {
    createTaskSandbox: (options: {
      allowedAssets: Set<string>;
      ensureOpen: () => void;
      onImages: (images: [], sources: string[]) => Promise<void>;
      readAsset: (url: string) => Promise<Buffer>;
    }) => {
      const sandbox = { options, disposed: false };
      mocks.sandboxes.push(sandbox);
      return {
        tools: {
          shell: tool({ inputSchema: z.object({}), execute: async () => ({ exitCode: 0 }) }),
          python: tool({
            inputSchema: z.object({ assets: z.array(z.string()) }),
            execute: async ({ assets }) => {
              options.ensureOpen();
              if (assets.some((url) => !options.allowedAssets.has(url)))
                throw new Error("图像不属于当前任务");
              for (const url of assets) await options.readAsset(url);
              await options.onImages([], assets);
              return { exitCode: 0 };
            },
          }),
        },
        dispose: async () => {
          sandbox.disposed = true;
        },
      };
    },
  };
});
import { createBatchGradingFeatures } from "@/server/platform/ai/batch-grading";
import { runAiTask } from "@/server/platform/ai/runner";

const asset = (id: string) => `/api/platform/assets/${id}`;
const input = {
  assessmentId: "assessment",
  classroomId: "class",
  paperId: "paper",
  assetUrls: [] as string[],
};
let features: Awaited<ReturnType<typeof createBatchGradingFeatures>>;
let context: Awaited<
  ReturnType<typeof import("@/server/platform/batch-grading").batchGradingContext>
>;
function fixture(kind: "EXAM" | "HOMEWORK") {
  const students = ["s1", "s2"].map((id, i) => ({
    id,
    name: id,
    studentNumber: `00000${i + 1}`,
    classroomId: "class",
    userId: null,
  }));
  const items = ["i1", "i2"].map((id) => ({
    id,
    questionId: id,
    position: 0,
    section: "",
    score: 10,
    snapshot: {
      id,
      type: "BLANK",
      content: {
        stem: id,
        answers: ["2"],
        rubric: "正确得10分",
        explanation: "加法",
        options: [],
        parts: [],
        images: [],
      },
    },
  }));
  const submissions = students.map((s) => ({
    id: `sub-${s.id}`,
    studentId: s.id,
    assessmentId: "assessment",
    paperId: "paper",
    kind: "WORKBOOK",
    templateId: null,
    sourceFiles: [asset(`page-${s.id}`)],
    answers: items.map((item) => ({
      itemId: item.id,
      text: "2",
      images: [asset(`${s.id}-${item.id}`)],
    })),
    alignment: {},
  }));
  return {
    classroom: { id: "class", students },
    paper: { id: "paper", kind, items },
    assessment: { id: "assessment", kind },
    config: { gradingMode: "SINGLE" },
    submissions,
    pending: submissions,
    template: { id: "template", paperId: "paper", layout: { pageCount: 2 } },
  } as unknown as typeof context;
}
async function call(task: Pick<AgentTask, "tools">, name: string, args: unknown = {}) {
  const output = await task.tools[name].execute!(args, {
    toolCallId: "call",
    messages: [],
    context: undefined,
  });
  if (output && typeof output === "object" && "results" in output) {
    const entries = (
      output as { results: { success: boolean; output?: unknown; error?: { message: string } }[] }
    ).results;
    for (const entry of entries) if (!entry.success) throw new Error(entry.error?.message);
    return entries[0].output;
  }
  return output;
}
async function grade(task: AgentTask) {
  const data = (await call(task, "read_answer")) as {
    paper: typeof context.paper;
    answers: (typeof context.pending)[number]["answers"];
  };
  await call(task, "python", { assets: data.answers.flatMap((a) => a.images) });
  await call(task, "propose_grade", {
    items: data.paper.items.map((item) => ({
      studentId: task.scope!.studentId,
      itemId: item.id,
      score: 10,
      feedback: "正确",
      partScores: [],
    })),
  });
  await call(task, "finish", { summary: "完成" });
}
beforeEach(async () => {
  vi.clearAllMocks();
  mocks.sandboxes.length = 0;
  mocks.storage.temp = await mkdtemp(join(tmpdir(), "omp-agents-"));
  mocks.storage.storage = mocks.storage.temp;
  context = fixture("HOMEWORK");
  mocks.context.mockImplementation(async () => context);
  mocks.loadState.mockResolvedValue({ reviews: [] } as unknown as PlatformState);
  const buffer = await sharp({
    create: { width: 100, height: 100, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  mocks.readAsset.mockResolvedValue({ buffer });
  mocks.command.mockResolvedValue({ id: "saved" });
  mocks.job.mockResolvedValue({
    id: "job",
    kind: "BATCH_GRADE",
    status: "RUNNING",
    userId: "teacher",
  });
  mocks.transaction.mockImplementation(async (work) =>
    work({
      $queryRaw: vi.fn(),
      aiJob: { findUnique: mocks.job, update: mocks.update },
      platformAsset: { create: mocks.assetCreate },
    }),
  );
  features = await createBatchGradingFeatures({ userId: "teacher", input, jobId: "job" });
});
afterEach(async () => {
  await features.dispose();
  await rm(mocks.storage.temp, { force: true, recursive: true });
});

describe("independent grading agents", () => {
  it("uses one scoped homework agent per student and prevents cross-student tools/assets", async () => {
    const tasks: AgentTask[] = [];
    await features.runAgents(async (task) => {
      tasks.push(task);
      expect(task.scope?.itemId).toBeUndefined();
      const other = task.scope!.studentId === "s1" ? "s2" : "s1";
      expect(task.prompt).not.toContain(`sub-${other}`);
      await expect(call(task, "python", { assets: [asset(`${other}-i1`)] })).rejects.toThrow(
        /不属于/,
      );
      await expect(
        call(task, "propose_grade", {
          items: [{ studentId: other, itemId: "i1", score: 1, feedback: "错", partScores: [] }],
        }),
      ).rejects.toThrow(/其他学生/);
      await grade(task);
    });
    expect(tasks.map((t) => t.scope)).toEqual([
      { stage: "grade", studentId: "s1" },
      { stage: "grade", studentId: "s2" },
    ]);
    await features.commit();
    expect(mocks.command).toHaveBeenCalledTimes(4);
  });
  it("creates one exam agent per student/question with isolated evidence and no recropping tool", async () => {
    context = fixture("EXAM");
    await features.dispose();
    features = await createBatchGradingFeatures({ userId: "teacher", input, jobId: "job" });
    const scopes: AgentTask["scope"][] = [];
    await features.runAgents(async (task) => {
      scopes.push(task.scope);
      const other = task.scope!.itemId === "i1" ? "i2" : "i1";
      expect(task.tools.record_answers).toBeUndefined();
      await call(task, "read_answer");
      await expect(
        call(task, "python", { assets: [asset(`${task.scope!.studentId}-${other}`)] }),
      ).rejects.toThrow(/不属于/);
      await expect(
        call(task, "propose_grade", {
          items: [
            {
              studentId: task.scope!.studentId,
              itemId: other,
              score: 1,
              feedback: "错",
              partScores: [],
            },
          ],
        }),
      ).rejects.toThrow(/评阅范围/);
      await expect(
        call(task, "propose_grade", {
          items: [
            {
              studentId: task.scope!.studentId,
              itemId: task.scope!.itemId,
              score: 1,
              feedback: "错",
              partScores: [],
            },
          ],
        }),
      ).rejects.toThrow(/查看/);
      await grade(task);
    });
    expect(scopes).toEqual(
      ["s1", "s2"].flatMap((studentId) =>
        ["i1", "i2"].map((itemId) => ({ stage: "grade", studentId, itemId })),
      ),
    );
    expect(features.isComplete()).toBe(true);
  });
  it("runs a separate identity agent before per-student homework grading and merges continuation pages", async () => {
    context.submissions = [];
    context.pending = [];
    await features.dispose();
    features = await createBatchGradingFeatures({
      userId: "teacher",
      input: { ...input, assetUrls: [asset("p1"), asset("p2"), asset("unknown")] },
      jobId: "job",
    });
    const stages: string[] = [];
    await features.runAgents(async (task) => {
      stages.push(task.scope!.stage);
      if (task.scope!.stage === "identify") {
        expect(task.tools.propose_grade).toBeUndefined();
        await call(task, "python", { assets: [asset("p1"), asset("p2"), asset("unknown")] });
        await call(task, "register_submission", {
          items: [{ sourceUrls: [asset("p1"), asset("p2")], studentNumber: "1" }],
        });
        await call(task, "defer_pages", {
          items: [{ sourceUrl: asset("unknown"), reason: "无姓名考号" }],
        });
      } else {
        await call(task, "read_answer");
        // Identity-agent inspections do not count as this grading agent's evidence.
        await expect(
          call(task, "record_answers", {
            items: [
              {
                studentId: "s1",
                itemId: "i1",
                text: "2",
                regions: [{ sourceUrl: asset("p1"), x: 0, y: 0, width: 1, height: 1 }],
              },
            ],
          }),
        ).rejects.toThrow(/已查看/);
        await call(task, "python", { assets: [asset("p1"), asset("p2")] });
        for (const itemId of ["i1", "i2"]) {
          const answer = (await call(task, "record_answers", {
            items: [
              {
                studentId: "s1",
                itemId,
                text: "2",
                regions: ["p1", "p2"].map((id) => ({
                  sourceUrl: asset(id),
                  x: 0,
                  y: 0,
                  width: 1,
                  height: 1,
                })),
              },
            ],
          })) as { images: string[] };
          await call(task, "python", { assets: answer.images });
          await call(task, "propose_grade", {
            items: [{ studentId: "s1", itemId, score: 10, feedback: "正确", partScores: [] }],
          });
        }
      }
      await call(task, "finish", { summary: "完成" });
    });
    expect(stages).toEqual(["identify", "grade"]);
    const result = await features.commit();
    expect(result.result).toMatchObject({
      students: [{ studentId: "s1", gradedQuestions: 2 }],
      pendingPages: [{ sourceUrl: asset("unknown") }],
    });
  });
  it("scans unordered exam cards using the template, merges pages and preserves unknown/duplicate pages", async () => {
    context = fixture("EXAM");
    context.submissions = [];
    context.pending = [];
    await features.dispose();
    const urls = [asset("p2"), asset("p1"), asset("unknown"), asset("duplicate")];
    mocks.scan.mockImplementation(async ({ inputPath, outputDir, autoPage }) => {
      expect(autoPage).toBe(true);
      expect(await readFile(inputPath)).toBeInstanceOf(Buffer);
      const index = Number(/input-(\d+)/.exec(inputPath)![1]);
      const page = index === 0 ? 2 : 1;
      const path = join(mocks.storage.temp, `crop-${index}.png`);
      await writeFile(path, (await mocks.readAsset()).buffer);
      expect(outputDir).toContain("page-");
      return {
        studentNumber: index === 2 ? null : "000001",
        alignment: { page, corrected: true },
        needsReview: false,
        answers: [
          {
            itemId: `i${page}`,
            text: "2",
            images: [path],
            box: { page, x: 0, y: 0, width: 1, height: 1 },
          },
        ],
      };
    });
    features = await createBatchGradingFeatures({
      userId: "teacher",
      input: { ...input, templateId: "template", assetUrls: urls },
      jobId: "job",
    });
    const scopes: AgentTask["scope"][] = [];
    await features.runAgents(async (task) => {
      scopes.push(task.scope);
      await grade(task);
    });
    expect(scopes).toHaveLength(2);
    const output = await features.commit();
    expect(output.result).toMatchObject({
      templateId: "template",
      students: [{ studentId: "s1", gradedQuestions: 2 }],
      pendingPages: [{ sourceUrl: urls[2] }, { sourceUrl: urls[3] }],
    });
    expect(mocks.command).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: "submission.save",
        submission: expect.objectContaining({
          kind: "CARD",
          templateId: "template",
          sourceFiles: [urls[1], urls[0]],
        }),
      }),
      expect.anything(),
    );
  });
  it("does not commit incomplete or failed agent runs and disposes their sandboxes", async () => {
    await expect(
      features.runAgents(async () => {
        throw new Error("provider failed");
      }),
    ).rejects.toThrow("provider failed");
    await expect(features.commit()).rejects.toThrow(/未完成/);
    expect(mocks.command).not.toHaveBeenCalled();
    expect(mocks.sandboxes).toContainEqual(expect.objectContaining({ disposed: true }));
  });
  it("constructs a fresh SDK conversation for each exam question and accumulates all model usage", async () => {
    context = fixture("EXAM");
    // Text-only recorded answers let this SDK-level test focus on conversation separation.
    for (const sub of context.pending) for (const answer of sub.answers) answer.images = [];
    const model = new MockLanguageModelV4({
      doGenerate: async ({ prompt }) => {
        const first = prompt.find((m) => m.role === "user")!;
        const data = JSON.parse((first.content as { type: string; text: string }[])[0].text);
        const steps = prompt.filter((m) => m.role === "assistant").length;
        const sequence = [
          { toolName: "read_answer", input: {} },
          {
            toolName: "propose_grade",
            input: {
              items: [
                {
                  studentId: data.studentId,
                  itemId: data.paper.items[0].id,
                  score: 10,
                  feedback: "正确",
                  partScores: [],
                },
              ],
            },
          },
          { toolName: "finish", input: { summary: "完成" } },
        ];
        const call = sequence[steps];
        return {
          content: [
            {
              type: "tool-call",
              toolCallId: `call-${steps}`,
              toolName: call.toolName,
              input: JSON.stringify(call.input),
            },
          ],
          finishReason: { unified: "tool-calls", raw: undefined },
          usage: {
            inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 10, text: 10, reasoning: undefined },
          },
          warnings: [],
        };
      },
    });
    mocks.model.mockResolvedValue({
      model,
      identity: { providerId: "provider", apiType: "openai_chat" },
      maxOutputTokens: 1000,
      timeoutMs: 10000,
      maxConcurrency: 1,
    });
    const events: unknown[] = [];
    await runAiTask({
      userId: "teacher",
      kind: "BATCH_GRADE",
      input,
      jobId: "job",
      onEvent: async (event) => {
        events.push(event);
      },
    });
    expect(model.doGenerateCalls).toHaveLength(12);
    expect(model.doGenerateCalls.filter((c) => c.prompt.length === 2)).toHaveLength(4);
    expect(mocks.costAdd).toHaveBeenCalledTimes(12);
    expect(
      events.filter(
        (e) =>
          (e as { type: string; status: string }).type === "agent" &&
          (e as { status: string }).status === "started",
      ),
    ).toHaveLength(4);
  });
});
