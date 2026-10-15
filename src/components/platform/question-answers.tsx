"use client";
import type { QuestionContent } from "@/contracts/platform";
import { MarkdownText } from "@/components/markdown-text";

function AnswerDetails({
  answers,
  explanation,
  rubric,
}: Pick<QuestionContent, "answers" | "explanation" | "rubric">) {
  return (
    <>
      <strong>参考答案</strong>
      <MarkdownText text={answers.join("；") || "暂未提供参考答案"} />
      {explanation && (
        <>
          <strong>解析</strong>
          <MarkdownText text={explanation} />
        </>
      )}
      {rubric && (
        <>
          <strong>评分标准</strong>
          <MarkdownText text={rubric} />
        </>
      )}
    </>
  );
}

export function QuestionAnswers({ content }: { content: QuestionContent }) {
  return (
    <div className="p-answers" role="region" aria-label="参考答案与解析">
      {(!content.parts.length ||
        content.answers.length > 0 ||
        content.explanation ||
        content.rubric) && <AnswerDetails {...content} />}
      {content.parts.map((part, index) => (
        <section key={part.id}>
          <h4>
            小问 {index + 1} · {part.score} 分
          </h4>
          <AnswerDetails {...part} />
        </section>
      ))}
    </div>
  );
}
