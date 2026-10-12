import "server-only";
import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEvent, AgentEventInput } from "@/contracts/recognition";

export function activityWriter(
  directory: string,
  onEvent?: (event: AgentEvent) => void | Promise<void>,
) {
  let sequence = 0;
  let pending = Promise.resolve();
  return (input: AgentEventInput) => {
    const event: AgentEvent = { ...input, sequence: ++sequence, at: new Date().toISOString() };
    pending = pending.then(async () => {
      await appendFile(join(directory, "agent.jsonl"), JSON.stringify(event) + "\n", {
        mode: 0o600,
      });
      await onEvent?.(event);
    });
    return pending;
  };
}
export async function readActivity(directory: string, after = 0): Promise<AgentEvent[]> {
  let content: string;
  try {
    content = await readFile(join(directory, "agent.jsonl"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  // A worker may currently be appending the last line. Only complete records are replayed.
  return content
    .split("\n")
    .slice(0, -1)
    .map((line) => JSON.parse(line) as AgentEvent)
    .filter((event) => event.sequence > after);
}
