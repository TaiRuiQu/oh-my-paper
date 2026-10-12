"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MathText } from "./math-text";
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
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => (
            <p>
              {typeof children === "string" ? (
                <MathText text={children} images={images} />
              ) : (
                children
              )}
            </p>
          ),
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          img: ({ src, alt }) => {
            if (
              typeof src !== "string" ||
              !/^\/api\/(exams|practice)\//.test(src)
            )
              return <span>{alt || "图片请参照题目配图"}</span>;
            // eslint-disable-next-line @next/next/no-img-element
            return <img src={src} alt={alt || "题目配图"} loading="lazy" />;
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
