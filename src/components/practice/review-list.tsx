"use client";
import Link from "next/link";
import styles from "./practice.module.css";
import { useRef, useState } from "react";
import { apiRequest } from "@/lib/http-client";
import { PracticePanel } from "./primitives";
import { usePractice } from "./provider";
import type { PracticeReviews, PracticeSessionSummary } from "@/contracts/practice";
const feedbackLabels: Record<PracticeSessionSummary["feedbackState"], string> = {
  NONE: "尚无反馈",
  WAITING: "已提交 · 待反馈",
  AI_CANDIDATE: "AI候选 · 待教师核验",
  SELF: "学生自评 · 未经教师确认",
  TEACHER_CONFIRMED: "教师核验已完成",
};
export function ReviewQueueResource() {
  const { generation } = usePractice<PracticeReviews>();
  return <ReviewQueue key={generation} />;
}
function ReviewQueue() {
  const { data, refresh, pending } = usePractice<PracticeReviews>();
  const [rows, setRows] = useState(data.attempts),
    [cursor, setCursor] = useState(data.nextBeforeId),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false);
  return (
    <PracticePanel
      title="已提交练习与核验记录"
      description="展示当前轮提交的反馈、核验及学生请求状态；历次尝试可在详情历史中读取。按当前班级与学科授权，不展示私人草稿。"
      actions={
        <button
          type="button"
          className="button secondary"
          disabled={pending || loading}
          onClick={async () => {
            try {
              await refresh();
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "读取失败");
            }
          }}
        >
          重新读取提交与核验记录
        </button>
      }
    >
      {rows.map(({ session, attempt }) => (
        <article className={styles.row} key={attempt.id}>
          <div>
            <h3>
              {session.student.classroomName} · {session.student.name} ·{" "}
              {session.student.studentNumber}
            </h3>
            <p>
              {session.name} · {session.subject} · 第 {attempt.sequence} 次提交
            </p>
            <p>反馈状态：{feedbackLabels[session.feedbackState]}</p>
            {session.reviewRequestedAt && (
              <p>
                学生已请求核验 ·{" "}
                <time dateTime={session.reviewRequestedAt}>
                  {new Intl.DateTimeFormat("zh-CN", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(session.reviewRequestedAt))}
                </time>
              </p>
            )}
          </div>
          <Link className="button secondary" href={`/homework/practice/reviews/${attempt.id}`}>
            {!attempt.canConfirmReview
              ? "查看本轮记录"
              : session.reviewRequestedAt
                ? "处理核验请求"
                : session.feedbackState === "TEACHER_CONFIRMED"
                  ? "查看或更正核验"
                  : "核验本轮提交"}
          </Link>
        </article>
      ))}
      {!rows.length && <p className="p-empty">当前授权范围暂无已提交练习；新提交后可重新读取。</p>}
      {error && (
        <p className="p-notice error" role="alert">
          {error}
        </p>
      )}
      {cursor && (
        <button
          type="button"
          className="button secondary"
          disabled={pending || loading}
          onClick={async () => {
            if (lock.current) return;
            lock.current = true;
            setLoading(true);
            try {
              const next = await apiRequest<PracticeReviews>(
                `/api/platform/practice/reviews?${new URLSearchParams({ beforeId: cursor })}`,
              );
              setRows((prev) => [
                ...new Map(
                  [...prev, ...next.attempts].map((entry) => [entry.attempt.id, entry]),
                ).values(),
              ]);
              setCursor(next.nextBeforeId);
              setError("");
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "读取失败");
            } finally {
              lock.current = false;
              setLoading(false);
            }
          }}
        >
          读取更多提交核验记录
        </button>
      )}
    </PracticePanel>
  );
}
