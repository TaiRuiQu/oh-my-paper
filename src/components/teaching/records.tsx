"use client";
import { useState } from "react";
import type { TeachingHistory, TeachingSession, TeachingSessionStatus } from "@/contracts/teaching";
import { Field } from "@/components/platform/primitives";
import { apiRequest } from "@/lib/http-client";
import { TeachingActionForm } from "./action-form";
import { useTeaching } from "./provider";
import { PlanReading } from "./plan";
import { AttendanceReading } from "./attendance";
import styles from "./teaching.module.css";

export const sessionLabels: Record<TeachingSessionStatus, string> = {
  NOT_STARTED: "未开始",
  IN_PROGRESS: "正在授课",
  COMPLETED: "已完成",
  INTERRUPTED: "已中断",
  CANCELLED: "已取消",
};
export function RecordEditor({
  session,
  mode,
  close,
}: {
  session: TeachingSession;
  mode: "finish" | "correct" | "interrupt" | "resume" | "cancel" | "rebind";
  close: () => void;
}) {
  const { session: current } = useTeaching();
  const [summary, setSummary] = useState(mode === "correct" ? session.summary : ""),
    [reflection, setReflection] = useState(mode === "correct" ? session.reflection : ""),
    [reason, setReason] = useState("");
  const labels = {
    finish: "结束课堂并保存记录",
    correct: "保存授课记录更正",
    interrupt: "记录中断课堂",
    resume: "恢复课堂",
    cancel: "取消本次课堂",
    rebind: "接受最新课程安排",
  };
  const allowed =
    mode === "correct"
      ? current?.canCorrect
      : mode === "finish"
        ? current?.canFinish
        : mode === "rebind"
          ? current?.canRebind
          : mode === "cancel"
            ? current?.canCancel
            : current?.canTakeAttendance;
  return (
    <TeachingActionForm
      allowed={!!allowed}
      dirty={
        !!reason ||
        summary !== (mode === "correct" ? session.summary : "") ||
        reflection !== (mode === "correct" ? session.reflection : "")
      }
      submitLabel={labels[mode]}
      onSaved={close}
      onReload={close}
      onCancel={close}
      command={() => {
        const base = { sessionId: session.id, expectedVersion: session.version };
        if (mode === "finish")
          return { ...base, type: "teaching.session.finish", summary, reflection };
        if (mode === "correct")
          return {
            ...base,
            type: "teaching.session.correct",
            summary,
            reflection,
            reason,
            marks: [],
          };
        if (mode === "rebind")
          return {
            ...base,
            type: "teaching.session.rebind",
            publicationId: session.currentSchedule!.publicationId,
            reason,
          };
        return {
          ...base,
          type:
            mode === "interrupt"
              ? "teaching.session.interrupt"
              : mode === "resume"
                ? "teaching.session.resume"
                : "teaching.session.cancel",
          reason,
        };
      }}
    >
      {(mode === "finish" || mode === "correct") && (
        <>
          <Field label="实际授课进度与总结">
            <textarea
              required={mode === "finish"}
              maxLength={20000}
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              placeholder="记录实际完成内容、未完成活动及下一步安排"
            />
          </Field>
          <Field label="课后反思">
            <textarea
              required={mode === "finish"}
              maxLength={20000}
              value={reflection}
              onChange={(event) => setReflection(event.target.value)}
              placeholder="记录有效做法、学生反应和下一次需要调整的内容"
            />
          </Field>
        </>
      )}
      {mode === "finish" && (
        <p className={styles.help}>
          结束前请保存点名，所有本次参与成员都须有明确出勤状态。结束时间由系统记录。
        </p>
      )}
      {mode === "rebind" && (
        <>
          <p className="p-notice">
            确认后改用最新发布的课程安排；已有教案和名单保留历史，需要重新核对确认。
          </p>
          <ScheduleComparison session={session} />
        </>
      )}
      {mode !== "finish" && (
        <Field
          label={
            {
              correct: "记录更正原因",
              interrupt: "课堂中断原因",
              resume: "恢复授课原因",
              cancel: "取消课堂原因",
              rebind: "接受安排变更的原因",
            }[mode]
          }
        >
          <textarea
            required
            maxLength={2000}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
      )}
    </TeachingActionForm>
  );
}

