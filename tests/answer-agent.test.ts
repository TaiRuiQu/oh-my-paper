import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToolSet } from "ai";
import type { Exam } from "@/contracts/exams";
import type { ProviderSnapshot } from "@/contracts/ai-providers";
import type { AgentResult } from "@/contracts/exam-agents";
import { createAnswerResultTools, questionMaximum } from "@/server/exams/answer-tools";
import { runAnswerAgent } from "@/server/exams/answer-agent";
import { createProviderExamModel } from "@/server/ai/providers";
import { activityWriter, readActivity } from "@/server/exams/activity";

const ids = ["10000000-0000-4000-8000-000000000001", "10000000-0000-4000-8000-000000000002"];
const exam: Exam = {
  id: "10000000-0000-4000-8000-000000000010",
  name: "数学",
  totalScore: 10,
  sections: [
    {
      id: "10000000-0000-4000-8000-000000000011",
      number: "一",
      title: "计算",
      description: "写出步骤",
      score: 10,
      questions: ids.map((id, index) => ({
        id,
        number: index + 1,
        description: "计算 1+1",
        score: 5,
        materials: [],
        subquestions: [],
      })),
    },
  ],
};
const answers = ids.map((questionId) => ({
  questionId,
  solution: "2",
  gradingCriteria: "正确得5分",
}));
const grades = ids.map((questionId) => ({
  questionId,
  answer: "2",
  correct: true,
  score: 5,
  feedback: "计算正确",
}));
const context = { toolCallId: "test", messages: [], context: {} };
const execute = async (tools: ToolSet, name: string, input: unknown) =>
  tools[name].execute!(input, context);
