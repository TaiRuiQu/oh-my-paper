import "server-only";
import { tool, type ToolExecutionOptions, type ToolSet } from "ai";
import { z } from "zod";

export type ToolErrorDetails = {
  name: string;
  message: string;
  code?: string;
  status?: number;
  issues?: unknown[];
  cause?: ToolErrorDetails;
};

export function toolErrorDetails(error: unknown, depth = 0): ToolErrorDetails {
  if (error instanceof DetailedToolError) return error.toJSON();
  if (!(error instanceof Error))
    return { name: "Error", message: typeof error === "string" ? error : String(error) };
  const extra = error as Error & { code?: string; status?: number; issues?: unknown[] };
  return {
    name: error.name,
    message: error.message,
    ...(extra.code !== undefined ? { code: extra.code } : {}),
    ...(extra.status !== undefined ? { status: extra.status } : {}),
    ...(extra.issues ? { issues: extra.issues } : {}),
    ...(error.cause !== undefined && depth < 5
      ? { cause: toolErrorDetails(error.cause, depth + 1) }
      : {}),
  };
}

// Preserve details whether the SDK encodes an execution error as text or as JSON.
class DetailedToolError extends Error {
  constructor(private readonly details: ToolErrorDetails) {
    super(JSON.stringify(details));
    this.name = details.name;
  }
  toJSON() {
    return this.details;
  }
}

export function withDetailedToolErrors(tools: ToolSet): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).map(([name, definition]) => {
      const execute = definition.execute;
      return [
        name,
        execute
          ? {
              ...definition,
              execute: async (input: unknown, options: ToolExecutionOptions<unknown>) => {
                try {
                  return await execute(input, options);
                } catch (error) {
                  throw new DetailedToolError(toolErrorDetails(error));
                }
              },
            }
          : definition,
      ];
    }),
  );
}

export function batchTool<SCHEMA extends z.ZodType, OUTPUT>(options: {
  description: string;
  inputSchema: SCHEMA;
  execute: (input: z.output<SCHEMA>, context: ToolExecutionOptions<unknown>) => Promise<OUTPUT>;
}) {
  return tool({
    description: `${options.description} Submit multiple entries in items in one call. Results correspond to input indices; each entry succeeds or returns detailed error information independently. Retry only failed entries.`,
    inputSchema: z.object({ items: z.array(options.inputSchema).min(1).max(500) }),
    execute: async ({ items }, context) => ({
      results: await Promise.all(
        items.map(async (item, index) => {
          try {
            return { index, success: true as const, output: await options.execute(item, context) };
          } catch (error) {
            context.abortSignal?.throwIfAborted();
            return { index, success: false as const, error: toolErrorDetails(error) };
          }
        }),
      ),
    }),
  });
}
