import { asSchema } from "ai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { agentTool } from "@/server/ai/agent-tool";

const context = { toolCallId: "test", messages: [], context: {} };
const schema = z.strictObject({
  questions: z.array(
    z.strictObject({ number: z.number().int().positive(), text: z.string().trim() }),
  ),
  images: z.array(z.string()).default([]),
});

describe("agent tool input tolerance", () => {
  it("ignores top-level and nested extras, preserves defaults and reports a warning without mutating input", async () => {
    const execute = vi.fn(async (input: z.output<typeof schema>) => ({ saved: input }));
    const saved = agentTool({ description: "Save", inputSchema: schema, execute });
    const input = {
      questions: [{ number: 1, text: " answer ", confidence: 0.9 }],
      reasoning: "done",
    };
    const validation = await asSchema(saved.inputSchema).validate!(input);
    expect(validation.success).toBe(true);
    const result = await saved.execute(input as never, context);
    expect(result.saved).toEqual({ questions: [{ number: 1, text: "answer" }], images: [] });
    expect(result.warning).toContain("questions[0].confidence");
    expect(result.warning).toContain("reasoning");
    expect(input.questions[0].confidence).toBe(0.9);
    expect(execute).toHaveBeenCalledOnce();
    expect(await saved.execute({ questions: [], images: [] }, context)).not.toHaveProperty(
      "warning",
    );
  });

  it("still rejects missing parameters, invalid values and refinements before execution", async () => {
    const execute = vi.fn(async () => ({ saved: true }));
    const saved = agentTool({
      description: "Save",
      inputSchema: schema.refine((input) => input.questions.length > 0, "At least one question"),
      execute,
    });
    for (const input of [
      { extra: true },
      { questions: [{ number: -1, text: "answer", extra: true }] },
      { questions: [], extra: true },
    ]) {
      expect((await asSchema(saved.inputSchema).validate!(input)).success).toBe(false);
      await expect(saved.execute(input as never, context)).rejects.toBeInstanceOf(z.ZodError);
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it("keeps warnings separate for concurrent calls and includes them in custom model output", async () => {
    const saved = agentTool({
      description: "Read",
      inputSchema: z.strictObject({ id: z.number() }),
      execute: async ({ id }) => ({ id }),
      toModelOutput: ({ output }) => ({ type: "text", value: JSON.stringify(output) }),
    });
    const [first, second] = await Promise.all([
      saved.execute({ id: 1, firstExtra: true } as never, context),
      saved.execute({ id: 2, secondExtra: true } as never, context),
    ]);
    expect(first.warning).toContain("firstExtra");
    expect(first.warning).not.toContain("secondExtra");
    expect(second.warning).toContain("secondExtra");
    const output = await saved.toModelOutput!({
      toolCallId: "test",
      input: { id: 1 },
      output: first,
    });
    expect(output).toMatchObject({ type: "text", value: expect.stringContaining("firstExtra") });
  });
});
