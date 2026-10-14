import "server-only";
import { jsonSchema, type Tool, type ToolExecutionOptions } from "ai";
import { z } from "zod";

type ModelToolOutput = Awaited<ReturnType<NonNullable<Tool["toModelOutput"]>>>;

function parseToolInput<Schema extends z.ZodType>(schema: Schema, input: unknown) {
  const cleaned = structuredClone(input);
  const ignored: string[] = [];
  while (true) {
    const parsed = schema.safeParse(cleaned);
    if (parsed.success) return { input: parsed.data, ignored };
    const extraFields = parsed.error.issues.filter((issue) => issue.code === "unrecognized_keys");
    if (!extraFields.length) throw parsed.error;
    for (const issue of extraFields) {
      let object = cleaned as Record<PropertyKey, unknown>;
      for (const part of issue.path) object = object[part] as Record<PropertyKey, unknown>;
      for (const key of issue.keys) {
        delete object[key];
        ignored.push(
          [...issue.path, key].reduce<string>(
            (path, part) =>
              typeof part === "number"
                ? `${path}[${part}]`
                : `${path}${path ? "." : ""}${String(part)}`,
            "",
          ),
        );
      }
    }
  }
}

// Keep the declared parameters precise while tolerating extra keys at every
// nesting level. Retain raw input until execution so its warning stays tied to
// the right call, including concurrent calls and image-bearing tool results.
export function agentTool<Schema extends z.ZodType, Output extends object>(options: {
  description: string;
  inputSchema: Schema;
  execute: (
    input: z.output<Schema>,
    options: ToolExecutionOptions<unknown>,
  ) => Output | Promise<Output>;
  toModelOutput?: (options: {
    toolCallId: string;
    input: z.output<Schema>;
    output: NoInfer<Output>;
  }) => ModelToolOutput | PromiseLike<ModelToolOutput>;
}) {
  return {
    ...options,
    inputSchema: jsonSchema<z.output<Schema>>(
      z.toJSONSchema(options.inputSchema, { target: "draft-7", io: "input" }) as Parameters<
        typeof jsonSchema
      >[0],
      {
        validate: (value) => {
          try {
            parseToolInput(options.inputSchema, value);
            return { success: true, value: value as z.output<Schema> };
          } catch (error) {
            return { success: false, error: error as Error };
          }
        },
      },
    ),
    execute: async (
      input: z.output<Schema>,
      context: ToolExecutionOptions<unknown>,
    ): Promise<Output & { warning?: string }> => {
      const parsed = parseToolInput(options.inputSchema, input);
      const output = await options.execute(parsed.input, context);
      return parsed.ignored.length
        ? {
            ...output,
            warning: `Ignored unexpected input fields: ${parsed.ignored.join(", ")}. Use only declared parameters.`,
          }
        : output;
    },
  };
}
