import { mkdtemp, mkdir, readFile, appendFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { tool } from "ai";
import { z } from "zod";
import type { AgentEventInput } from "@/contracts/activity";
import type { ProviderSnapshot } from "@/contracts/ai-providers";
import { activityWriter, readActivity } from "@/server/exams/activity";
import { createInspectionTools } from "@/server/exams/tools";
import { createProviderExamModel } from "@/server/ai/providers";
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function directory() {
  const root = await mkdtemp(join(tmpdir(), "activity-test-"));
  roots.push(root);
  return root;
}
const config: ProviderSnapshot = {
  providerId: "10000000-0000-4000-8000-000000000001",
  name: "test",
  apiType: "openai_chat",
  baseURL: "https://example.test/v1",
  encryptedApiKey: "encrypted",
  model: "vision-test",
  reasoningEffort: "default",
  structuredOutputs: false,
  maxOutputTokens: 16000,
  timeoutSeconds: 60,
  maxConcurrency: 3,
};
const exam = {
  name: "test",
  totalScore: 1,
  sections: [
    {
      number: "一",
      title: "题目",
      description: "",
      score: 1,
      questions: [
        {
          number: 1,
          description: "Question".repeat(600),
          materials: [],
          score: 1,
          subquestions: [],
        },
      ],
    },
  ],
};
function scriptedModel(rounds: { name: string; args: unknown }[][]) {
  let requests = 0;
  const fetch: typeof globalThis.fetch = async () => {
    const calls = rounds[requests++];
    return Response.json({
      id: `call-${requests}`,
      object: "chat.completion",
      created: 1,
      model: config.model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: calls ? null : "Stopped early",
            ...(calls
              ? {
                  tool_calls: calls.map((call, index) => ({
                    id: `tool-${requests}-${index}`,
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
  return { model: createProviderExamModel(config, "test-key", fetch), requests: () => requests };
}
function questionBatch(number: number) {
  return {
    ...exam,
    sections: [
      {
        ...exam.sections[0],
        questions: [
          { ...exam.sections[0].questions[0], number, description: `Question ${number}` },
        ],
      },
    ],
  };
}
describe("actual agent activity", () => {
  it("replays ordered concurrent events incrementally and ignores an incomplete last line", async () => {
    const root = await directory(),
      emit = activityWriter(root);
    await Promise.all([
      emit({ type: "started" }),
      emit({ type: "tool_call", callId: "one", tool: "read_pages", data: { pages: [1] } }),
      emit({ type: "tool_result", callId: "one", data: { pages: [1] } }),
    ]);
    expect((await readActivity(root)).map((event) => event.sequence)).toEqual([1, 2, 3]);
    expect((await readActivity(root, 2)).map((event) => event.sequence)).toEqual([3]);
    await appendFile(join(root, "agent.jsonl"), '{"incomplete":');
    expect(await readActivity(root)).toHaveLength(3);
  });
  it("continues after an activity write fails and reports the storage failure", async () => {
    const root = await directory(),
      target = join(root, "attempt"),
      emit = activityWriter(target);
    const write = vi.spyOn(console, "error").mockImplementation(() => {});
    await emit({ type: "started" });
    await mkdir(target);
    await emit({ type: "failed", text: "specific failure" });
    expect(await readActivity(target)).toMatchObject([{ sequence: 2, text: "specific failure" }]);
    expect(String(write.mock.calls[0][0])).toContain("activity.write.failed");
  });
  it("inspection tools use source coordinates and never accept nonexistent pages", async () => {
    const root = await directory();
    await mkdir(join(root, "agent"));
    await mkdir(join(root, "pages"));
    const path = join(root, "pages/001.jpg");
    await sharp({ create: { width: 100, height: 200, channels: 3, background: "white" } })
      .jpeg()
      .toFile(path);
    const tools = createInspectionTools([{ page: 1, path, width: 100, height: 200 }], root);
    const options = { toolCallId: "test", messages: [], context: {} };
    expect(Object.keys(tools)).toEqual(["read_pages", "inspect_image", "python"]);
    const result = await tools.inspect_image.execute!(
      { region: { page: 1, x: 0.1, y: 0.2, width: 0.5, height: 0.3 }, scale: 2, sharpen: false },
      options,
    );
    expect(result).toMatchObject({ width: 100, height: 120 });
    if (!("images" in result)) throw new Error("Expected a complete tool result");
    expect(await readFile(join(root, result.images[0]))).toBeInstanceOf(Buffer);
    await expect(tools.read_pages.execute!({ pages: [2] }, options)).rejects.toThrow(
      "页面 2 不存在",
    );
  });
  it("records tool calls and returns only the minimal exam submitted through the SDK loop", async () => {
    const events: AgentEventInput[] = [];
    let requests = 0;
    const fetch: typeof globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(
        body.tools.some(
          (tool: { function: { name: string } }) => tool.function.name === "read_text",
        ),
      ).toBe(false);
      const next = [
        { name: "read_pages", args: { pages: [1] } },
        { name: "report_question_count", args: { total: 1 } },
        { name: "append_questions", args: exam },
        { name: "submit_exam", args: { name: exam.name, totalScore: exam.totalScore } },
      ][requests++];
      return Response.json({
        id: `call-${requests}`,
        object: "chat.completion",
        created: 1,
        model: config.model,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: `tool-${requests}`,
                  type: "function",
                  function: { name: next.name, arguments: JSON.stringify(next.args) },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      });
    };
    const model = createProviderExamModel(config, "test-key", fetch);
    const output = await model.generate({
      system: "Extract",
      content: [{ type: "text", text: "source" }],
      tools: {
        read_pages: tool({
          inputSchema: z.object({ pages: z.array(z.number()) }),
          execute: async () => ({ pages: [1] }),
        }),
      },
      onEvent: async (event) => {
        events.push(event);
      },
    });
    expect(output).toEqual(exam);
    expect(requests).toBe(4);
    expect(events.filter((event) => event.type === "tool_call").map((event) => event.tool)).toEqual(
      ["read_pages", "report_question_count", "append_questions", "submit_exam"],
    );
    expect(events.filter((event) => event.type === "tool_result")).toHaveLength(4);
    expect(output).not.toHaveProperty("activity");
  });
  it("records invalid tool arguments even when execute never runs", async () => {
    const events: AgentEventInput[] = [],
      executed = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => {});
    let requests = 0;
    const transport: typeof fetch = async () => {
      const next = [
        { name: "read_pages", args: { pages: ["bad"] } },
        { name: "report_question_count", args: { total: 1 } },
        { name: "append_questions", args: exam },
        { name: "submit_exam", args: { name: exam.name, totalScore: exam.totalScore } },
      ][requests++];
      return Response.json({
        id: "call",
        object: "chat.completion",
        created: 1,
        model: config.model,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: `invalid-${requests}`,
                  type: "function",
                  function: { name: next.name, arguments: JSON.stringify(next.args) },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      });
    };
    const model = createProviderExamModel(config, "test-key", transport);
    await model.generate({
      system: "Extract",
      content: [{ type: "text", text: "paper" }],
      tools: {
        read_pages: tool({
          inputSchema: z.object({ pages: z.array(z.number()) }),
          execute: executed,
        }),
      },
      onEvent: async (event) => {
        events.push(event);
      },
    });
    expect(executed).not.toHaveBeenCalled();
    expect(
      events.find((event) => event.type === "tool_error" && event.tool === "read_pages"),
    ).toMatchObject({ data: { code: "SCHEMA_INVALID" } });
    expect(console.error).toHaveBeenCalled();
  });
  it("continues beyond 24 calls while accumulating one question per round", async () => {
    const batches = Array.from({ length: 30 }, (_, index) => questionBatch(index + 1));
    const { model, requests } = scriptedModel([
      [{ name: "report_question_count", args: { total: 30 } }],
      ...batches.map((args) => [{ name: "append_questions", args }]),
      [{ name: "submit_exam", args: { name: "Complete paper", totalScore: 30 } }],
    ]);
    const drafts: number[][] = [];
    const output = await model.generate({
      system: "Extract",
      content: [{ type: "text", text: "paper" }],
      tools: {},
      onProgress: async (draft) => {
        drafts.push(draft.sections[0].questions.map((question) => question.number));
      },
    });
    expect(requests()).toBe(32);
    expect(drafts[0]).toEqual([1]);
    expect(drafts[2]).toEqual([1, 2, 3]);
    expect(output.sections[0].questions).toEqual(
      batches.flatMap((batch) => batch.sections[0].questions),
    );
    expect(output.name).toBe("Complete paper");
    expect(output.totalScore).toBe(30);
  });
  it("does not treat saved partial questions as a completed exam when the model stops early", async () => {
    const { model } = scriptedModel([
      [{ name: "report_question_count", args: { total: 2 } }],
      [{ name: "append_questions", args: questionBatch(1) }],
    ]);
    const onProgress = vi.fn().mockResolvedValue(undefined);
    await expect(
      model.generate({
        system: "Extract",
        content: [{ type: "text", text: "paper" }],
        tools: {},
        onProgress,
      }),
    ).rejects.toMatchObject({ name: "AI_ToolChoiceViolationError" });
    expect(onProgress).toHaveBeenCalledOnce();
    expect(onProgress).toHaveBeenCalledWith(questionBatch(1));
  });
  it("merges multiple tool calls in the same SDK round before finalizing", async () => {
    const { model, requests } = scriptedModel([
      [
        { name: "report_question_count", args: { total: 2 } },
        { name: "append_questions", args: questionBatch(1) },
        { name: "append_questions", args: questionBatch(2) },
        { name: "submit_exam", args: { name: "test", totalScore: 2 } },
      ],
    ]);
    const result = await model.generate({
      system: "Extract",
      content: [{ type: "text", text: "paper" }],
      tools: {},
    });
    expect(requests()).toBe(1);
    expect(result.sections[0].questions.map((question) => question.number)).toEqual([1, 2]);
  });
});
