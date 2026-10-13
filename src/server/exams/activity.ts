import "server-only";
import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEvent, AgentEventInput } from "@/contracts/activity";
import { logError } from "@/server/logger";
export function activityWriter(directory: string) {
  let sequence = 0,
    pending = Promise.resolve();
  return (input: AgentEventInput) => {
    const event: AgentEvent = { ...input, sequence: ++sequence, at: new Date().toISOString() };
    const write = pending.then(() =>
      appendFile(join(directory, "agent.jsonl"), JSON.stringify(event) + "\n", { mode: 0o600 }),
    );
    // A failed write must not suppress later events or prevent the exam error from being recorded.
    pending = write.catch((error) => {
      logError("activity.write.failed", error, { sequence: event.sequence });
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
  return content
    .split("\n")
    .slice(0, -1)
    .map((line) => JSON.parse(line) as AgentEvent)
    .filter((event) => event.sequence > after);
}
