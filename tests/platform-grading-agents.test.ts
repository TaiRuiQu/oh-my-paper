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
vi.mock("@/server/platform/grading", async (original) => ({
  ...(await original<typeof import("@/server/platform/grading")>()),
  gradingContext: mocks.context,
}));
vi.mock("@/server/platform/service", () => ({
  loadState: mocks.loadState,
  executeCommand: mocks.command,
}));
vi.mock("@/server/platform/queries", () => ({ loadInternalState: mocks.loadState }));
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
import { createGradingFeatures } from "@/server/platform/ai/grading";
import { runAiTask } from "@/server/platform/ai/runner";
import { aiInputSchemas } from "@/contracts/platform-ai";
import { groupGradingPages } from "@/server/platform/grading";

const examOutput = () => ({
  grades: ["i1", "i2"].map((itemId) => ({
    itemId,
    score: 10,
    feedback: "答案正确",
    partScores: [],
  })),
  skipped: [],
});

describe("program-assigned grading", () => {
  it("grades immutable online work without exposing answer-replacement tools or saving a replacement submission", async () => {
    context = {
      ...context,
      onlineAssignment: { id: "online-homework" } as NonNullable<typeof context.onlineAssignment>,
    };
    await features.dispose();
    features = await createGradingFeatures({
      userId: "teacher",
      input: { ...input, submissionIds: context.pending.map((submission) => submission.id) },
      jobId: "job",
    });
    await features.run({
      model: vi.fn(),
      agent: async (task) => {
        expect(task.tools.record_answers).toBeUndefined();
        expect(task.instructions).toContain("不可变原始作答");
        await grade(task);
      },
    });
    await features.commit();
    expect(mocks.command.mock.calls.every(([, command]) => command.type === "review.save")).toBe(
      true,
    );
    expect(mocks.command).toHaveBeenCalledTimes(4);
    expect(mocks.assetCreate).not.toHaveBeenCalled();
  });
  it("rejects a roster revision change before committing staged AI grades", async () => {
    await features.run({ model: vi.fn(), agent: grade });
    context = { ...context, assessment: { ...context.assessment, rosterRevision: 2 } };
    await expect(features.commit()).rejects.toThrow("参试名单在 AI 批改期间已更新");
    expect(mocks.command).not.toHaveBeenCalled();
    expect(mocks.assetCreate).not.toHaveBeenCalled();
  });

  it("uses one homework agent per student with isolated evidence and no identity tools", async () => {
    const tasks: AgentTask[] = [];
    await features.run({
      model: vi.fn(),
      agent: async (task) => {
        tasks.push(task);
        expect(task.tools.register_submission).toBeUndefined();
        expect(task.tools.defer_pages).toBeUndefined();
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
      },
    });
    expect(tasks.map((t) => t.scope?.studentId)).toEqual(["s1", "s2"]);
    await features.commit();
    expect(mocks.command).toHaveBeenCalledTimes(4);
    expect(
      mocks.command.mock.calls.every(
        ([, command]) => command.review.round === "FIRST" && command.review.expectedVersion === 0,
      ),
    ).toBe(true);
  });

  it("assigns consecutive ordered homework pages without an identity agent", async () => {
    context.submissions = [];
    context.pending = [];
    await features.dispose();
    features = await createGradingFeatures({
      userId: "teacher",
      input: {
        ...input,
        assetUrls: ["p1", "p2", "p3", "p4"].map(asset),
        pagesPerStudent: 2,
        studentIds: ["s2", "s1"],
      },
      jobId: "job",
    });
    const students: string[] = [];
    await features.run({
      model: vi.fn(),
      agent: async (task) => {
        const data = JSON.parse(task.prompt);
        students.push(data.studentId);
        expect(data.sources).toEqual(
          (data.studentId === "s2" ? ["p1", "p2"] : ["p3", "p4"]).map(asset),
        );
        await call(task, "read_answer");
        await expect(
          call(task, "record_answers", {
            items: [
              {
                studentId: data.studentId,
                itemId: "i1",
                regions: [{ sourceUrl: data.sources[0], x: 0, y: 0, width: 1, height: 1 }],
              },
            ],
          }),
        ).rejects.toThrow(/已查看/);
        await call(task, "python", { assets: data.sources });
        for (const itemId of ["i1", "i2"]) {
          const answer = (await call(task, "record_answers", {
            items: [
              {
                studentId: data.studentId,
                itemId,
                text: "2",
                regions: data.sources.map((sourceUrl: string) => ({
                  sourceUrl,
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
            items: [
              { studentId: data.studentId, itemId, score: 10, feedback: "正确", partScores: [] },
            ],
          });
        }
        await call(task, "finish", { summary: "完成" });
      },
    });
    expect(students).toEqual(["s2", "s1"]);
    await features.commit();
    expect(mocks.command.mock.calls.filter(([, c]) => c.type === "submission.save")).toHaveLength(
      2,
    );
  });

  it("grades all exam answers in one structured call per student without any sandbox", async () => {
    context = fixture("EXAM");
    await features.dispose();
    features = await createGradingFeatures({ userId: "teacher", input, jobId: "job" });
    const agent = vi.fn();
    const model = vi.fn(async (task) => {
      const message = task.messages[0];
      const data = JSON.parse(message.content[0].text);
      expect(data.paper.items).toHaveLength(2);
      expect(data.answers).toHaveLength(2);
      expect(message.content.filter((part: { type: string }) => part.type === "file")).toHaveLength(
        2,
      );
      expect(JSON.stringify(data)).not.toContain(data.studentId === "s1" ? "s2" : "s1");
      return examOutput();
    });
    await features.run({ agent, model });
    expect(model).toHaveBeenCalledTimes(2);
    expect(agent).not.toHaveBeenCalled();
    expect(mocks.sandboxes).toHaveLength(0);
    await features.commit();
    expect(mocks.command).toHaveBeenCalledTimes(4);
  });

  it.each(["missing", "duplicate", "unknown", "over-score", "non-mixed-parts"])(
    "rejects %s exam results before saving",
    async (kind) => {
      context = fixture("EXAM");
      await features.dispose();
      features = await createGradingFeatures({ userId: "teacher", input, jobId: "job" });
      const output = examOutput();
      if (kind === "missing") output.grades.pop();
      if (kind === "duplicate") output.grades[1].itemId = "i1";
      if (kind === "unknown") output.grades[1].itemId = "other";
      if (kind === "over-score") output.grades[0].score = 11;
      if (kind === "non-mixed-parts")
        (output.grades[0].partScores as unknown[]) = [{ partId: "p", score: 1, feedback: "错" }];
      await expect(features.run({ agent: vi.fn(), model: async () => output })).rejects.toThrow();
      await expect(features.commit()).rejects.toThrow(/未完成/);
      expect(mocks.command).not.toHaveBeenCalled();
    },
  );

  it("keeps unreadable exam answers ungraded and persists the reason", async () => {
    context = fixture("EXAM");
    await features.dispose();
    features = await createGradingFeatures({ userId: "teacher", input, jobId: "job" });
    await features.run({
      agent: vi.fn(),
      model: async () => ({
        grades: [],
        skipped: ["i1", "i2"].map((itemId) => ({ itemId, reason: "字迹模糊" })),
      }),
    });
    const output = await features.commit();
    expect(output.result).toMatchObject({
      students: expect.arrayContaining([
        expect.objectContaining({ gradedQuestions: 0, skippedQuestions: 2 }),
      ]),
      skipped: expect.arrayContaining([expect.objectContaining({ reason: "字迹模糊" })]),
    });
    expect(mocks.command).not.toHaveBeenCalled();
  });

  it("uses the same mixed-question weighted score validation in single calls", async () => {
    context = fixture("EXAM");
    const item = context.paper.items[0];
    item.snapshot.type = "MIXED";
    item.snapshot.content.parts = [
      { id: "a", score: 4 },
      { id: "b", score: 6 },
    ] as typeof item.snapshot.content.parts;
    await features.dispose();
    features = await createGradingFeatures({ userId: "teacher", input, jobId: "job" });
    const output = examOutput();
    output.grades[0].score = 8;
    (output.grades[0].partScores as unknown[]) = [
      { partId: "a", score: 5, feedback: "超分" },
      { partId: "b", score: 3, feedback: "部分" },
    ];
    await expect(features.run({ agent: vi.fn(), model: async () => output })).rejects.toThrow(
      /逐小问/,
    );
    expect(mocks.command).not.toHaveBeenCalled();
  });

  it("crops exam cards using the assigned page numbers and preserves ordered source files", async () => {
    context = fixture("EXAM");
    context.submissions = [];
    context.pending = [];
    await features.dispose();
    const urls = [asset("page1"), asset("page2")];
    mocks.scan.mockImplementation(async ({ inputPath, outputDir, page, autoPage }) => {
      expect(autoPage).toBeUndefined();
      expect(await readFile(inputPath)).toBeInstanceOf(Buffer);
      const path = join(mocks.storage.temp, `crop-${page}.png`);
      await writeFile(path, (await mocks.readAsset()).buffer);
      expect(outputDir).toContain("page-");
      return {
        studentNumber: "000001",
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
    features = await createGradingFeatures({
      userId: "teacher",
      input: {
        ...input,
        assetUrls: urls,
        templateId: "template",
        pagesPerStudent: 2,
        studentIds: ["s1"],
      },
      jobId: "job",
    });
    const model = vi.fn(async () => examOutput());
    await features.run({ agent: vi.fn(), model });
    expect(model).toHaveBeenCalledOnce();
    await features.commit();
    expect(mocks.command).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: "submission.save",
        submission: expect.objectContaining({
          kind: "CARD",
          templateId: "template",
          sourceFiles: urls,
        }),
      }),
      expect.anything(),
    );
  });

  it("does not commit a failed agent and disposes its sandbox", async () => {
    await expect(
      features.run({
        model: vi.fn(),
        agent: async () => {
          throw new Error("provider failed");
        },
      }),
    ).rejects.toThrow("provider failed");
    await expect(features.commit()).rejects.toThrow(/未完成/);
    expect(mocks.command).not.toHaveBeenCalled();
    expect(mocks.sandboxes).toContainEqual(expect.objectContaining({ disposed: true }));
  });

  it.each(["page", "student"])(
    "rejects an exam %s mismatch without writing scores",
    async (kind) => {
      context = fixture("EXAM");
      context.pending = [];
      context.submissions = [];
      await features.dispose();
      mocks.scan.mockResolvedValue({
        studentNumber: kind === "student" ? "000002" : "000001",
        alignment: { page: kind === "page" ? 2 : 1 },
        answers: [],
        needsReview: false,
      });
      features = await createGradingFeatures({
        userId: "teacher",
        input: {
          ...input,
          templateId: "template",
          assetUrls: [asset("p1"), asset("p2")],
          pagesPerStudent: 2,
          studentIds: ["s1"],
        },
        jobId: "job",
      });
      const model = vi.fn();
      await expect(features.run({ agent: vi.fn(), model })).rejects.toThrow(/顺序/);
      expect(model).not.toHaveBeenCalled();
      await expect(features.commit()).rejects.toThrow(/未完成/);
      expect(mocks.command).not.toHaveBeenCalled();
    },
  );

  it("does not issue another model request to repair invalid exam JSON", async () => {
    context = fixture("EXAM");
    const close = vi.fn();
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: "text", text: "invalid json" }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 10, text: 10, reasoning: undefined },
        },
        warnings: [],
      }),
    });
    mocks.model.mockResolvedValue({
      createSession: () => ({ model, close }),
      reasoning: "xhigh",
      identity: { providerId: "provider", apiType: "openai_chat" },
      maxOutputTokens: 1000,
      timeoutMs: 10000,
      maxConcurrency: 1,
    });
    await expect(
      runAiTask({ userId: "teacher", kind: "GRADE", input, jobId: "job" }),
    ).rejects.toThrow();
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(close).toHaveBeenCalledOnce();
    expect(mocks.costAdd).toHaveBeenCalledOnce();
    expect(mocks.command).not.toHaveBeenCalled();
  });

  it("sends one real SDK request per exam submission and accounts for every call", async () => {
    context = fixture("EXAM");
    const close = vi.fn();
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: "text", text: JSON.stringify(examOutput()) }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 10, text: 10, reasoning: undefined },
        },
        warnings: [],
      }),
    });
    mocks.model.mockResolvedValue({
      createSession: () => ({ model, close }),
      reasoning: "xhigh",
      identity: { providerId: "provider", apiType: "openai_chat" },
      maxOutputTokens: 1000,
      timeoutMs: 10000,
      maxConcurrency: 1,
    });
    await runAiTask({ userId: "teacher", kind: "GRADE", input, jobId: "job" });
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(close).toHaveBeenCalledTimes(2);
    expect(model.doGenerateCalls.every((call) => call.reasoning === "xhigh")).toBe(true);
    expect(model.doGenerateCalls.every((call) => !call.tools?.length)).toBe(true);
    expect(mocks.costAdd).toHaveBeenCalledTimes(2);
  });
});

