import "server-only";
import type { AiJob } from "@/generated/prisma/client";
import type { AiJobDTO } from "@/contracts/platform-ai";
import {
  AI_PROGRESS_HEARTBEAT_MS,
  AI_PROGRESS_RETRY_MS,
  isActiveAiJob,
  type AiProgressSnapshot,
} from "@/contracts/ai-progress";
import { encodeAiProgress } from "@/lib/ai-progress-codec";
import { AccessError, RequestError } from "@/server/http/errors";
import { getEnv } from "@/server/config/env";
import { logError } from "@/server/logger";
import { getAiJob, listAiJobs } from "./ai-jobs";
import { subscribeAiProgress } from "./ai-progress-notifications";
import { getActor } from "./access";
import { loadSearchConfiguration } from "./search/configuration";
import type { AdminSearchConfiguration } from "@/contracts/platform-search";

function jobDTO(job: AiJob): AiJobDTO {
  return {
    id: job.id,
    userId: job.userId,
    kind: job.kind as AiJobDTO["kind"],
    modelId: job.modelId,
    status: job.status as AiJobDTO["status"],
    input: job.input,
    result: job.result,
    cost: job.cost as AiJobDTO["cost"],
    events: job.events as unknown[],
    error: job.error,
    attempts: job.attempts,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
  };
}

export async function aiProgressResponse(
  request: Request,
  userId: string,
  expiresAt: Date,
  { jobId, search = false }: { jobId?: string; search?: boolean } = {},
) {
  const format = new URL(request.url).searchParams.get("format") ?? getEnv().AI_PROGRESS_FORMAT;
  if (format !== "json" && format !== "protobuf")
    throw new RequestError(400, "进度传输格式必须为 json 或 protobuf。");

  const load = async (): Promise<AiProgressSnapshot> => {
    if (search) {
      if ((await getActor(userId)).role !== "ADMIN") throw new AccessError(403, "需要管理员权限。");
      return {
        models: [],
        jobs: [],
        searchConfiguration: (await loadSearchConfiguration()) as AdminSearchConfiguration,
      };
    }
    if (jobId) return { models: [], jobs: [jobDTO(await getAiJob(userId, jobId))] };
    const snapshot = await listAiJobs(userId);
    return { models: snapshot.models, jobs: snapshot.jobs.map(jobDTO) };
  };
  let closed = false;
  let dirty = false;
  let reading = false;
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let lifetime: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe: (() => void) | undefined;
  const encoder = new TextEncoder();
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    clearTimeout(lifetime);
    request.signal.removeEventListener("abort", close);
    unsubscribe?.();
    controller?.close();
  };
  const send = (text: string) => {
    if (closed || !controller) return;
    // A slow/disconnected reader reconnects to a fresh snapshot instead of accumulating memory.
    if ((controller.desiredSize ?? 0) <= 0) return close();
    controller.enqueue(encoder.encode(text));
  };
  const sendSnapshot = (snapshot: AiProgressSnapshot) => {
    const event = format === "protobuf" ? "snapshot-protobuf" : "snapshot";
    const data = format === "protobuf" ? encodeAiProgress(snapshot) : JSON.stringify(snapshot);
    send(`event: ${event}\ndata: ${data}\n\n`);
    if (jobId && snapshot.jobs.every((job) => !isActiveAiJob(job))) close();
  };
  const drain = async () => {
    if (closed || reading || !controller) return;
    reading = true;
    try {
      while (dirty && !closed) {
        dirty = false;
        const snapshot = await load();
        if (!closed) sendSnapshot(snapshot);
      }
    } catch (error) {
      logError("platform.ai.progress.failed", error, { userId, jobId });
      close();
    } finally {
      reading = false;
    }
  };

  try {
    // LISTEN must be active before the first read to avoid a subscribe/snapshot race.
    unsubscribe = await subscribeAiProgress((change) => {
      if (search ? change.kind !== "search" : change.kind === "search") return;
      if (
        !search &&
        (change.kind === "job"
          ? change.userId !== userId || (jobId && change.id !== jobId)
          : Boolean(jobId))
      )
        return;
      dirty = true;
      void drain();
    }, close);
    if (closed || request.signal.aborted) {
      unsubscribe();
      return new Response(null, { status: 204 });
    }
    request.signal.addEventListener("abort", close, { once: true });
    const initial = await load();
    if (closed) return new Response(null, { status: 204 });
    const stream = new ReadableStream<Uint8Array>(
      {
        start(streamController) {
          controller = streamController;
          send(`retry: ${AI_PROGRESS_RETRY_MS}\n\n`);
          sendSnapshot(initial);
          if (closed) return;
          heartbeat = setInterval(() => send(": heartbeat\n\n"), AI_PROGRESS_HEARTBEAT_MS);
          // Reauthenticate periodically and never keep streaming beyond session expiry.
          lifetime = setTimeout(
            close,
            Math.max(0, Math.min(300_000, expiresAt.getTime() - Date.now())),
          );
          void drain();
        },
        cancel() {
          controller = undefined;
          close();
        },
      },
      { highWaterMark: 4 },
    );
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "private, no-store, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    close();
    throw error;
  }
}
