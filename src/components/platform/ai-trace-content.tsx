"use client";

/* Task images use the authenticated asset endpoint. */
/* eslint-disable @next/next/no-img-element */
import { MarkdownText } from "@/components/markdown-text";
import { normalizeAITraceText } from "@/lib/ai-trace-display";
import styles from "./ai-trace-content.module.css";

const FIELD_LABELS: Record<string, string> = {
  code: "Python 代码",
  command: "命令",
  assets: "源图片",
  assetUrls: "源图片",
  images: "输出图片",
  name: "名称",
  url: "图片",
  subject: "学科",
  grade: "年级",
  kind: "类型",
  questionId: "题目 ID",
  questionIds: "题目 ID",
  paperId: "试卷 ID",
  submissionId: "答卷 ID",
  studentId: "学生 ID",
  itemId: "题目 ID",
  query: "搜索内容",
  sources: "来源清单",
  totalQuestions: "题目总数",
  knowledgeTags: "知识点",
  summary: "说明",
  error: "错误信息",
  message: "说明",
  exitCode: "退出码",
  stdout: "标准输出",
  stderr: "错误输出",
  inputTokens: "输入 Token",
  outputTokens: "输出 Token",
  totalTokens: "总 Token",
  finishReason: "结束原因",
  toolNames: "调用工具",
  usage: "用量",
};

export function AITraceText({ text }: { text: string }) {
  return (
    <div className={styles.prose}>
      <MarkdownText text={normalizeAITraceText(text)} />
    </div>
  );
}

/** Structured values stay readable even when a tool adds fields the UI does not know yet. */
export function AITraceValue({ value, field }: { value: unknown; field?: string }) {
  if (value === null || value === undefined || value === "")
    return <span className={styles.empty}>无</span>;
  if (typeof value === "string") {
    if (["code", "command", "stdout", "stderr"].includes(field ?? ""))
      return (
        <pre tabIndex={0} aria-label={FIELD_LABELS[field!] || field}>
          {value}
        </pre>
      );
    if (/^\/api\/platform\/assets\/[\w-]+$/.test(value))
      return (
        <a className={styles.image} href={value} target="_blank" rel="noreferrer">
          <img src={value} alt="任务图片，点击查看原图" loading="lazy" />
          <span>查看原图</span>
        </a>
      );
    return <AITraceText text={value} />;
  }
  if (Array.isArray(value))
    return value.length ? (
      <ul className={styles.items}>
        {value.map((item, index) => (
          <li key={index}>
            <AITraceValue value={item} field={field} />
          </li>
        ))}
      </ul>
    ) : (
      <span className={styles.empty}>无</span>
    );
  if (typeof value === "object") {
    const entries = Object.entries(value);
    return entries.length ? (
      <dl className={styles.fields}>
        {entries.map(([key, item]) => (
          <div key={key}>
            <dt>{FIELD_LABELS[key] ?? key}</dt>
            <dd>
              <AITraceValue value={item} field={key} />
            </dd>
          </div>
        ))}
      </dl>
    ) : (
      <span className={styles.empty}>无</span>
    );
  }
  return <span>{typeof value === "boolean" ? (value ? "是" : "否") : String(value)}</span>;
}
