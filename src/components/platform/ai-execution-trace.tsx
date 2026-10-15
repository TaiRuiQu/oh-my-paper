"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronRight,
  Circle,
  FileSearch,
  LoaderCircle,
  PencilLine,
  Search,
  TriangleAlert,
} from "lucide-react";
import type { AiJobDTO } from "@/contracts/platform-ai";
import {
  aiJobCurrentStep,
  aiJobElapsed,
  aiToolLabel,
  aiTraceActivities,
  aiTraceGroups,
  type AITraceActivity,
  type AITraceGroup,
} from "@/lib/ai-trace-display";
import { aiActivityImages, aiTeacherActivity, aiTeacherFailure } from "@/lib/ai-teacher-display";
import { formatDateTime } from "@/lib/date-time";
import { AIJobStatus } from "./ai-job-list";
import { AITraceImages } from "./ai-trace-content";
import styles from "./ai-execution-trace.module.css";

function activityState(activity: AITraceActivity, jobStatus: AiJobDTO["status"]) {
  if (activity.status === "error" && jobStatus === "COMPLETED") return "continued";
  if (activity.status !== "running") return activity.status;
  if (jobStatus === "RUNNING" || jobStatus === "QUEUED") return "running";
  return jobStatus === "FAILED" ? "interrupted" : "complete";
}

function ActivityIcon({
  activity,
  jobStatus,
}: {
  activity: AITraceActivity;
  jobStatus: AiJobDTO["status"];
}) {
  const state = activityState(activity, jobStatus);
  const Icon =
    state === "error" || state === "interrupted"
      ? TriangleAlert
      : state === "continued" || activity.type === "complete" || activity.toolName === "finish"
        ? Check
        : activity.toolName?.startsWith("search_")
          ? Search
          : activity.toolName?.startsWith("read_") || activity.toolName === "list_items"
            ? FileSearch
            : activity.type === "tool"
              ? PencilLine
              : Circle;
  return <Icon size={15} strokeWidth={1.6} aria-hidden="true" />;
}

function ActivityDetails({
  activity,
  jobStatus,
}: {
  activity: AITraceActivity;
  jobStatus: AiJobDTO["status"];
}) {
  const images = aiActivityImages(activity);
  return (
    <div className={styles.activityDetails}>
      <p>{aiTeacherActivity(activity, jobStatus)}</p>
      {images.length > 0 && (
        <section className={styles.detailSection} aria-label="相关图片">
          <h3>相关图片</h3>
          <AITraceImages urls={images} />
        </section>
      )}
    </div>
  );
}

function activityLabel(activity: AITraceActivity) {
  if (activity.toolName) return aiToolLabel(activity.toolName);
  return activity.type === "start"
    ? "开始处理材料"
    : activity.type === "complete"
      ? "处理完成"
      : "核对处理结果";
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
  const status =
    state === "error"
      ? "遇到问题"
      : state === "running"
        ? "正在处理"
        : state === "interrupted"
          ? "已停止"
          : state === "continued"
            ? "已继续处理"
            : "已完成";
  return (
    <li data-state={state}>
      <details className={styles.activity} onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>
          <span className={styles.activityIcon}>
            <ActivityIcon activity={activity} jobStatus={jobStatus} />
          </span>
          <span className={styles.activityLabel}>{activityLabel(activity)}</span>
          <span className={styles.activityMeta}>{status}</span>
          <ChevronRight size={13} className={styles.chevron} aria-hidden="true" />
        </summary>
        {open && <ActivityDetails activity={activity} jobStatus={jobStatus} />}
      </details>
    </li>
  );
}

function GroupRow({ group, jobStatus }: { group: AITraceGroup; jobStatus: AiJobDTO["status"] }) {
  const [open, setOpen] = useState(false);
  if (group.activities.length === 1)
    return <ActivityRow activity={group.activities[0]} jobStatus={jobStatus} />;
  const states = group.activities.map((activity) => activityState(activity, jobStatus));
  const state = states.includes("running")
    ? "正在处理"
    : states.includes("interrupted") || (jobStatus === "FAILED" && states.includes("error"))
      ? "已停止"
      : states.includes("error")
        ? "正在核对问题"
        : "已完成";
  return (
    <li className={styles.group}>
      <details className={styles.activity} onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>
          <span className={styles.activityIcon}>
            <ActivityIcon
              activity={{ ...group.activities[0], status: "complete" }}
              jobStatus={jobStatus}
            />
          </span>
          <span className={styles.activityLabel}>{group.label}</span>
          <span className={styles.activityMeta}>{state}</span>
          <ChevronRight size={13} className={styles.chevron} aria-hidden="true" />
        </summary>
        {open && (
          <ul className={styles.groupItems} aria-label={`${group.label}的处理步骤`}>
            {group.activities.map((activity) => (
              <ActivityRow key={activity.id} activity={activity} jobStatus={jobStatus} />
            ))}
          </ul>
        )}
      </details>
    </li>
  );
}

export function AIExecutionTrace({
  job,
  showDiagnostics = false,
}: {
  job: AiJobDTO;
  showDiagnostics?: boolean;
}) {
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
  return (
    <section className={styles.trace} aria-label="AI 执行过程">
      <div className={styles.heading}>
        <div className={styles.current} role="status" aria-live="polite" aria-atomic="true">
          {active && <LoaderCircle size={16} className={styles.spinner} aria-hidden="true" />}
          {job.status === "COMPLETED" && <Check size={16} aria-hidden="true" />}
          {job.status === "FAILED" && <TriangleAlert size={16} aria-hidden="true" />}
          <span>{aiJobCurrentStep(job, activities)}</span>
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
      {job.status === "FAILED" && (
        <p role="alert" className={styles.error}>
          {aiTeacherFailure(job.error)}
        </p>
      )}
      <details className={styles.history} open>
        <summary className={styles.historySummary}>
          <ChevronRight size={14} aria-hidden="true" />
          <h2>处理过程</h2>
          <span>可展开查看每一步的说明</span>
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
              ? "任务正在排队，请稍候。"
              : job.status === "RUNNING"
                ? "正在准备材料，处理进度会自动更新。"
                : "请查看下方的处理结果。"}
          </p>
        )}
      </details>
      <details className={styles.information}>
        <summary>处理时间</summary>
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
      </details>
      {showDiagnostics && (
        <details className={styles.raw}>
          <summary>管理员排查信息</summary>
          <pre tabIndex={0} aria-label="完整技术记录">
            {JSON.stringify({ input: job.input, error: job.error, events: job.events }, null, 2)}
          </pre>
        </details>
      )}
    </section>
  );
}
