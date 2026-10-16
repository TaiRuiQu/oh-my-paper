import type { ModelMessage, ToolSet } from "ai";
import type { z } from "zod";

/** A fresh agent loop and sandbox are created for each independently scoped task. */
export type AgentTask = {
  scope?: { stage: "grade"; studentId: string };
  tools: ToolSet;
  instructions: string;
  prompt: string;
  isComplete: () => boolean;
  dispose: () => Promise<void>;
};

export type ExecuteAgent = (task: AgentTask) => Promise<void>;

/** All evidence is supplied by the program; this task has no tools or agent loop. */
export type ModelTask = {
  scope: NonNullable<AgentTask["scope"]>;
  instructions: string;
  messages: ModelMessage[];
  outputSchema: z.ZodType;
};
export type ExecuteModel = (task: ModelTask) => Promise<unknown>;
