"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { apiRequest } from "@/lib/http-client";
import { PracticePanel } from "./primitives";
import { usePractice } from "./provider";
import styles from "./practice.module.css";
import type { PracticeSessions } from "@/contracts/practice";
const feedbackLabels = {
  NONE: "练习草稿",
  WAITING: "已提交 · 待反馈",
  AI_CANDIDATE: "AI候选 · 待核验",
  SELF: "本人自评 · 未经教师确认",
  TEACHER_CONFIRMED: "教师核验已完成",
};
export function PracticeSessionList() {
  const { data, refresh, pending, generation } = usePractice<PracticeSessions>();
  return <SessionRows key={generation} initial={data} refresh={refresh} refreshing={pending} />;
}
function SessionRows({
  initial,
  refresh,
  refreshing,
}: {
  initial: PracticeSessions;
  refresh: () => Promise<void>;
  refreshing: boolean;
}) {
  const [list, setList] = useState(initial),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false);
  const lock = useRef(false);
  return (
    <PracticePanel
      title="我的练习记录"
      description="无需等待正式成绩报告。草稿、反馈候选、自评与教师核验分别显示。"
      actions={
        <button
          className="button secondary"
          type="button"
          disabled={pending || refreshing}
          onClick={async () => {
            try {
              await refresh();
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "读取失败，原记录仍保留。");
            }
          }}
        >
          重新读取练习记录
        </button>
      }
    >
      {list.sessions.map((session) => (
        <article className={styles.row} key={session.id}>
          <div>
            <h3>
              <Link href={`/learning/practice/${session.id}`}>{session.name}</Link>
            </h3>
            <p>
              {session.subject} · {session.student.name} ·{" "}
              {feedbackLabels[session.feedbackState] ??
                (session.status === "DRAFT" ? "练习草稿" : "已提交，查看反馈")}
            </p>
            <p>
              已提交 {session.attemptCount} 次 ·{" "}
              {session.sourceKind === "REPLAY" ? "复习卷原题复现" : "已发布练习"}
            </p>
          </div>
          <Link className="button secondary" href={`/learning/practice/${session.id}`}>
            {session.status === "DRAFT" ? "继续作答" : "查看反馈与再练"}
          </Link>
        </article>
      ))}
      {!list.sessions.length && (
        <p className="p-empty">暂无练习记录，可从下方已发布练习开始，或领取本人保存的复习卷。</p>
      )}
      {error && (
        <p className="p-notice error" role="alert">
          {error}，可重试。
        </p>
      )}
      {list.nextBeforeId && (
        <button
          className="button secondary"
          type="button"
          disabled={pending}
          onClick={async () => {
            if (lock.current) return;
            lock.current = true;
            setPending(true);
            try {
              const next = await apiRequest<PracticeSessions>(
                `/api/platform/practice/sessions?${new URLSearchParams({ beforeId: list.nextBeforeId! })}`,
              );
              setList((prev) => ({
                ...next,
                sessions: [
                  ...new Map(
                    [...prev.sessions, ...next.sessions].map((session) => [session.id, session]),
                  ).values(),
                ],
              }));
              setError("");
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "读取失败");
            } finally {
              lock.current = false;
              setPending(false);
            }
          }}
        >
          {pending ? "正在读取…" : "读取更早练习"}
        </button>
      )}
    </PracticePanel>
  );
}
