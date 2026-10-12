"use client";
/* eslint-disable @next/next/no-img-element */
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, Circle, LoaderCircle, Terminal, X } from "lucide-react";
import type { AgentEvent, RecognitionActivity } from "@/contracts/recognition";
import type { ExamTaskSummary } from "@/contracts/exam-tasks";
import { apiRequest } from "@/lib/http-client";

const toolNames: Record<string, string> = {
  read_pages: "查看页面",
  inspect_image: "检查图像细节",
  rotate_page: "调整页面方向",
  save_document: "记录文档与材料",
  save_questions: "保存识别题目",
  save_annotations: "分离作答与参考答案",
  finish: "校验识别结果",
  review_questions: "对照原图核对题目",
  review_annotations: "对照原图核对作答与批注",
  read_text: "读取区域文字",
  read_saved: "查看已保存内容",
  revise_question: "修正已保存题目",
};
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
function brief(event: AgentEvent) {
  const data = object(event.data);
  if (event.tool === "read_pages" && Array.isArray(data.pages))
    return `页面 ${data.pages.map((p) => (typeof p === "number" ? p : object(p).page)).join("、")}`;
  if (event.tool === "inspect_image")
    return `第 ${object(data.region).page ?? ""} 页 · ${String(data.operation ?? "")}${data.library ? ` · ${data.library}` : ""}`;
  if (event.tool === "rotate_page")
    return `第 ${data.page ?? ""} 页 · ${data.rotation ?? data.degrees ?? ""}°`;
  if (Array.isArray(data.questions)) return `${data.questions.length} 道题`;
  if (Array.isArray(data.annotations)) return `${data.annotations.length} 条记录`;
  if (typeof data.totalQuestions === "number") return `已保存 ${data.totalQuestions} 道题`;
  if (typeof data.summary === "string") return data.summary;
  return "";
}
export function RecognitionActivityFeed({ task }: { task: ExamTaskSummary }) {
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
      const incoming = await apiRequest<RecognitionActivity>(
        `/api/exams/${task.id}/activity?${params}`,
      );
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
  const rows = events.filter((e) => !["tool_result", "tool_error", "step"].includes(e.type));
  const visible = active || expanded ? rows : rows.slice(-4);
  const attempt = activity.data?.attempt;
  const previewURL = (key: string) =>
    `/api/exams/${task.id}/activity/images/${key.startsWith("pages/") ? `page-${key.slice(6)}` : key.slice(6)}?attempt=${attempt}`;
  return (
    <section className="agent-activity" aria-labelledby="agent-activity-heading">
      <div className="agent-activity-heading">
        <div>
          <h2 id="agent-activity-heading">识别 Agent</h2>
          <p className="hint">查看 AI 的操作、工具输入与执行结果。</p>
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
          操作记录暂时无法更新。
          <button className="text-button" onClick={() => void activity.refetch()}>
            重新加载
          </button>
        </p>
      )}
      {!rows.length && (
        <p className="agent-empty" role="status">
          {active ? "后台开始处理后，工具操作会实时显示在这里。" : "这份试卷没有 Agent 操作记录。"}
        </p>
      )}
      <ol className="agent-event-list" aria-label="Agent 操作记录">
        {visible.map((event) => {
          const result =
            event.type === "tool_call"
              ? events.find(
                  (e) =>
                    e.callId === event.callId && ["tool_result", "tool_error"].includes(e.type),
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
                  <details className="agent-tool" open={pending || rejected}>
                    <summary>
                      <span>
                        <strong>{toolNames[event.tool ?? ""] ?? event.tool}</strong>
                        <span className="agent-tool-name">{event.tool}</span>
                        <span className="agent-tool-brief">{brief(result ?? event)}</span>
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
                      <pre tabIndex={0} aria-label="工具输入 JSON">
                        {JSON.stringify(event.data, null, 2)}
                      </pre>
                      {result && (
                        <>
                          <h3>执行结果</h3>
                          <pre tabIndex={0} aria-label="执行结果 JSON">
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
                      <p className="hint">
                        {String(object(event.data).questions ?? 0)} 道题 ·{" "}
                        {String(object(event.data).figures ?? 0)} 张配图
                      </p>
                    )}
                  </div>
                )}
                <time className="agent-event-time" dateTime={event.at}>
                  {new Date(event.at).toLocaleTimeString("zh-CN", { hour12: false })}
                  {event.step ? ` · 调用 ${event.step}` : ""}
                </time>
              </div>
            </li>
          );
        })}
      </ol>
      {!active && rows.length > 4 && (
        <button
          type="button"
          className="text-button agent-history-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "收起较早操作" : `查看全部 ${calls.length} 次工具调用`}
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
