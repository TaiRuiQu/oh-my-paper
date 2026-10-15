import {
  AI_PROGRESS_RETRY_MS,
  isActiveAiJob,
  type AiProgressSnapshot,
} from "@/contracts/ai-progress";

/** Native EventSource handles network reconnects; every connection starts with a full snapshot. */
export function openAiProgress({
  jobId,
  search = false,
  snapshot,
  error,
}: {
  jobId?: string;
  search?: boolean;
  snapshot: (snapshot: AiProgressSnapshot) => void;
  error: () => void;
}) {
  const url = search
    ? "/api/platform/admin/ai-progress"
    : jobId
      ? `/api/platform/ai/${encodeURIComponent(jobId)}/events`
      : "/api/platform/ai/events";
  let disposed = false;
  let source: EventSource;
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  let pending = Promise.resolve();
  const scheduleReconnect = () => {
    reconnect ??= setTimeout(() => {
      reconnect = undefined;
      connect();
    }, AI_PROGRESS_RETRY_MS);
  };
  const connect = () => {
    if (disposed) return;
    const current = (source = new EventSource(url));
    const receive = (event: MessageEvent, protobuf: boolean) => {
      // Loading the experimental decoder must not reorder later updates.
      pending = pending.then(async () => {
        if (disposed || source !== current) return;
        try {
          const data: AiProgressSnapshot = protobuf
            ? (await import("./ai-progress-codec")).decodeAiProgress(event.data)
            : JSON.parse(event.data);
          if (disposed || source !== current) return;
          if (!Array.isArray(data.jobs) || !Array.isArray(data.models))
            throw new Error("无效的 AI 进度快照。");
          if (jobId && (data.jobs.length !== 1 || data.jobs[0].id !== jobId))
            throw new Error("AI 任务进度与当前任务不匹配。");
          if (search && !data.searchConfiguration) throw new Error("缺少向量化进度。");
          snapshot(data);
          if (jobId && data.jobs.length && data.jobs.every((job) => !isActiveAiJob(job))) {
            disposed = true;
            clearTimeout(reconnect);
            current.close();
          }
        } catch {
          if (disposed || source !== current) return;
          error();
          current.close();
          scheduleReconnect();
        }
      });
    };
    current.addEventListener("snapshot", (event) => receive(event as MessageEvent, false));
    current.addEventListener("snapshot-protobuf", (event) => receive(event as MessageEvent, true));
    current.onerror = () => {
      if (disposed || source !== current) return;
      error();
      // HTTP errors may permanently close EventSource instead of entering CONNECTING.
      if (current.readyState === EventSource.CLOSED) scheduleReconnect();
    };
  };
  connect();
  return () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(reconnect);
    source.close();
  };
}
