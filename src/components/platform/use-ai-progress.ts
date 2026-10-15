"use client";

import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import type { AiJobDTO } from "@/contracts/platform-ai";
import { isActiveAiJob, type AiProgressSnapshot } from "@/contracts/ai-progress";
import { openAiProgress } from "@/lib/ai-progress-client";

export function useAiProgress({
  initialJob,
  onCompleted,
}: {
  initialJob?: AiJobDTO;
  onCompleted: () => Promise<void>;
}) {
  const [data, setData] = useState<AiProgressSnapshot>({
    models: [],
    jobs: initialJob ? [initialJob] : [],
  });
  const [failure, setFailure] = useState("");
  const [loading, setLoading] = useState(!initialJob);
  const [connection, setConnection] = useState(0);
  const completed = useRef(new Set(initialJob?.status === "COMPLETED" ? [initialJob.id] : []));
  const loaded = useRef(Boolean(initialJob));
  const initiallyActive = !initialJob || isActiveAiJob(initialJob);
  const jobId = initialJob?.id;
  const receive = useEffectEvent((snapshot: AiProgressSnapshot) => {
    setData(snapshot);
    setFailure("");
    setLoading(false);
    let newlyCompleted = false;
    for (const job of snapshot.jobs) {
      if (job.status === "COMPLETED" && !completed.current.has(job.id)) {
        completed.current.add(job.id);
        newlyCompleted ||= loaded.current;
      }
    }
    loaded.current = true;
    if (newlyCompleted)
      void onCompleted().catch(() => {
        setFailure("任务已完成，相关内容暂时无法更新，请刷新页面。");
      });
  });
  useEffect(() => {
    if (!initiallyActive && !connection) return;
    return openAiProgress({
      jobId,
      snapshot: receive,
      error: () => {
        setFailure("暂时无法更新进度，正在重新连接。您也可以手动刷新状态。");
        setLoading(false);
      },
    });
  }, [initiallyActive, jobId, connection]);

  const reconnect = useCallback(async () => {
    setLoading(true);
    setConnection((value) => value + 1);
  }, []);
  return { ...data, failure, loading, reconnect };
}
