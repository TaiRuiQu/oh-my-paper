"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main id="main" className="message-page"><h1>暂时无法打开页面</h1><p>服务连接出现问题，请稍后重试。</p><button className="button" onClick={reset}>重新加载</button></main>;
}
