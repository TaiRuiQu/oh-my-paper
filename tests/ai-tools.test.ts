import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ToolLoopAgent, isStepCount, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { batchTool, withDetailedToolErrors } from "@/server/platform/ai/tools";
import { RequestError } from "@/server/http/errors";

describe("batch tool execution", () => {
  it("executes different tools from one model response concurrently through the SDK agent", async () => {
    const started: string[] = [];
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const create = (name: string) =>
      tool({
        inputSchema: z.object({}),
        execute: async () => {
          started.push(name);
          if (started.length === 2) release();
          await barrier;
          return name;
        },
      });
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: ["first", "second"].map((name) => ({
          type: "tool-call" as const,
          toolCallId: name,
          toolName: name,
          input: "{}",
        })),
        finishReason: { unified: "tool-calls" as const, raw: undefined },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 1, text: 1, reasoning: undefined },
        },
        warnings: [],
      }),
    });
    const agent = new ToolLoopAgent({
      model,
      tools: withDetailedToolErrors({ first: create("first"), second: create("second") }),
      stopWhen: isStepCount(1),
    });
    const result = await agent.generate({ prompt: "Read both" });
    expect(started).toEqual(["first", "second"]);
    expect(result.toolResults).toHaveLength(2);
    expect(model.doGenerateCalls).toHaveLength(1);
  });
  it("starts independent entries concurrently, preserves ordering and isolates detailed failures", async () => {
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started: number[] = [];
    const definition = batchTool({
      description: "Read questions",
      inputSchema: z.object({ id: z.number() }),
      execute: async ({ id }) => {
        started.push(id);
        await barrier;
        if (id === 2)
          throw new RequestError(409, "请先读取第2题。", { cause: new Error("原始材料尚未查看") });
        return { id };
      },
    });
    const pending = definition.execute!(
      { items: [{ id: 1 }, { id: 2 }, { id: 3 }] },
      {
        toolCallId: "batch",
        messages: [],
        context: {},
      },
    );
    expect(started).toEqual([1, 2, 3]);
    release();
    await expect(pending).resolves.toEqual({
      results: [
        { index: 0, success: true, output: { id: 1 } },
        {
          index: 1,
          success: false,
          error: {
            name: "RequestError",
            message: "请先读取第2题。",
            code: "REQUEST_409",
            status: 409,
            cause: { name: "Error", message: "原始材料尚未查看" },
          },
        },
        { index: 2, success: true, output: { id: 3 } },
      ],
    });
  });

  it("keeps native exception messages and nested validation paths when SDK JSON serializes them", async () => {
    const tools = withDetailedToolErrors({
      validate: {
        inputSchema: z.object({}),
        execute: async () => {
          z.object({ answers: z.array(z.string()) }).parse({ answers: [42] });
        },
      },
    });
    try {
      await tools.validate.execute!(
        {},
        { toolCallId: "validate", messages: [], context: undefined },
      );
      expect.unreachable("must reject invalid answers");
    } catch (error) {
      const details = JSON.parse(JSON.stringify(error));
      expect(details.message).toContain("expected string");
      expect(details.issues[0].path).toEqual(["answers", 0]);
    }
  });
});
