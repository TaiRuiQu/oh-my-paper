"use client";
import { useEffect, useState } from "react";
import type { QuestionProgress } from "@/contracts/exam-tasks";
import { formatCredits } from "@/lib/credits";
import { FileText } from "lucide-react";
export function ProcessingState({
  title = "正在处理，请稍候",
  compact = false,
  startedAt,
  progress,
  creditsSpent,
  creditLabel = "已消费",
}: {
  title?: string;
  compact?: boolean;
  startedAt?: string;
  creditsSpent?: string;
  creditLabel?: string;
  progress?: (QuestionProgress & { label: string })[];
}) {
  const startTime = startedAt ? Date.parse(startedAt) : NaN;
  return (
    <div
      className={`processing-state${compact ? " compact" : ""}`}
      role="status"
      aria-live="polite"
    >
      <div className="processing-animation" aria-hidden="true">
        <FileText size={28} />
        <span />
        <span />
        <span />
      </div>
      <div>
        <h2>
          {title}
          {Number.isFinite(startTime) && <ElapsedTime startTime={startTime} />}
        </h2>
        {creditsSpent !== undefined && (
          <p className="processing-credit">
            {creditLabel} <strong>{formatCredits(creditsSpent)}</strong> credit{" "}
            <span>· 按实际用量更新</span>
          </p>
        )}
        <p>结果准备好后会自动显示。你可以离开页面，稍后回来查看。</p>
      </div>
      {progress?.length ? (
        <div className="question-progress-list">
          {progress.map((item) => (
            <QuestionProgressBar key={item.label} {...item} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
function QuestionProgressBar({ label, total, completed }: QuestionProgress & { label: string }) {
  const known = typeof total === "number" && total > 0;
  const done = Math.max(0, completed);
  const percent = known ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div className="question-progress-item">
      <div className="question-progress-heading">
        <span>{label}</span>
        <strong>{known ? `${done} / ${total} 题` : "正在确认题目总数"}</strong>
      </div>
      <div
        className={`question-progress-track${known ? "" : " is-indeterminate"}`}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={known ? total : undefined}
        aria-valuenow={known ? Math.min(done, total) : undefined}
        aria-valuetext={known ? `共 ${total} 道题，已完成 ${done} 道题` : "正在确认题目总数"}
      >
        <span style={known ? { transform: `scaleX(${percent / 100})` } : undefined} />
      </div>
    </div>
  );
}
function ElapsedTime({ startTime }: { startTime: number }) {
  // Keep the initial server/client render identical, then use the persisted timestamp.
  const [now, setNow] = useState<number>();
  useEffect(() => {
    const update = () => setNow(Date.now());
    const initial = setTimeout(update, 0);
    const interval = setInterval(update, 1000);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [startTime]);
  const seconds = Math.max(0, Math.floor(((now ?? startTime) - startTime) / 1000));
  return (
    <span className="processing-elapsed" role="timer" aria-live="off" aria-label="已处理时间">
      {Math.floor(seconds / 60)}m {seconds % 60}s
    </span>
  );
}
export function StatusBadge({ status }: { status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" }) {
  return (
    <span className={`status-badge status-${status.toLowerCase()}`}>
      <span aria-hidden="true" />
      {status === "COMPLETED" ? "已完成" : status === "FAILED" ? "需重试" : "处理中"}
    </span>
  );
}
