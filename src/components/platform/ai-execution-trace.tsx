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
  aiTraceGroups,
  formatAIDuration,
  type AITraceActivity,
  type AITraceGroup,
} from "@/lib/ai-trace-display";
import { formatDateTime } from "@/lib/date-time";
import { AIJobStatus } from "./ai-job-list";
import { AITraceText, AITraceValue } from "./ai-trace-content";
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

function activityState(activity: AITraceActivity, jobStatus: AiJobDTO["status"]) {
  if (activity.status !== "running") return activity.status;
  if (jobStatus === "RUNNING" || jobStatus === "QUEUED") return "running";
  return jobStatus === "FAILED" ? "interrupted" : "complete";
}

function ActivityDetails({ activity }: { activity: AITraceActivity }) {
  const records = activity.events.map(({ value }) =>
    value && typeof value === "object" ? (value as Record<string, unknown>) : { message: value },
  );
  const input = records.find((record) => record.input !== undefined)?.input;
  return (
    <div className={styles.activityDetails}>
      {activity.toolName && (
        <p>
          工具：<code>{activity.toolName}</code>
        </p>
      )}
      {input !== undefined && (
        <section className={styles.detailSection} aria-label="调用参数">
          <h3>调用参数</h3>
          <AITraceValue value={input} />
        </section>
      )}
      {records.map((record, index) => (
        <div key={index}>
          {(typeof record.message === "string" || typeof record.summary === "string") && (
            <AITraceText text={String(record.summary ?? record.message)} />
          )}
          {Boolean(record.error) && (
            <div className={styles.detailError}>
              <TriangleAlert size={15} aria-hidden="true" />
              <AITraceValue value={record.error} />
            </div>
          )}
          {record.type === "sandbox" && (
            <section className={styles.detailSection} aria-label="运行结果">
              <h3>运行结果</h3>
              <p className={styles.exitCode}>
                {record.exitCode === 0 ? "执行成功" : "执行未成功"} · 退出码{" "}
                {String(record.exitCode ?? "未知")}
              </p>
              <AITraceValue
                value={{
                  ...(record.stdout ? { stdout: record.stdout } : {}),
                  ...(record.stderr ? { stderr: record.stderr } : {}),
                  ...(Array.isArray(record.images) && record.images.length
                    ? { images: record.images }
                    : {}),
                }}
              />
            </section>
          )}
          {(record.output !== undefined || record.result !== undefined) && (
            <section className={styles.detailSection} aria-label="工具结果">
              <h3>工具结果</h3>
              <AITraceValue value={record.output ?? record.result} />
            </section>
          )}
          {Boolean(record.usage) && (
            <section className={styles.detailSection} aria-label="本轮用量">
              <h3>本轮用量</h3>
              <AITraceValue value={record.usage} />
            </section>
          )}
        </div>
      ))}
      <details className={styles.raw}>
        <summary>原始记录 · {activity.events.length} 条</summary>
        <pre tabIndex={0} aria-label={`${activity.label}的完整记录`}>
          {JSON.stringify(
            activity.events.map(({ index, value }) => ({ record: index + 1, event: value })),
            null,
            2,
          )}
        </pre>
      </details>
    </div>
  );
}

function ActivityRow({
  activity,
  jobStatus,
}: {
  activity: AITraceActivity;
  jobStatus: AiJobDTO["status"];
}) {
  const [open, setOpen] = useState(false);
  const state = activityState(activity, jobStatus);
  return (
    <li data-state={state}>
      <details className={styles.activity} onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>
          <span className={styles.activityIcon}>
            <ActivityIcon activity={activity} />
          </span>
          <span className={styles.activityLabel}>
            {activity.type === "tool"
              ? activity.label
              : activity.type === "start"
                ? "开始处理任务"
                : activity.type === "complete"
                  ? "任务处理完成"
                  : activity.type === "step"
                    ? "分析材料，确定下一步"
                    : "执行记录"}
          </span>
          <span className={styles.activityMeta}>
            {state === "error"
              ? "未成功"
              : state === "running"
                ? "进行中"
                : state === "interrupted"
                  ? "已中断"
                  : activity.durationMs !== undefined
                    ? formatAIDuration(activity.durationMs)
                    : null}
          </span>
          <ChevronRight size={13} className={styles.chevron} aria-hidden="true" />
        </summary>
        {open && <ActivityDetails activity={activity} />}
      </details>
    </li>
  );
}

function GroupRow({ group, jobStatus }: { group: AITraceGroup; jobStatus: AiJobDTO["status"] }) {
  const [open, setOpen] = useState(false);
  if (group.activities.length === 1)
    return <ActivityRow activity={group.activities[0]} jobStatus={jobStatus} />;
  const failed = group.activities.filter((activity) => activity.status === "error").length;
  const running = group.activities.filter(
    (activity) => activityState(activity, jobStatus) === "running",
  ).length;
  const interrupted = group.activities.filter(
    (activity) => activityState(activity, jobStatus) === "interrupted",
  ).length;
  return (
    <li className={styles.group}>
      <details className={styles.activity} onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>
          <span className={styles.activityIcon}>
            <ActivityIcon activity={{ ...group.activities[0], status: "complete" }} />
          </span>
          <span className={styles.activityLabel}>
            {group.label}
            <span className={styles.callCount}> · {group.activities.length} 次</span>
          </span>
          <span className={styles.activityMeta}>
            {running > 0 && <span>{running} 次进行中</span>}
            {failed > 0 && <span className={styles.failedCount}>{failed} 次未成功</span>}
            {interrupted > 0 && <span>{interrupted} 次已中断</span>}
            {!running && !failed && !interrupted && "已完成"}
          </span>
          <ChevronRight size={13} className={styles.chevron} aria-hidden="true" />
        </summary>
        {open && (
          <ul className={styles.groupItems} aria-label={`${group.label}的各次调用`}>
            {group.activities.map((activity, index) => (
              <ActivityRow
                key={activity.id}
                activity={{ ...activity, label: `${index + 1}. ${activity.label}` }}
                jobStatus={jobStatus}
              />
            ))}
          </ul>
        )}
      </details>
    </li>
  );
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
  const groups = useMemo(() => aiTraceGroups(activities), [activities]);
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
            {groups.length} 项活动 ·{" "}
            {activities.filter((activity) => activity.type === "tool").length} 次工具调用 ·{" "}
            {job.events.length} 条记录
          </span>
        </summary>
        {activities.length ? (
          <ol className={styles.activities} aria-label="AI 执行记录">
            {groups.map((group) => (
              <GroupRow key={group.id} group={group} jobStatus={job.status} />
            ))}
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
        <div className={styles.parameters} aria-label="任务参数">
          <AITraceValue value={job.input} />
        </div>
        <details className={styles.raw}>
          <summary>原始参数</summary>
          <pre tabIndex={0}>{JSON.stringify(job.input, null, 2)}</pre>
        </details>
      </details>
    </section>
  );
}
