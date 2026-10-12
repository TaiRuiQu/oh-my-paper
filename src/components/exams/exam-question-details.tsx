"use client";
import { Badge } from "@/components/ui/badge";
import { MarkdownText } from "@/components/markdown-text";
import { QuestionEditor } from "@/components/question-editor";
import type { DigitalExam } from "@/contracts/exams";
import type { ExamTaskSummary } from "@/contracts/exam-tasks";
import type { ExamContentRenderer } from "./content-renderer";

export function ExamQuestionDetails({
  question,
  task,
  renderer,
  images,
  onSaved,
}: {
  question: DigitalExam["questions"][number];
  task: ExamTaskSummary;
  renderer: ExamContentRenderer;
  images: Record<string, string>;
  onSaved: () => Promise<unknown>;
}) {
  const { blocks } = renderer;
  return (
    <article className="exam-question">
      <div className="section-heading">
        <h3>
          {question.section && <span className="muted">{question.section} · </span>}第{" "}
          {question.number} 题
          {question.points !== null && (
            <span className="hint">
              （{question.points} 分）
              {question.pointsOrigin === "inferred" && <span className="hint"> · 推测分值</span>}
            </span>
          )}
        </h3>
        {question.status === "needs_review" && <span className="status-tag warning">需核对</span>}
      </div>
      {blocks(question.blocks, question.id)}
      {question.options.map((option) => (
        <div className="exam-option" key={option.label}>
          <strong>{option.label}.</strong>
          <div>{blocks(option.blocks, `${question.id}-${option.label}`)}</div>
        </div>
      ))}
      {question.parts.map((part, index) => (
        <div className="exam-part" key={index}>
          <strong>
            {part.parentLabel ? `${part.parentLabel} ` : ""}
            {part.label}
          </strong>
          {blocks(part.blocks, `${question.id}-part-${index}`)}
        </div>
      ))}
      {question.regions.length > 1 && (
        <p className="hint">
          本题涉及第 {[...new Set(question.regions.map((r) => r.page))].join("、")}{" "}
          页，请结合原图核对。
        </p>
      )}
      <section className="solution-panel">
        <div className="section-heading">
          <h3>标准答案与解析</h3>
          <Badge variant="secondary">
            {question.solution?.sufficient
              ? question.solution.origin === "teacher"
                ? "参考答案已保存"
                : "已保存"
              : "待补充"}
          </Badge>
        </div>
        {question.solution?.sufficient ? (
          <>
            <div className="solution-answer">
              <strong>
                标准答案
                {question.solution.selectedOptions.length
                  ? ` · ${question.solution.selectedOptions.join("、")}`
                  : ""}
              </strong>
              <MarkdownText text={question.solution.answer} images={images} />
            </div>
            <h4>解题解析</h4>
            <MarkdownText text={question.solution.explanation} images={images} />
            {(question.solution.units?.length ?? 0) > 1 && (
              <details>
                <summary>逐小问与填空答案</summary>
                {question.solution.units!.map((unit) => {
                  const target = question.answerTargets?.find((t) => t.key === unit.targetKey);
                  const label = target
                    ? `${target.parentLabel ?? ""}${target.partLabel ?? ""}${target.blankIndex ? ` 第 ${target.blankIndex} 空` : ""}`
                    : unit.targetKey;
                  return (
                    <div className="exam-part" key={unit.targetKey}>
                      <strong>{label || unit.targetKey}</strong>
                      <MarkdownText text={unit.answer} images={images} />
                      <MarkdownText text={unit.explanation} images={images} />
                    </div>
                  );
                })}
              </details>
            )}
            <details>
              <summary>评分标准</summary>
              <MarkdownText text={question.solution.rubric} images={images} />
            </details>
          </>
        ) : (
          <p className="hint">本题尚无可复用的标准答案，请通过下方编辑补充。</p>
        )}
      </section>
      {task.outputKey && (
        <QuestionEditor
          key={`${question.id}-${task.outputKey}`}
          question={question}
          examId={task.id}
          outputKey={task.outputKey}
          onSaved={onSaved}
        />
      )}
    </article>
  );
}
