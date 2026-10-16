"use client";
import { useRef, useState } from "react";
import type { PracticeHistory } from "@/contracts/practice";
import { apiRequest } from "@/lib/http-client";
import { PracticeAttemptReading } from "./feedback";
import styles from "./practice.module.css";
const eventLabels: Record<string, string> = {
  "practice.set.publish": "发布练习",
  "practice.set.close": "关闭新领取",
  "practice.start": "建立练习草稿",
  "practice.draft.save": "保存本人草稿",
  "practice.submit": "提交本轮练习",
  "practice.retry": "开始下一轮再练",
  "practice.reference.reveal": "明确查看参考",
  "practice.self-assess": "记录本人自评",
  "practice.review.request": "请求教师核验",
  "practice.review.confirm": "教师核验或更正",
};
export function PracticeHistoryView({ sessionId }: { sessionId: string }) {
  const [history, setHistory] = useState<PracticeHistory | null>(null),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false);
  async function load(older = false) {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    try {
      const query = new URLSearchParams({
        limit: "20",
        ...(older && history?.nextBeforeId ? { beforeId: history.nextBeforeId } : {}),
      });
      const next = await apiRequest<PracticeHistory>(
        `/api/platform/practice/sessions/${sessionId}/history?${query}`,
      );
      setHistory((prev) =>
        older && prev
          ? {
              ...next,
              events: [...prev.events, ...next.events],
              attempts: [
                ...new Map(
                  [...prev.attempts, ...next.attempts].map((attempt) => [
                    attempt.attempt.id,
                    attempt,
                  ]),
                ).values(),
              ],
            }
          : next,
      );
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "历史读取失败，已显示记录仍保留。");
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  return (
    <div className={styles.stack}>
      <div className="p-actions">
        <button
          type="button"
          className="button secondary"
          disabled={pending}
          onClick={() => void load()}
        >
          {pending ? "正在读取历史…" : history ? "重新读取练习历史" : "读取练习历史"}
        </button>
        {history?.nextBeforeId && (
          <button
            type="button"
            className="button secondary"
            disabled={pending}
            onClick={() => void load(true)}
          >
            读取更早练习记录
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="p-notice error">
          {error}。可重新读取。
        </p>
      )}
      {history && (
        <>
          <ol className={styles.history}>
            {history.events.map((event) => (
              <li key={event.id}>
                <strong>
                  {eventLabels[event.type] ?? "练习记录变更"} · {event.actorName} ·{" "}
                  {new Intl.DateTimeFormat("zh-CN", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(event.createdAt))}
                </strong>
                {event.reason && <p>{event.reason}</p>}
                <ul>
                  {event.changes.map((change, index) => (
                    <li key={index}>{change}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
          {!history.events.length && <p className="p-empty">暂无操作历史。</p>}
          {history.attempts.map((attempt) => (
            <details key={attempt.attempt.id}>
              <summary>查看第 {attempt.attempt.sequence} 次提交与反馈记录</summary>
              <PracticeAttemptReading
                detail={attempt}
                context={`历史第 ${attempt.attempt.sequence} 次提交`}
              />
            </details>
          ))}
        </>
      )}
    </div>
  );
}