export function ScheduleComparison({ session }: { session: TeachingSession }) {
  return (
    <div
      className={styles.tableRegion}
      role="region"
      aria-label="原安排与最新发布安排"
      tabIndex={0}
    >
      <table className={styles.table}>
        <thead>
          <tr>
            <th>安排</th>
            <th>发布日期版本</th>
            <th>日期 / 时间</th>
            <th>教师 / 教室 / 状态</th>
          </tr>
        </thead>
        <tbody>
          {(
            [
              ["本次已绑定", session.binding],
              ["最新发布", session.currentSchedule],
            ] as const
          ).map(([label, binding]) =>
            binding ? (
              binding.lessons.map((lesson, index) => (
                <tr key={`${label}/${index}`}>
                  <td>{label}</td>
                  <td>v{binding.publicationRevision}</td>
                  <td>
                    {lesson.date} {lesson.startTime}–{lesson.endTime}
                    <small>{lesson.periodNames.join("、")}</small>
                  </td>
                  <td>
                    {lesson.teacherName} · {lesson.roomName ?? "未指定教室"}
                    <small>
                      {lesson.status === "CANCELLED" ? "已取消" : "安排上课"}
                      {lesson.reason && ` · ${lesson.reason}`}
                    </small>
                  </td>
                </tr>
              ))
            ) : (
              <tr key={label}>
                <td>{label}</td>
                <td colSpan={3}>最新发布中已无对应课次，请联系教务管理人员核对。</td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

const eventLabels: Record<string, string> = {
  "teaching.session.prepare": "建立课堂",
  "teaching.session.rebind": "接受课程安排",
  "teaching.plan.save": "保存教案草稿",
  "teaching.plan.confirm": "确认教案",
  "teaching.roster.confirm": "确认课堂名单",
  "teaching.roster.update": "调整课堂名单",
  "teaching.attendance.save": "保存点名",
  "teaching.session.start": "开始授课",
  "teaching.session.finish": "结束课堂",
  "teaching.session.interrupt": "中断课堂",
  "teaching.session.resume": "恢复课堂",
  "teaching.session.cancel": "取消课堂",
  "teaching.session.correct": "更正授课记录",
  PREPARE: "建立课堂",
  REBIND: "接受课程安排",
  PLAN_SAVE: "保存教案草稿",
  PLAN_CONFIRM: "确认教案",
  ROSTER_CONFIRM: "确认课堂名单",
  ROSTER_UPDATE: "调整课堂名单",
  ATTENDANCE_SAVE: "保存点名",
  START: "开始授课",
  FINISH: "结束课堂",
  INTERRUPT: "中断课堂",
  RESUME: "恢复课堂",
  CANCEL: "取消课堂",
  CORRECT: "更正授课记录",
};
export function TeachingHistoryView({ session }: { session: TeachingSession }) {
  const [history, setHistory] = useState<TeachingHistory | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  async function load(older = false) {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ limit: "20" });
      if (older && history?.nextBeforeVersion)
        query.set("beforeVersion", String(history.nextBeforeVersion));
      const next = await apiRequest<TeachingHistory>(
        `/api/platform/teaching/sessions/${session.id}/history?${query}`,
      );
      setHistory((previous) =>
        older && previous
          ? {
              ...next,
              events: [...previous.events, ...next.events],
              plans: [
                ...new Map(
                  [...previous.plans, ...next.plans].map((plan) => [plan.id, plan]),
                ).values(),
              ],
            }
          : next,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "教学历史读取失败，请重试。");
    } finally {
      setLoading(false);
    }
  }
  const date = (value: string) =>
    new Intl.DateTimeFormat("zh-CN", {
      timeZone: session.binding.timezone,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  return (
    <div className={styles.stack}>
      <div className="p-actions">
        <button
          type="button"
          className="button secondary"
          disabled={loading}
          onClick={() => load()}
        >
          {loading ? "正在读取历史…" : history ? "重新读取教学历史" : "读取教学历史"}
        </button>
        {history?.nextBeforeVersion && (
          <button
            type="button"
            className="button secondary"
            disabled={loading}
            onClick={() => load(true)}
          >
            读取更早记录
          </button>
        )}
      </div>
      {error && (
        <p className="p-notice error" role="alert">
          {error}。可重新读取，已有历史仍保留。
        </p>
      )}
      {history && (
        <>
          <ol className={styles.history}>
            {history.events.map((event) => (
              <li key={event.id}>
                <strong>
                  记录 v{event.version} ·{" "}
                  {eventLabels[event.type] ??
                    eventLabels[
                      event.type.replace("teaching.", "").replaceAll(".", "_").toUpperCase()
                    ] ??
                    "教学记录变更"}
                </strong>
                <p>
                  {event.actorName} · {date(event.createdAt)}
                </p>
                {event.reason && <p>原因：{event.reason}</p>}
                <details>
                  <summary>查看此版本课堂记录</summary>
                  <p>
                    {sessionLabels[event.snapshot.status]} · 教案 v{event.snapshot.planVersion} /
                    已确认 {event.snapshot.confirmedPlanVersion ?? "无"}
                  </p>
                  <p className={styles.readOnlyText}>{event.snapshot.summary || "尚无授课总结"}</p>
                  <p className={styles.readOnlyText}>
                    {event.snapshot.reflection || "尚无课后反思"}
                  </p>
                  <AttendanceReading
                    session={event.snapshot}
                    regionLabel={`历史记录 v${event.version} · 已保存课堂出勤`}
                  />
                </details>
              </li>
            ))}
          </ol>
          {!history.events.length && <p className="p-empty">尚无教学变更记录。</p>}
          <section>
            <h3>教案版本</h3>
            {history.plans.map((plan) => (
              <details className={styles.section} key={plan.id}>
                <summary>
                  教案 v{plan.version} · {plan.source === "AI" ? "AI 草稿，需人工核对" : "人工编写"}{" "}
                  · {plan.actorName} · {date(plan.createdAt)}
                </summary>
                <PlanReading plan={plan.plan} />
              </details>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