describe("ordered page contract", () => {
  it("splits three pages per student without sorting or identifying pages", () => {
    const request = aiInputSchemas.GRADE.parse({
      ...input,
      assetUrls: ["a", "b", "c", "d", "e", "f"].map(asset),
      pagesPerStudent: 3,
      studentIds: ["s2", "s1"],
    });
    expect(groupGradingPages(request, 3)).toEqual([
      { studentId: "s2", sourceFiles: ["a", "b", "c"].map(asset) },
      { studentId: "s1", sourceFiles: ["d", "e", "f"].map(asset) },
    ]);
    expect(() =>
      groupGradingPages({ ...request, assetUrls: request.assetUrls.slice(1) }, 3),
    ).toThrow(/扫描页数/);
    expect(() => groupGradingPages(request, 2)).toThrow(/模板一致/);
  });
  it("rejects missing or duplicated student assignments", () => {
    expect(aiInputSchemas.GRADE.safeParse({ ...input, assetUrls: [asset("p")] }).success).toBe(
      false,
    );
    expect(
      aiInputSchemas.GRADE.safeParse({
        ...input,
        assetUrls: [asset("p")],
        studentIds: ["s1", "s1"],
      }).success,
    ).toBe(false);
  });
});

const asset = (id: string) => `/api/platform/assets/${id}`;
const input = {
  assessmentId: "assessment",
  rosterRevision: 1,
  classroomId: "class",
  paperId: "paper",
  assetUrls: [] as string[],
};
let features: Awaited<ReturnType<typeof createGradingFeatures>>;
let context: Awaited<ReturnType<typeof import("@/server/platform/grading").gradingContext>>;
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
    assessment: {
      id: "assessment",
      kind,
      rosterRevision: 1,
      rosterStatus: "CONFIRMED",
      participants: students.map((student) => ({
        id: `p-${student.id}`,
        studentId: student.id,
        name: student.name,
        studentNumber: student.studentNumber,
        classroomId: "class",
        classroomName: "一班",
        stage: "高中",
        cohort: "2027届",
        subjects: [{ paperId: "paper", status: "REQUIRED", reason: "" }],
      })),
    },
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
  mocks.context.mockImplementation(async (_db, _state, request) => ({
    ...context,
    groups: request.assetUrls.length
      ? request.studentIds.map((studentId: string, i: number) => ({
          studentId,
          sourceFiles: request.assetUrls.slice(
            i * request.pagesPerStudent,
            (i + 1) * request.pagesPerStudent,
          ),
        }))
      : [],
  }));
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
    kind: "GRADE",
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
  features = await createGradingFeatures({ userId: "teacher", input, jobId: "job" });
});
afterEach(async () => {
  await features.dispose();
  await rm(mocks.storage.temp, { force: true, recursive: true });
});
