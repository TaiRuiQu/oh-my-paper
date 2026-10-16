"use client";

/* Task images use the authenticated asset endpoint. */
/* eslint-disable @next/next/no-img-element */
import { MarkdownText } from "@/components/markdown-text";
import { normalizeAITraceText } from "@/lib/ai-trace-display";
import styles from "./ai-trace-content.module.css";

export function AITraceText({ text }: { text: string }) {
  return (
    <div className={styles.prose}>
      <MarkdownText text={normalizeAITraceText(text)} />
    </div>
  );
}

export function AITraceImages({ urls }: { urls: string[] }) {
  return (
    <ul className={styles.items}>
      {urls.map((url, index) => (
        <li key={url}>
          <a className={styles.image} href={url} target="_blank" rel="noreferrer">
            <img src={url} alt={`相关图片 ${index + 1}，点击查看原图`} loading="lazy" />
            <span>查看原图</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
