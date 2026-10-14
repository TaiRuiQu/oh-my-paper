"use client";
import Image from "next/image";
import type { BankQuestion, QuestionContent } from "@/contracts/platform";
import { PaperText } from "./document-canvas";

/** The editable canvas and export preview use the same printable text geometry. */
export function DocumentQuestionBody({
  question,
  onChange,
  labelPrefix = "试题",
}: {
  question: BankQuestion;
  labelPrefix?: string;
  onChange?: (value: Partial<QuestionContent>) => void;
}) {
  const { content } = question;
  const readOnly = !onChange;
  const text = (label: string, value: string, change: (value: string) => void) => (
    <PaperText
      label={`${labelPrefix}${label}`}
      value={value}
      readOnly={readOnly}
      onChange={change}
    />
  );
  return (
    <div className="p-document-question-body">
      {text("题干", content.stem, (stem) => onChange?.({ stem }))}
      {content.images.map((url, n) => (
        <Image
          key={url}
          src={url}
          unoptimized
          width={700}
          height={500}
          className="p-document-image"
          alt={`题目材料 ${n + 1}`}
        />
      ))}
      {content.options.map((option, n) => (
        <div className="p-document-option" key={option.label}>
          <span>{option.label}.</span>
          {text(`选项 ${option.label}`, option.text, (value) =>
            onChange?.({
              options: content.options.map((o, i) => (i === n ? { ...o, text: value } : o)),
            }),
          )}
        </div>
      ))}
      {content.parts.map((part, n) => (
        <div className="p-document-part" key={part.id}>
          <strong>（{n + 1}）</strong>
          <small>（{part.score} 分）</small>
          {text(`小问 ${n + 1} 题干`, part.stem, (stem) =>
            onChange?.({ parts: content.parts.map((p, i) => (i === n ? { ...p, stem } : p)) }),
          )}
          {part.options.map((option, index) => (
            <div className="p-document-option" key={option.label}>
              <span>{option.label}.</span>
              {text(`小问 ${n + 1} 选项 ${option.label}`, option.text, (value) =>
                onChange?.({
                  parts: content.parts.map((p, i) =>
                    i === n
                      ? {
                          ...p,
                          options: p.options.map((o, j) =>
                            j === index ? { ...o, text: value } : o,
                          ),
                        }
                      : p,
                  ),
                }),
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function DocumentQuestionHeading({
  index,
  section,
  score,
}: {
  index: number;
  section: string;
  score: number;
}) {
  return (
    <div className="p-document-question-heading">
      <strong>
        {index + 1}. {section}
      </strong>
      <span>{score} 分</span>
    </div>
  );
}
