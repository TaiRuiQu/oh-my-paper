"use client";

import { useId } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { QuestionContent } from "@/contracts/platform";
import styles from "./question-options-editor.module.css";

type ChoiceContent = Pick<QuestionContent, "options" | "answers">;
const labelFor = (index: number) => String.fromCharCode(65 + index);

export function QuestionOptionsEditor({
  options,
  answers,
  multiple,
  onChange,
}: ChoiceContent & { multiple: boolean; onChange: (value: ChoiceContent) => void }) {
  const id = useId();
  const choices = options.length
    ? options
    : Array.from({ length: 4 }, (_, index) => ({ label: labelFor(index), text: "" }));
  return (
    <fieldset className={styles.editor}>
      <legend>选项与正确答案</legend>
      <p className={styles.hint}>
        {multiple ? "填写选项，勾选所有正确答案。" : "填写选项，选中一个正确答案。"}
      </p>
      <div className={styles.choices}>
        {choices.map((option, index) => (
          <div className={styles.choice} key={index}>
            <label htmlFor={`${id}-${index}`} className={styles.label}>
              选项 {option.label}
            </label>
            <textarea
              id={`${id}-${index}`}
              rows={1}
              required
              value={option.text}
              placeholder="填写选项内容"
              onChange={(event) =>
                onChange({
                  options: choices.map((choice, position) =>
                    position === index ? { ...choice, text: event.target.value } : choice,
                  ),
                  answers,
                })
              }
            />
            <label className={styles.answer}>
              <input
                type={multiple ? "checkbox" : "radio"}
                name={`${id}-answer`}
                value={option.label}
                aria-label={`选项 ${option.label} 为正确答案`}
                checked={answers.includes(option.label)}
                onChange={(event) =>
                  onChange({
                    options: choices,
                    answers: multiple
                      ? choices
                          .filter((choice) =>
                            choice.label === option.label
                              ? event.target.checked
                              : answers.includes(choice.label),
                          )
                          .map((choice) => choice.label)
                      : [option.label],
                  })
                }
              />
              正确答案
            </label>
            <button
              type="button"
              className={styles.remove}
              aria-label={`删除选项 ${option.label}`}
              disabled={choices.length <= 2}
              title={choices.length <= 2 ? "选择题至少保留两个选项" : `删除选项 ${option.label}`}
              onClick={() => {
                const remaining = choices.filter((_, position) => position !== index);
                onChange({
                  options: remaining.map((choice, position) => ({
                    ...choice,
                    label: labelFor(position),
                  })),
                  answers: remaining.flatMap((choice, position) =>
                    answers.includes(choice.label) ? [labelFor(position)] : [],
                  ),
                });
              }}
            >
              <Trash2 size={14} aria-hidden="true" />
              删除
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className={`button secondary ${styles.add}`}
        disabled={choices.length >= 26}
        onClick={() =>
          onChange({
            options: [...choices, { label: labelFor(choices.length), text: "" }],
            answers,
          })
        }
      >
        <Plus size={15} aria-hidden="true" />
        添加选项
      </button>
    </fieldset>
  );
}
