"use client";
/* eslint-disable @next/next/no-img-element */
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, Circle, LoaderCircle, Terminal, X } from "lucide-react";
import type { AgentEvent, RecognitionActivity } from "@/contracts/activity";
import type { ExamTaskSummary } from "@/contracts/exam-tasks";
import { apiRequest } from "@/lib/http-client";
import { formatTime } from "@/lib/date-time";

const toolNames: Record<string, string> = {
  read_pages: "查看试卷页面",
  inspect_image: "放大图像区域",
  python: "运行 Python 处理图像",
  shell: "运行沙箱命令",
  append_questions: "保存已识别题目",
  report_question_count: "确认试卷题目总数",
  submit_exam: "完成试卷识别",
  list_questions: "查看题目列表",
  read_question: "查看题目与材料",
  append_answers: "保存标准答案",
  submit_answers: "完成答案生成",
  append_grades: "保存批改结果",
  submit_grading: "完成批改",
};
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
function brief(event: AgentEvent) {
  const data = object(event.data);
  if (event.tool === "report_question_count" && typeof data.total === "number")
    return `共 ${data.total} 道题`;
  if (event.tool === "read_pages" && Array.isArray(data.pages))
    return `页面 ${data.pages.map((p) => (typeof p === "number" ? p : object(p).page)).join("、")}`;
  if (event.tool === "inspect_image") return `第 ${object(data.region).page ?? ""} 页`;
  if (Array.isArray(data.sections)) {
    const count = data.sections.reduce((sum, section) => {
      const questions = object(section).questions;
      return sum + (Array.isArray(questions) ? questions.length : 0);
    }, 0);
    return `${data.sections.length} 道大题 · ${count} 道小题`;
  }
  if (typeof data.sections === "number" && typeof data.questions === "number")
    return `${data.sections} 道大题 · ${data.questions} 道小题`;
  if (Array.isArray(data.questions)) return `${data.questions.length} 道题`;
  if (typeof data.questions === "number") return `${data.questions} 道题`;
  if (typeof data.summary === "string") return data.summary;
  return "";
}
type ActivityRound = { first: AgentEvent; events: AgentEvent[] };
function groupRounds(events: AgentEvent[]): ActivityRound[] {
  const rounds: ActivityRound[] = [];
  const steps = new Map<number, ActivityRound>();
  for (const event of events) {
    let round = event.step === undefined ? undefined : steps.get(event.step);
    if (!round) {
      round = { first: event, events: [] };
      rounds.push(round);
      if (event.step !== undefined) steps.set(event.step, round);
    }
    round.events.push(event);
  }
  return rounds;
}
function timeLabel(event: AgentEvent) {
  return formatTime(event.at);
}
export function RecognitionActivityFeed({
  task,
  baseURL = `/api/exams/${task.id}/activity`,
  title = "识别 Agent",
}: {
  task: Pick<ExamTaskSummary, "id" | "status">;
  baseURL?: string;
  title?: string;
}) {
  const cache = useRef<RecognitionActivity>({ attempt: null, events: [], cursor: 0, active: true });
  const [expanded, setExpanded] = useState(false);
  const active = ["QUEUED", "RUNNING"].includes(task.status);
  const activity = useQuery({
    queryKey: ["recognition-activity", task.id, task.status],
    queryFn: async () => {
      const current = cache.current;
      const params = new URLSearchParams({
        after: String(current.cursor),
        attempt: current.attempt ?? "",
      });
      const incoming = await apiRequest<RecognitionActivity>(`${baseURL}?${params}`);
      const events =
        incoming.attempt === current.attempt
          ? [...current.events, ...incoming.events.filter((e) => e.sequence > current.cursor)]
          : incoming.events;
      cache.current = { ...incoming, events };
      return cache.current;
    },
    refetchInterval: active ? 1000 : false,
  });
  const events = activity.data?.events ?? [];
  const calls = events.filter((e) => e.type === "tool_call");
  const rounds = groupRounds(events);
  const visible = active || expanded ? rounds : rounds.slice(-4);
  const attempt = activity.data?.attempt;
  const previewURL = (key: string) => `${baseURL}/images/${key}?attempt=${attempt}`;
  return (
    <section className="agent-activity" aria-labelledby={`agent-activity-heading-${task.id}`}>
      <div className="agent-activity-heading">
        <div>
          <h2 id={`agent-activity-heading-${task.id}`}>{title}</h2>
          <p className="hint">每轮默认折叠，展开查看消息、工具输入与执行结果。</p>
        </div>
        <span className="agent-run-state" role="status">
          {active ? (
            <LoaderCircle className="agent-spinner" size={15} aria-hidden="true" />
          ) : (
            <Terminal size={15} aria-hidden="true" />
          )}
          {active ? "正在处理" : task.status === "FAILED" ? "已停止" : "运行记录"}
          {calls.length > 0 && ` · ${calls.length} 次工具调用`}
        </span>
      </div>
      {activity.error && (
        <p role="alert" className="form-error">
          {activity.error.message}
          <button className="button secondary" onClick={() => void activity.refetch()}>
            重新加载
          </button>
        </p>
      )}
      {!rounds.length && (
        <p className="agent-empty" role="status">
          {active ? "后台开始处理后，工具操作会实时显示在这里。" : "这份试卷没有 Agent 操作记录。"}
        </p>
      )}
      <ol className="agent-event-list" aria-label="Agent 操作记录">
        {visible.map((round) => {
          const { first } = round;
          const roundCalls = round.events.filter((event) => event.type === "tool_call");
          const rejected = round.events.some(
            (event) =>
              event.type === "tool_error" ||
              event.type === "failed" ||
              object(event.data).accepted === false,
          );
          const pending = active && first.step !== undefined && round === rounds.at(-1);
          const description = roundCalls.length
            ? roundCalls.map((event) => toolNames[event.tool ?? ""] ?? event.tool).join("、")
            : (round.events.find((event) => event.type === "message")?.text ?? "等待模型响应");
          return (
            <li
              key={`${attempt}-${first.sequence}`}
              className={rejected ? "agent-round-error" : undefined}
            >
              <details className="agent-round">
                <summary>
                  <span className="agent-round-icon" aria-hidden="true">
                    {rejected ? (
                      <X size={16} />
                    ) : pending ? (
                      <LoaderCircle className="agent-spinner" size={16} />
                    ) : (
                      <Check size={16} />
                    )}
                  </span>
                  <span className="agent-round-label">
                    <strong>
                      {first.step === undefined
                        ? (first.text ?? "任务记录")
                        : `第 ${first.step} 轮`}
                    </strong>
                    {first.step !== undefined && (
                      <span className="agent-round-description">{description}</span>
                    )}
                  </span>
                  <span className="agent-round-meta">
                    <span>
                      {rejected
                        ? "需要修正"
                        : pending
                          ? "处理中"
                          : roundCalls.length
                            ? `${roundCalls.length} 次工具调用`
                            : ""}
                    </span>
                    <time dateTime={first.at}>{timeLabel(first)}</time>
                    <ChevronDown size={14} aria-hidden="true" />
                  </span>
                </summary>
                <ol
                  className="agent-round-events"
                  aria-label={first.step === undefined ? "任务详情" : `第 ${first.step} 轮详情`}
                >
                  {round.events
                    .filter((event) => !["step", "tool_result", "tool_error"].includes(event.type))
                    .map((event) => {
                      const result =
                        event.type === "tool_call"
                          ? events.find(
                              (e) =>
                                e.callId === event.callId &&
                                ["tool_result", "tool_error"].includes(e.type),
                            )
                          : undefined;
                      const output = object(result?.data);
                      const rejected = output.accepted === false || result?.type === "tool_error";
                      const pending = event.type === "tool_call" && !result && active;
                      const images = Array.isArray(output.images)
                        ? output.images.filter((key): key is string => typeof key === "string")
                        : [];
                      return (
                        <li
                          key={`${attempt}-${event.sequence}`}
                          className={`agent-event${rejected || event.type === "failed" ? " agent-event-error" : ""}`}
                        >
                          <div className="agent-event-icon" aria-hidden="true">
                            {pending ? (
                              <LoaderCircle className="agent-spinner" size={16} />
                            ) : rejected || event.type === "failed" ? (
                              <X size={16} />
                            ) : result || event.type === "completed" ? (
                              <Check size={16} />
                            ) : (
                              <Circle size={12} />
                            )}
                          </div>
                          <div className="agent-event-content">
                            {event.type === "tool_call" ? (
                              <details className="agent-tool">
                                <summary>
                                  <span>
                                    <strong>{toolNames[event.tool ?? ""] ?? event.tool}</strong>
                                    <span className="agent-tool-name">{event.tool}</span>
                                    <span className="agent-tool-brief">
                                      {brief(result ?? event)}
                                    </span>
                                  </span>
                                  <span className="agent-tool-meta">
                                    {rejected
                                      ? "需要修正"
                                      : pending
                                        ? "执行中"
                                        : result
                                          ? `${((result.durationMs ?? 0) / 1000).toFixed(1)} 秒`
                                          : "未完成"}
                                    <ChevronDown size={14} aria-hidden="true" />
                                  </span>
                                </summary>
                                <div className="agent-tool-body">
                                  <h3>工具输入</h3>
                                  <pre tabIndex={0} role="region" aria-label="工具输入 JSON">
                                    {JSON.stringify(event.data, null, 2)}
                                  </pre>
                                  {result && (
                                    <>
                                      <h3>执行结果</h3>
                                      <pre tabIndex={0} role="region" aria-label="执行结果 JSON">
                                        {JSON.stringify(result.data, null, 2)}
                                      </pre>
                                    </>
                                  )}
                                  {images.length > 0 && (
                                    <div className="agent-image-previews">
                                      {images.map((key, i) => (
                                        <a
                                          href={previewURL(key)}
                                          target="_blank"
                                          rel="noreferrer"
                                          key={key}
                                          aria-label={`打开工具预览 ${i + 1}`}
                                        >
                                          <img
                                            src={previewURL(key)}
                                            alt={`${toolNames[event.tool!]} · 预览 ${i + 1}`}
                                            loading="lazy"
                                          />
                                        </a>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </details>
                            ) : (
                              <div className="agent-message">
                                <p>{event.text}</p>
                                {event.type === "completed" && (
                                  <p className="hint">{brief(event)}</p>
                                )}
                              </div>
                            )}
                            <time className="agent-event-time" dateTime={event.at}>
                              {timeLabel(event)}
                              {event.step ? ` · 调用 ${event.step}` : ""}
                            </time>
                          </div>
                        </li>
                      );
                    })}
                  {round.events.every((event) => event.type === "step") && (
                    <li className="hint">等待模型响应。</li>
                  )}
                </ol>
              </details>
            </li>
          );
        })}
      </ol>
      {!active && rounds.length > 4 && (
        <button
          type="button"
          className="button secondary agent-history-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "收起较早操作" : `查看全部 ${rounds.length} 条记录`}
        </button>
      )}
      {active && calls.length > 0 && (
        <p className="hint agent-live-note" aria-live="polite">
          已记录 {calls.length} 次工具调用。可以展开操作查看详情，离开后记录仍会保留。
        </p>
      )}
    </section>
  );
}
