"use client";
/* Math SVGs and authenticated crops render directly in isolated image contexts. */
/* eslint-disable @next/next/no-img-element */
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
export function MarkdownText({
  text,
  images = {},
}: {
  text: string;
  images?: Record<string, string>;
}) {
  // Raw HTML stays disabled. Inline prose renders existing isolated math images.
  return (
    <div className="markdown-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        components={{
          code: ({ className, children }) => {
            if (!className?.includes("language-math"))
              return <code className={className}>{children}</code>;
            const latex = String(children).replace(/\n$/, "");
            const source =
              images[latex] ??
              images[latex.trim()] ??
              Object.entries(images).find(([key]) => key.trim() === latex.trim())?.[1];
            // Formulas stay in isolated SVG image contexts, including inside Markdown tables and emphasis.
            return source ? (
              <img
                className={
                  className.includes("math-display")
                    ? "math-image math-display-image"
                    : "math-image"
                }
                src={source}
                alt={latex}
              />
            ) : (
              <code className="math-fallback">{latex}</code>
            );
          },
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          img: ({ src, alt }) => {
            if (typeof src !== "string" || !/^\/api\/(exams|practice)\//.test(src))
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
