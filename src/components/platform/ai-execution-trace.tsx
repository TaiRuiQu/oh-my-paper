"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronRight,
  Circle,
  Code2,
  FileSearch,
  LoaderCircle,
  PencilLine,
  Search,
  Terminal,
  TriangleAlert,
} from "lucide-react";
import type { AiJobDTO } from "@/contracts/platform-ai";
import {
  aiJobCurrentStep,
  aiJobElapsed,
  aiTraceActivities,
  formatAIDuration,
  type AITraceActivity,
} from "@/lib/ai-trace-display";
import { formatDateTime } from "@/lib/date-time";
import { AIJobStatus } from "./ai-job-list";
import styles from "./ai-execution-trace.module.css";

function ActivityIcon({ activity }: { activity: AITraceActivity }) {
  const Icon =
    activity.status === "error"
      ? TriangleAlert
      : activity.type === "complete" || activity.toolName === "finish"
        ? Check
        : activity.toolName === "shell"
          ? Terminal
          : activity.toolName === "python"
            ? Code2
            : activity.toolName?.startsWith("search_")
              ? Search
              : activity.toolName?.startsWith("read_") || activity.toolName === "list_items"
                ? FileSearch
                : activity.type === "tool"
                  ? PencilLine
                  : Circle;
  return <Icon size={15} strokeWidth={1.6} aria-hidden="true" />;
}

export function AIExecutionTrace({ job }: { job: AiJobDTO }) {
  const active = job.status === "QUEUED" || job.status === "RUNNING";
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!active) return;
    const first = setTimeout(() => setNow(Date.now()), 0);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [active]);
  const activities = useMemo(() => aiTraceActivities(job.events), [job.events]);
  const elapsed = aiJobElapsed(job, now);
  const currentStep = aiJobCurrentStep(job, activities);

  return (
    <section className={styles.trace} aria-label="AI 执行过程">
      <div className={styles.heading}>
        <div className={styles.current} role="status" aria-live="polite" aria-atomic="true">
          {active && <LoaderCircle size={16} className={styles.spinner} aria-hidden="true" />}
          {job.status === "COMPLETED" && <Check size={16} aria-hidden="true" />}
          {job.status === "FAILED" && <TriangleAlert size={16} aria-hidden="true" />}
          <span>{currentStep}</span>
        </div>
        <div className={styles.status}>
          <AIJobStatus job={job} />
          {elapsed && (
            <span className={styles.elapsed}>
              {job.status === "QUEUED" ? "已等待" : "用时"} {elapsed}
            </span>
          )}
        </div>
      </div>
      {job.error && (
        <p role="alert" className={styles.error}>
          {job.error}
        </p>
      )}
      <details className={styles.history} open>
        <summary className={styles.historySummary}>
          <ChevronRight size={14} aria-hidden="true" />
          <h2>执行过程</h2>
          <span>
            {activities.length} 项活动 · {job.events.length} 条记录
          </span>
        </summary>
        {activities.length ? (
          <ol className={styles.activities} aria-label="AI 执行记录">
            {activities.map((activity) => {
              const working = active && activity.status === "running";
              return (
                <li
                  key={activity.id}
                  data-state={
                    working
                      ? "running"
                      : activity.status === "running"
                        ? "complete"
                        : activity.status
                  }
                >
                  <details className={styles.activity}>
                    <summary>
                      <span className={styles.activityIcon}>
                        <ActivityIcon activity={activity} />
                      </span>
                      <span className={styles.activityLabel}>{activity.label}</span>
                      <span className={styles.activityMeta}>
                        {activity.status === "error"
                          ? "未成功"
                          : working
                            ? "进行中"
                            : activity.status === "running" && job.status === "FAILED"
                              ? "已中断"
                              : activity.durationMs !== undefined
                                ? formatAIDuration(activity.durationMs)
                                : null}
                      </span>
                      <ChevronRight size={13} className={styles.chevron} aria-hidden="true" />
                    </summary>
                    <div className={styles.activityDetails}>
                      {activity.toolName && <p>工具：{activity.toolName}</p>}
                      <pre tabIndex={0} aria-label={`${activity.label}的完整记录`}>
                        {JSON.stringify(
                          activity.events.map(({ index, value }) => ({
                            record: index + 1,
                            event: value,
                          })),
                          null,
                          2,
                        )}
                      </pre>
                    </div>
                  </details>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className={styles.empty}>
            {job.status === "QUEUED"
              ? "任务正在排队，开始后会自动显示执行过程。"
              : job.status === "RUNNING"
                ? "正在准备材料，执行记录会自动更新。"
                : "此任务没有保留执行记录。"}
          </p>
        )}
      </details>
      <details className={styles.information}>
        <summary>任务信息与参数</summary>
        <dl className={styles.metadata}>
          <div>
            <dt>提交时间</dt>
            <dd>{formatDateTime(job.createdAt)}</dd>
          </div>
          <div>
            <dt>开始时间</dt>
            <dd>{job.startedAt ? formatDateTime(job.startedAt) : "尚未开始"}</dd>
          </div>
          <div>
            <dt>结束时间</dt>
            <dd>{job.finishedAt ? formatDateTime(job.finishedAt) : "尚未结束"}</dd>
          </div>
        </dl>
        <pre tabIndex={0} aria-label="任务参数">
          {JSON.stringify(job.input, null, 2)}
        </pre>
      </details>
    </section>
  );
}
