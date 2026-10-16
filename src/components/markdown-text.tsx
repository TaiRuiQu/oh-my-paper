"use client";
/* Authenticated material crops render directly. */
/* eslint-disable @next/next/no-img-element */
import ReactMarkdown from "react-markdown";
import { markdownRemarkPlugins } from "@/lib/markdown-images";
import { MathFormula } from "./math-formula";

export function MarkdownText({ text, imageHref }: { text: string; imageHref?: string }) {
  // Raw HTML stays disabled; only KaTeX writes generated formula markup.
  return (
    <div className="markdown-content">
      <ReactMarkdown
        remarkPlugins={markdownRemarkPlugins}
        components={{
          code: ({ className, children }) => {
            if (!className?.includes("language-math"))
              return <code className={className}>{children}</code>;
            const latex = String(children).replace(/\n$/, "");
            return <MathFormula latex={latex} displayMode={className.includes("math-display")} />;
          },
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          img: ({ src, alt }) => {
            if (imageHref)
              return <a href={imageHref}>图片材料：{alt || "未提供文字描述"}（在试题详情查看）</a>;
            if (typeof src !== "string" || !/^\/api\/platform\/assets\/[a-f0-9-]{36}$/.test(src))
              return <span>{alt || "图片请参照题目配图"}</span>;
            return <img src={src} alt={alt || "题目配图"} loading="lazy" />;
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
