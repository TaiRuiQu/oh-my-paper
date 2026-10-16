"use client";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { reportClientError } from "@/lib/error-message";

export default function PlatformError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    reportClientError("platform.page", error);
  }, [error]);
  return (
    <div className="p-panel p-panel-content">
      <h1>暂时无法打开此页面</h1>
      <p className="p-muted">教学数据加载失败。请重试，或从侧边栏重新选择页面。</p>
      <Button onClick={retry}>重新加载</Button>
    </div>
  );
}
