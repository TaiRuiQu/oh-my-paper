"use client";

import Link from "next/link";
import type { AiJobDTO, AiKind } from "@/contracts/platform-ai";
import { AI_JOB_NAMES, AI_JOB_STATUSES, aiJobHref, aiJobResultLink } from "@/lib/ai-job-display";
import { formatDateTime } from "@/lib/date-time";
import { Empty, Panel } from "./primitives";

export function AIJobStatus({ job }: { job: AiJobDTO }) {
  return (
    <span
      className={`p-status${job.status === "COMPLETED" ? " success" : job.status === "FAILED" ? " warning" : ""}`}
    >
      {AI_JOB_STATUSES[job.status]}
    </span>
  );
}

export function AIJobList({
  jobs,
  mode,
  failure,
  loading = false,
  compact = false,
  refresh,
}: {
  jobs: AiJobDTO[];
  mode?: AiKind | null;
  failure: string;
  loading?: boolean;
  compact?: boolean;
  refresh: () => Promise<void>;
}) {
  const relevant = jobs.filter(
    (job) => !mode || job.kind === mode || (mode === "IMPORT" && job.kind === "ENRICH"),
  );
  return (
    <Panel
      title={compact ? "最近任务" : "AI 任务记录"}
      description={
        compact
          ? "选择任务进入独立页面，查看完整执行过程、结果和失败原因。"
          : "仅展示本人提交的任务。选择任务查看完整执行轨迹；任务状态每三秒更新。"
      }
      actions={
        <>
          <button className="button secondary" onClick={() => void refresh()}>
            刷新状态
          </button>
          {compact && (
            <Link className="button secondary" href="/workspace/ai">
              全部任务
            </Link>
          )}
        </>
      }
    >
      {failure && (
        <p role="alert" className="p-notice error">
          {failure}
        </p>
      )}
      {loading && !jobs.length ? (
        <Empty>正在加载任务…</Empty>
      ) : !relevant.length && !failure ? (
        <Empty>暂无任务。提交任务后，可进入任务页面查看执行进度与结果。</Empty>
      ) : (
        relevant.slice(0, compact ? 3 : 100).map((job) => {
          const resultLink = aiJobResultLink(job);
          return (
            <article key={job.id} className="p-question">
              <div className="p-question-head">
                <Link className="link-button" href={aiJobHref(job.id)}>
                  {AI_JOB_NAMES[job.kind]}
                </Link>
                <AIJobStatus job={job} />
              </div>
              <p className="p-muted">提交于 {formatDateTime(job.createdAt)}</p>
              <div className="p-actions">
                <Link className="button secondary" href={aiJobHref(job.id)}>
                  查看执行轨迹
                </Link>
                {resultLink && (
                  <Link className="button secondary" href={resultLink.href}>
                    {resultLink.label}
                  </Link>
                )}
              </div>
            </article>
          );
        })
      )}
      {!compact && jobs.length === 100 && (
        <p className="p-muted p-panel-content">
          展示最近 100 个任务，更早的任务仍可通过原有链接访问。
        </p>
      )}
    </Panel>
  );
}
