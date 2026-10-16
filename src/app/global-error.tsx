"use client";
import { useEffect } from "react";
import { reportClientError } from "@/lib/error-message";
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    reportClientError("page.root.failed", error);
  }, [error]);
  return (
    <html lang="zh-CN">
      <body
        style={{
          margin: 0,
          padding: 32,
          fontFamily: "sans-serif",
          color: "#18181b",
          background: "white",
        }}
      >
        <main>
          <h1>页面加载失败</h1>
          <p>请稍后重试。</p>
          <button onClick={retry}>重新加载</button>
        </main>
      </body>
    </html>
  );
}
