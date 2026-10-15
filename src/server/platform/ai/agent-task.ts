import type { ToolSet } from "ai";

/** A fresh agent loop and sandbox are created for each independently scoped task. */
export type AgentTask = {
  scope?: { stage: "identify" | "grade"; studentId?: string; itemId?: string };
  tools: ToolSet;
  instructions: string;
  prompt: string;
  isComplete: () => boolean;
  dispose: () => Promise<void>;
};

export type ExecuteAgent = (task: AgentTask) => Promise<void>;