const roots: string[] = [];
async function root() {
  const directory = await mkdtemp(join(tmpdir(), "answer-agent-"));
  roots.push(directory);
  return directory;
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("answer and grading incremental tools", () => {
  it("serializes concurrent saves and submission, replaces corrections and preserves order", async () => {
    const progress = vi.fn(async () => {});
    const state = createAnswerResultTools({ exam, kind: "ANSWER", onProgress: progress });
    await expect(execute(state.tools, "submit_answers", {})).rejects.toMatchObject({
      code: "AGENT_MISSING_QUESTIONS",
    });
    await Promise.all([
      execute(state.tools, "append_answers", { questions: [answers[1]] }),
      execute(state.tools, "append_answers", { questions: [answers[0]] }),
    ]);
    await execute(state.tools, "append_answers", {
      questions: [{ ...answers[0], solution: "修正答案" }],
    });
    expect(state.result().questions.map((item) => item.questionId)).toEqual(ids);
    expect(state.result().questions[0]).toMatchObject({ solution: "修正答案" });
    await execute(state.tools, "submit_answers", {});
    expect(state.isComplete()).toBe(true);
    await expect(
      execute(state.tools, "append_answers", { questions: [answers[0]] }),
    ).rejects.toMatchObject({ code: "AGENT_ALREADY_COMPLETE" });
  });
  it("requires one question per append call for answers and grades", async () => {
    for (const kind of ["ANSWER", "GRADING"] as const) {
      const state = createAnswerResultTools({ exam, kind, onProgress: async () => {} });
      await expect(
        execute(state.tools, kind === "ANSWER" ? "append_answers" : "append_grades", {
          questions: kind === "ANSWER" ? answers : grades,
        }),
      ).rejects.toMatchObject({ code: "ANSWER_SINGLE_QUESTION" });
      expect(state.result().questions).toHaveLength(0);
    }
  });
  it("retains the previous saved result after persistence fails and resumes from drafts", async () => {
    const progress = vi
      .fn()
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValue(undefined);
    const state = createAnswerResultTools({
      exam,
      kind: "ANSWER",
      initial: { questions: [answers[0]] },
      onProgress: progress,
    });
    await expect(
      execute(state.tools, "append_answers", { questions: [answers[1]] }),
    ).rejects.toThrow("database unavailable");
    expect(state.result()).toEqual({ questions: [answers[0]] });
    await execute(state.tools, "append_answers", { questions: [answers[1]] });
    await execute(state.tools, "submit_answers", {});
    expect(state.result().questions).toEqual(answers);
  });
  it("rejects foreign questions, duplicate batches, excessive scores and scored uncertainty", async () => {
    const progress = vi.fn(async () => {});
    const state = createAnswerResultTools({ exam, kind: "GRADING", onProgress: progress });
    for (const [item, code] of [
      [{ ...grades[0], questionId: exam.id }, "ANSWER_QUESTION_INVALID"],
      [{ ...grades[0], score: 6 }, "GRADE_SCORE_INVALID"],
      [{ ...grades[0], correct: null }, "GRADE_UNCERTAIN"],
    ] as const)
      await expect(
        execute(state.tools, "append_grades", { questions: [item] }),
      ).rejects.toMatchObject({ code });
    await expect(
      execute(state.tools, "append_grades", { questions: [grades[0], grades[0]] }),
    ).rejects.toMatchObject({ code: "ANSWER_DUPLICATE" });
    expect(progress).not.toHaveBeenCalled();
    await execute(state.tools, "append_grades", {
      questions: [{ ...grades[0], answer: "看不清", correct: null, score: null }],
    });
    await expect(execute(state.tools, "submit_grading", {})).rejects.toMatchObject({
      code: "AGENT_MISSING_QUESTIONS",
    });
    await execute(state.tools, "append_grades", {
      questions: [{ ...grades[1], answer: "", correct: false, score: 0 }],
    });
    await execute(state.tools, "submit_grading", {});
    expect(state.result().questions).toHaveLength(2);
  });
  it("derives maximum only from explicitly scored subquestions and leaves unknown maxima unscored", async () => {
    const question = {
      ...exam.sections[0].questions[0],
      score: null,
      subquestions: [
        { number: "(1)", description: "求值", score: 2, materials: [] },
        { number: "(2)", description: "证明", score: 3, materials: [] },
      ],
    };
    expect(questionMaximum(question)).toBe(5);
    question.subquestions[1].score = null as unknown as number;
    expect(questionMaximum(question)).toBeNull();
    const unknown = structuredClone(exam);
    unknown.sections[0].questions[0] = question;
    const state = createAnswerResultTools({
      exam: unknown,
      kind: "GRADING",
      onProgress: async () => {},
    });
    await expect(
      execute(state.tools, "append_grades", { questions: [grades[0]] }),
    ).rejects.toMatchObject({ code: "GRADE_SCORE_INVALID" });
    await execute(state.tools, "append_grades", { questions: [{ ...grades[0], score: null }] });
  });
});
const config: ProviderSnapshot = {
  providerId: "10000000-0000-4000-8000-000000000050",
  name: "test",
  apiType: "openai_chat",
  baseURL: "https://example.test/v1",
  encryptedApiKey: "encrypted",
  model: "agent-test",
  reasoningEffort: "default",
  structuredOutputs: false,
  maxOutputTokens: 16000,
  timeoutSeconds: 60,
  maxConcurrency: 3,
};
function scriptedModel(
  rounds: { name: string; args: unknown }[][],
  inspect?: (body: string, round: number) => void,
) {
  let count = 0;
  const fetch: typeof globalThis.fetch = async (_input, init) => {
    inspect?.(String(init?.body), count);
    const calls = rounds[count++];
    return Response.json({
      id: `call-${count}`,
      object: "chat.completion",
      created: 1,
      model: config.model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: calls ? null : "stopped",
            ...(calls
              ? {
                  tool_calls: calls.map((call, index) => ({
                    id: `tool-${count}-${index}`,
                    type: "function",
                    function: { name: call.name, arguments: JSON.stringify(call.args) },
                  })),
                }
              : {}),
          },
          finish_reason: calls ? "tool_calls" : "stop",
        },
      ],
    });
  };
  return createProviderExamModel(config, "test-key", fetch);
}
describe("answer and grading SDK agents", () => {
  it("reads uploaded answer pages with an extraction prompt and saves each matched question", async () => {
    const directory = await root(),
      input = join(directory, "key.png");
    await sharp({ create: { width: 100, height: 200, channels: 3, background: "white" } })
      .png()
      .toFile(input);
    const progress: AgentResult[] = [];
    const viewPage = {
      name: "python",
      args: {
        code: 'import shutil\nshutil.copy("pages/001.jpg", "output/view.png")',
        images: ["view.png"],
        replacePages: [],
      },
    };
    const model = scriptedModel(
      [
        [viewPage],
        [{ name: "read_question", args: { questionId: ids[0] } }],
        [{ name: "append_answers", args: { questions: [answers[0]] } }],
        [{ name: "append_answers", args: { questions: [answers[1]] } }],
        [{ name: "submit_answers", args: {} }],
      ],
      (body, round) => {
        const request = JSON.parse(body);
        if (round === 0) {
          expect(request.messages[0].content).toContain("Extract the supplied standard answer key");
          expect(request.messages[0].content).toContain("Do not solve questions yourself");
          expect(request.messages[0].content).not.toMatch(/[\u3400-\u9fff]/);
          expect(
            request.tools.map((item: { function: { name: string } }) => item.function.name),
          ).toContain("python");
        }
        if (round === 1) expect(body).toContain("data:image/jpeg;base64,");
      },
    );
    const result = await runAnswerAgent({
      kind: "ANSWER",
      exam,
      sourceDirectory: directory,
      files: [input],
      outputDir: join(directory, "run"),
      model,
      onProgress: async (draft) => {
        progress.push(draft);
      },
    });
    expect(progress[0].questions).toEqual([answers[0]]);
    expect(result.questions).toEqual(answers);
  });
  it("autonomously reads material crops, saves early answers and submits without resending", async () => {
    const directory = await root();
    await mkdir(join(directory, "materials"));
    const withImages = structuredClone(exam);
    withImages.sections[0].questions[0].materials = [{ page: 1, x: 0, y: 0, width: 1, height: 1 }];
    await sharp({ create: { width: 40, height: 80, channels: 3, background: "red" } })
      .jpeg()
      .toFile(join(directory, "materials/1-1.jpg"));
    const progress: AgentResult[] = [],
      outputDir = join(directory, "run");
    const model = scriptedModel(
      [
        [{ name: "list_questions", args: {} }],
        [{ name: "read_question", args: { questionId: ids[0] } }],
        [{ name: "append_answers", args: { questions: [answers[0]] } }],
        [{ name: "read_question", args: { questionId: ids[1] } }],
        [{ name: "append_answers", args: { questions: [answers[1]] } }],
        [{ name: "submit_answers", args: {} }],
      ],
      (body, round) => {
        if (round === 0) {
          const request = JSON.parse(body);
          const names = request.tools.map(
            (item: { function: { name: string } }) => item.function.name,
          );
          expect(names).toContain("python");
          expect(request.messages[0].content).not.toMatch(/[\u3400-\u9fff]/);
          expect(request.messages[0].content).toContain("Save each completed question promptly");
        }
        if (round === 2) expect(body).toContain("data:image/jpeg;base64,");
      },
    );
    const result = await runAnswerAgent({
      kind: "ANSWER",
      exam: withImages,
      sourceDirectory: directory,
      files: [],
      outputDir,
      model,
      onEvent: activityWriter(outputDir),
      onProgress: async (draft) => {
        progress.push(draft);
      },
    });
    expect(progress[0]).toEqual({ questions: [answers[0]] });
    expect(result.questions).toEqual(answers);
    expect(JSON.parse(await readFile(join(outputDir, "result.json"), "utf8"))).toEqual(result);
    const events = await readActivity(outputDir);
    expect(
      events.filter((event) => event.type === "tool_call").map((event) => event.tool),
    ).toContain("submit_answers");
    const imageResult = events.find(
      (event) => event.type === "tool_result" && event.tool === "read_question",
    )?.data as { images: string[] };
    expect(imageResult.images[0]).toMatch(/^agent\//);
    expect((await readFile(join(outputDir, imageResult.images[0]))).length).toBeGreaterThan(0);
  });
  it("uses student page images and reference criteria to grade, repairs invalid scores and accounts for unanswered questions", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const directory = await root(),
      input = join(directory, "student.png"),
      outputDir = join(directory, "run");
    await sharp({ create: { width: 100, height: 200, channels: 3, background: "white" } })
      .png()
      .toFile(input);
    const viewPage = {
      name: "python",
      args: {
        code: 'import shutil\nshutil.copy("pages/001.jpg", "output/view.png")',
        images: ["view.png"],
        replacePages: [],
      },
    };
    const model = scriptedModel(
      [
        [viewPage],
        [{ name: "read_question", args: { questionId: ids[0] } }],
        [{ name: "append_grades", args: { questions: [{ ...grades[0], score: 9 }] } }],
        [{ name: "append_grades", args: { questions: [grades[0]] } }],
        [
          {
            name: "append_grades",
            args: {
              questions: [
                { ...grades[1], answer: "", correct: false, score: 0, feedback: "未作答，0分" },
              ],
            },
          },
        ],
        [{ name: "submit_grading", args: {} }],
      ],
      (body, round) => {
        if (round === 0) {
          const request = JSON.parse(body);
          const names = request.tools.map(
            (item: { function: { name: string } }) => item.function.name,
          );
          expect(names).toContain("python");
          expect(names).toContain("shell");
          expect(request.messages[0].content).not.toMatch(/[\u3400-\u9fff]/);
        }
        if (round === 1) expect(body).toContain("data:image/jpeg;base64,");
        if (round === 2) expect(body).toContain("正确得5分");
      },
    );
    const result = await runAnswerAgent({
      kind: "GRADING",
      exam,
      reference: answers,
      sourceDirectory: directory,
      files: [input],
      outputDir,
      model,
      onEvent: activityWriter(outputDir),
      onProgress: async () => {},
    });
    expect(result.questions).toHaveLength(2);
    expect(result.questions[1]).toMatchObject({ answer: "", score: 0 });
    expect(
      (await readActivity(outputDir)).some(
        (event) => event.type === "tool_error" && event.tool === "append_grades",
      ),
    ).toBe(true);
  });
  it("keeps a saved draft when the model stops early and can resume it in a new run", async () => {
    const directory = await root(),
      outputDir = join(directory, "failed");
    const model = scriptedModel([[{ name: "append_answers", args: { questions: [answers[0]] } }]]);
    await expect(
      runAnswerAgent({
        kind: "ANSWER",
        exam,
        sourceDirectory: directory,
        files: [],
        outputDir,
        model,
        onProgress: async () => {},
      }),
    ).rejects.toThrow();
    const draft = JSON.parse(await readFile(join(outputDir, "draft.json"), "utf8"));
    expect(draft).toEqual({ questions: [answers[0]] });
    const resumed = await runAnswerAgent({
      kind: "ANSWER",
      exam,
      sourceDirectory: directory,
      files: [],
      outputDir: join(directory, "resumed"),
      initial: draft,
      model: scriptedModel([
        [{ name: "append_answers", args: { questions: [answers[1]] } }],
        [{ name: "submit_answers", args: {} }],
      ]),
      onProgress: async () => {},
    });
    expect(resumed.questions).toEqual(answers);
  });
});
