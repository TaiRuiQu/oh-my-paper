"use client";

import { useEffect, useRef, useState } from "react";
import type { SchoolSchedule, SchoolTerm } from "@/contracts/school";
import { Empty, Field } from "@/components/platform/primitives";
import { SchoolPanel as Panel } from "./school-panel";
import { apiRequest } from "@/lib/http-client";
import styles from "./school.module.css";

export function schoolToday(timezone: string, now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
function offsetDate(date: string, offset: number) {
  const result = new Date(`${date}T12:00:00Z`);
  result.setUTCDate(result.getUTCDate() + offset);
  return result.toISOString().slice(0, 10);
}
export function SchoolScheduleView({ term }: { term: SchoolTerm }) {
  const [start, setStart] = useState(() => schoolToday(term.timezone));
  const [mode, setMode] = useState<"day" | "week">("day");
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | { kind: "success"; data: SchoolSchedule }
  >({ kind: "loading" });
  const serial = useRef(0);
  const end = offsetDate(start, mode === "week" ? 6 : 0);
  const requestKey = `${term.id}/${term.publishedRevision}/${start}/${end}/${attempt}`;
  const [resultKey, setResultKey] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const request = ++serial.current;
    apiRequest<SchoolSchedule>(
      `/api/platform/school/schedule?${new URLSearchParams({ termId: term.id, startDate: start, endDate: end })}`,
      { signal: controller.signal },
    )
      .then((data) => {
        if (!controller.signal.aborted && request === serial.current) {
          setResultKey(requestKey);
          setResult({ kind: "success", data });
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted && request === serial.current) {
          setResultKey(requestKey);
          setResult({
            kind: "error",
            message: cause instanceof Error ? cause.message : "课表读取失败，请重试。",
          });
        }
      });
    return () => controller.abort();
  }, [term.id, start, end, requestKey]);
  return (
    <Panel
      title="已发布课程"
      description={`日期按学校时区 ${term.timezone} 显示；仅显示当前账号有权查看的课程。未发布草稿不会出现在这里。`}
    >
      <div className={styles.scheduleControls}>
        <Field label="课程起始日期">
          <input
            type="date"
            value={start}
            required
            onChange={(event) => {
              if (event.target.value) setStart(event.target.value);
            }}
          />
        </Field>
        <Field label="查看范围">
          <select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}>
            <option value="day">当天</option>
            <option value="week">连续一周</option>
          </select>
        </Field>
        <div className="p-actions">
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              setStart(schoolToday(term.timezone));
              setMode("day");
              setAttempt((current) => current + 1);
            }}
          >
            今天
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              const today = schoolToday(term.timezone);
              const day = new Date(`${today}T12:00:00Z`).getUTCDay();
              setStart(offsetDate(today, -(day === 0 ? 6 : day - 1)));
              setMode("week");
            }}
          >
            本周
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={() => setStart(offsetDate(start, mode === "week" ? -7 : -1))}
          >
            上一{mode === "week" ? "周" : "天"}
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={() => setStart(offsetDate(start, mode === "week" ? 7 : 1))}
          >
            下一{mode === "week" ? "周" : "天"}
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={resultKey !== requestKey}
            onClick={() => setAttempt((current) => current + 1)}
          >
            重新读取课表
          </button>
        </div>
      </div>
      <p>
        {start}
        {end !== start ? ` 至 ${end}` : ""} · {term.name}
      </p>
      {resultKey !== requestKey || result.kind === "loading" ? (
        <p role="status">正在读取课程…</p>
      ) : result.kind === "error" ? (
        <div className="p-notice error" role="alert">
          <p>{result.message}</p>
          <button
            type="button"
            className="button secondary"
            onClick={() => setAttempt((current) => current + 1)}
          >
            重试读取课表
          </button>
        </div>
      ) : result.data.status === "UNPUBLISHED" ? (
        <Empty>本学期课表尚未发布。请联系学校教务管理人员。</Empty>
      ) : (
        <>
          <p className={styles.version}>
            已发布版本 v{result.data.revision} · {result.data.timezone}
          </p>
          {!result.data.lessons.length ? (
            <Empty>这段时间没有可查看的已发布课程。</Empty>
          ) : (
            <div
              className={styles.tableRegion}
              role="region"
              aria-label="已发布课程表"
              tabIndex={0}
            >
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>日期 / 时间</th>
                    <th>课程 / 班级</th>
                    <th>教师 / 教室</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.lessons.map((lesson) => (
                    <tr key={lesson.id}>
                      <td>
                        {lesson.date}
                        <br />
                        {lesson.startTime}–{lesson.endTime}
                        <br />
                        <small>{lesson.periodNames.join("、")}</small>
                      </td>
                      <td>
                        <strong>{lesson.courseName}</strong>
                        <br />
                        {lesson.classroomName}
                      </td>
                      <td>
                        {lesson.teacherName}
                        <br />
                        {lesson.roomName ?? "未指定教室"}
                      </td>
                      <td>
                        {lesson.status === "CANCELLED" ? "已取消" : "正常上课"}
                        {lesson.originalDate !== lesson.date && (
                          <p>原日期：{lesson.originalDate}</p>
                        )}
                        {lesson.reason && <p>{lesson.reason}</p>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
