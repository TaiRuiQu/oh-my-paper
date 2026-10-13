"use client";
import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { resolveExamLayout, type Exam, type ParsedExam, type ExamLayout } from "@/contracts/exams";
import { apiRequest, jsonBody } from "@/lib/http-client";
import { MarkdownText } from "./markdown-text";

function editable(exam: Exam): ParsedExam {
  return {
    name: exam.name,
    totalScore: exam.totalScore,
    layout: resolveExamLayout(exam.layout),
    sections: exam.sections.map((section) => ({
      number: section.number,
      title: section.title,
      description: section.description,
      score: section.score,
      questions: section.questions.map((question) => ({
        number: question.number,
        description: question.description,
        score: question.score,
        materials: question.materials,
        subquestions: question.subquestions,
      })),
    })),
  };
}
function ScoreField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <label className="field editor-score">
      {label}
      <input
        type="number"
        min="0"
        step="any"
        value={value ?? ""}
        placeholder="未标注"
        onChange={(event) =>
          onChange(event.target.value === "" ? null : Number(event.target.value))
        }
      />
    </label>
  );
}
function TextField({
  label,
  value,
  onChange,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <label className="field editor-text">
      {label}
      <textarea
        rows={4}
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
export function ExamEditor({
  exam,
  taskId,
  onSaved,
  onCancel,
}: {
  exam: Exam;
  taskId: string;
  onSaved: (exam: Exam) => void;
  onCancel: () => void;
}) {
  const client = useQueryClient();
  const [draft, setDraft] = useState(() => editable(exam));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(false);
  function change(edit: (next: ParsedExam) => void) {
    setDraft((before) => {
      const next = structuredClone(before);
      edit(next);
      return next;
    });
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const result = await apiRequest<{ exam: Exam }>(`/api/exams/${taskId}`, {
        method: "PATCH",
        ...jsonBody({ revision: exam.revision ?? 0, exam: draft }),
      });
      await Promise.all([
        client.invalidateQueries({ queryKey: ["exams"] }),
        client.invalidateQueries({ queryKey: ["exam-agents", taskId] }),
      ]);
      onSaved(result.exam);
    } catch (error) {
      setError(error instanceof Error ? error.message : "保存失败，请重试。");
    } finally {
      setPending(false);
    }
  }
  function cancel() {
    if (
      JSON.stringify(draft) !== JSON.stringify(editable(exam)) &&
      !window.confirm("放弃尚未保存的修改？")
    )
      return;
    onCancel();
  }
  return (
    <form className="exam-editor" onSubmit={save} aria-busy={pending}>
      <div className="section-heading">
        <h2>编辑试卷</h2>
        <button
          type="button"
          className="button secondary"
          aria-pressed={preview}
          onClick={() => setPreview(!preview)}
        >
          {preview ? "收起预览" : "预览排版"}
        </button>
      </div>
      <p className="hint">
        题目支持 Markdown 和数学公式，例如 $x^2$。保存后请重新生成或上传标准答案；已有批改记录保留。
      </p>
      <fieldset disabled={pending}>
        <div className="editor-metadata">
          <label className="field editor-name">
            试卷名称
            <input
              required
              maxLength={200}
              value={draft.name}
              onChange={(event) =>
                change((next) => {
                  next.name = event.target.value;
                })
              }
            />
          </label>
          <ScoreField
            label="总分"
            value={draft.totalScore}
            onChange={(value) =>
              change((next) => {
                next.totalScore = value;
              })
            }
          />
        </div>
        <div className="editor-metadata">
          <label className="field">
            导出纸型
            <select
              value={draft.layout?.paperSize}
              onChange={(event) =>
                change((next) => {
                  next.layout = {
                    ...resolveExamLayout(next.layout),
                    paperSize: event.target.value as ExamLayout["paperSize"],
                  };
                })
              }
            >
              <option value="A4">A4</option>
              <option value="A3">A3</option>
            </select>
          </label>
          <label className="field">
            页面方向
            <select
              value={draft.layout?.orientation}
              onChange={(event) =>
                change((next) => {
                  next.layout = {
                    ...resolveExamLayout(next.layout),
                    orientation: event.target.value as ExamLayout["orientation"],
                  };
                })
              }
            >
              <option value="portrait">纵向</option>
              <option value="landscape">横向</option>
            </select>
          </label>
          <label className="field">
            正文分栏
            <select
              value={draft.layout?.columns}
              onChange={(event) =>
                change((next) => {
                  next.layout = {
                    ...resolveExamLayout(next.layout),
                    columns: Number(event.target.value),
                  };
                })
              }
            >
              {[1, 2, 3, 4].map((columns) => (
                <option key={columns} value={columns}>
                  {columns} 栏
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="hint">PDF 和 Word 使用此排版。拍照识别的纸型可能有偏差，可在此调整。</p>
        {draft.sections.map((section, si) => (
          <section
            className="editor-section"
            key={si}
            aria-label={`${section.number}、${section.title}`}
          >
            <h3>
              {section.number}、{section.title}
            </h3>
            <div className="editor-metadata">
              <label className="field editor-name">
                大题标题
                <input
                  required
                  value={section.title}
                  onChange={(event) =>
                    change((next) => {
                      next.sections[si].title = event.target.value;
                    })
                  }
                />
              </label>
              <ScoreField
                label="大题分值"
                value={section.score}
                onChange={(value) =>
                  change((next) => {
                    next.sections[si].score = value;
                  })
                }
              />
            </div>
            <TextField
              label="大题说明"
              value={section.description}
              onChange={(value) =>
                change((next) => {
                  next.sections[si].description = value;
                })
              }
            />
            {section.questions.map((question, qi) => (
              <div className="editor-question" key={qi}>
                <div className="section-heading">
                  <h4>第 {question.number} 题</h4>
                  <ScoreField
                    label={`第 ${question.number} 题分值`}
                    value={question.score}
                    onChange={(value) =>
                      change((next) => {
                        next.sections[si].questions[qi].score = value;
                      })
                    }
                  />
                </div>
                <TextField
                  label={`第 ${question.number} 题题干与选项`}
                  required={!question.subquestions.length}
                  value={question.description}
                  onChange={(value) =>
                    change((next) => {
                      next.sections[si].questions[qi].description = value;
                    })
                  }
                />
                {preview && (
                  <div className="editor-preview">
                    <MarkdownText text={question.description} />
                  </div>
                )}
                {question.materials.length > 0 && (
                  <p className="hint">保留原有 {question.materials.length} 个题目配图。</p>
                )}
                {question.subquestions.map((part, pi) => (
                  <div className="editor-subquestion" key={pi}>
                    <TextField
                      label={`第 ${question.number} 题 ${part.number} 内容`}
                      required
                      value={part.description}
                      onChange={(value) =>
                        change((next) => {
                          next.sections[si].questions[qi].subquestions[pi].description = value;
                        })
                      }
                    />
                    <ScoreField
                      label={`${part.number} 分值`}
                      value={part.score}
                      onChange={(value) =>
                        change((next) => {
                          next.sections[si].questions[qi].subquestions[pi].score = value;
                        })
                      }
                    />
                    {preview && (
                      <div className="editor-preview">
                        <MarkdownText text={part.description} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </section>
        ))}
      </fieldset>
      <div className="editor-actions">
        <button className="button" disabled={pending}>
          {pending ? "正在保存…" : "保存修改"}
        </button>
        <button type="button" className="button secondary" disabled={pending} onClick={cancel}>
          取消编辑
        </button>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}
