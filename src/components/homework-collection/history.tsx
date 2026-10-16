"use client";
import { useRef, useState } from "react";
import type { HomeworkHistory, HomeworkAttempt } from "@/contracts/homework";
import { apiRequest } from "@/lib/http-client";
import { QuestionMaterialGallery } from "@/components/platform/question-materials";
import styles from "./homework.module.css";
const labels: Record<string, string> = {
  "homework.issue": "发放作业",
  "homework.settings": "修改收交设置",
  "homework.close": "关闭提交",
  "homework.reopen": "重新开放提交",
  "homework.cancel": "撤回作业",
  "homework.roster.sync": "同步本次名单",
  "homework.draft.save": "保存本人草稿",
  "homework.submit": "提交作业",
  "homework.return": "退回修改",
  "homework.deadline.extend": "延长个人截止时间",
};
export function AttemptReading({
  attempt,
  context = "",
}: {
  attempt: HomeworkAttempt;
  context?: string;
}) {
  return (
    <section>
      <p>
        第 {attempt.sequence} 次提交 · {attempt.late ? "迟交" : "按时提交"} ·{" "}
        {attempt.status === "RETURNED" ? "已退回" : "已提交"}
      </p>
      <p>试卷：{attempt.paperName}</p>
      {attempt.returnReason && <p>退回原因：{attempt.returnReason}</p>}
      {attempt.answers.map((answer) => (
        <div className={styles.question} key={answer.itemId}>
          <strong>提交记录第 {answer.questionNumber} 题作答</strong>
          <p className={styles.answer}>
            {answer.submitted ? answer.text || "未填写文字" : "本次未提交本题作答。"}
          </p>
          <QuestionMaterialGallery
            images={answer.images}
            label={`${context}第 ${attempt.sequence} 次提交第 ${answer.questionNumber} 题作答图像材料`}
          />
        </div>
      ))}
    </section>
  );
}
export function HomeworkHistoryView({
  assignmentId,
  workId,
  timezone,
  context = "",
}: {
  assignmentId: string;
  workId?: string;
  timezone: string;
  context?: string;
}) {
  const [history, setHistory] = useState<HomeworkHistory | null>(null),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false);
  const locked = useRef(false);
  async function load(older = false) {
    if (locked.current) return;
    locked.current = true;
    setPending(true);
    setError("");
    try {
      const query = new URLSearchParams({
        limit: "20",
        ...(workId ? { workId } : {}),
        ...(older && history?.nextBeforeId ? { beforeId: history.nextBeforeId } : {}),
      });
      const result = await apiRequest<HomeworkHistory>(
        `/api/platform/homework/assignments/${assignmentId}/history?${query}`,
      );
      setHistory((previous) =>
        older && previous
          ? {
              ...result,
              events: [...previous.events, ...result.events],
              attempts: [
                ...new Map(
                  [...previous.attempts, ...result.attempts].map((attempt) => [
                    attempt.id,
                    attempt,
                  ]),
                ).values(),
              ],
            }
          : result,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "作业历史读取失败。");
    } finally {
      locked.current = false;
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
          onClick={() => load()}
        >
          {pending ? "正在读取历史…" : history ? "重新读取作业历史" : "读取作业历史"}
        </button>
        {history?.nextBeforeId && (
          <button
            type="button"
            className="button secondary"
            disabled={pending}
            onClick={() => load(true)}
          >
            读取更早历史
          </button>
        )}
      </div>
      {error && (
        <p className="p-notice error" role="alert">
          {error}。可重新读取，已显示历史仍保留。
        </p>
      )}
      {history && (
        <>
          <ol className={styles.history}>
            {history.events.map((event) => (
              <li key={event.id}>
                <strong>{labels[event.type] ?? "作业记录变更"}</strong>
                <p>
                  {event.actorName} ·{" "}
                  {new Intl.DateTimeFormat("zh-CN", {
                    timeZone: timezone,
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(event.createdAt))}
                </p>
                {event.reason && <p>原因：{event.reason}</p>}
                <ul>
                  {event.changes.map((change, index) => (
                    <li key={index}>{change}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
          {!history.events.length && <p className="p-empty">暂无历史记录。</p>}
          {history.attempts.map((attempt, index) => (
            <details key={attempt.id}>
              <summary>查看第 {attempt.sequence} 次提交原文与图片</summary>
              <AttemptReading
                attempt={attempt}
                context={`${context}${workId ? "" : `第 ${index + 1} 条记录`}`}
              />
            </details>
          ))}
        </>
      )}
    </div>
  );
}
