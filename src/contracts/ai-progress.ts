import type { AiJobDTO } from "./platform-ai";
import type { AdminSearchConfiguration } from "./platform-search";

export type AiProgressFormat = "json" | "protobuf";
export type AiProgressSnapshot = {
  models: { id: string; name: string }[];
  jobs: AiJobDTO[];
  searchConfiguration?: AdminSearchConfiguration;
};

export const AI_PROGRESS_RETRY_MS = 3000;
export const AI_PROGRESS_HEARTBEAT_MS = 15_000;

export function isActiveAiJob(job: Pick<AiJobDTO, "status">) {
  return job.status === "QUEUED" || job.status === "RUNNING";
}
