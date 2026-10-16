"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/error-message";
export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    reportClientError("page.render", error);
  }, [error]);
  return (
    <main id="main" className="message-page">
      <h1>暂时无法打开页面</h1>
      <p>请稍后重试，或返回列表重新打开。</p>
      <button className="button" onClick={retry}>
        重新加载
      </button>
    </main>
  );
}
