"use client";
import { GradeSelect } from "./grade-select";
import Image from "next/image";
import { useState } from "react";
import {
  SUBJECTS,
  type BankQuestion,
  type PlatformCommand,
  type QuestionContent,
  type QuestionPart,
  type QuestionType,
} from "@/contracts/platform";
import { apiRequest } from "@/lib/http-client";
import { MarkdownText } from "@/components/markdown-text";
import { Field, Panel, Submit, splitList } from "./primitives";
export type Mutate = (command: PlatformCommand) => Promise<{ id?: string; error?: string }>;
export const QUESTION_LABELS: Record<QuestionType, string> = {
  SINGLE: "单选题",
  MULTIPLE: "多选题",
  BLANK: "填空题",
  SUBJECTIVE: "主观题",
  MIXED: "复合题",
};
const freshContent = (): QuestionContent => ({
  stem: "",
  options: [],
  answers: [],
  explanation: "",
  rubric: "",
  parts: [],
  images: [],
});
const freshPart = (): QuestionPart => ({
  id: crypto.randomUUID(),
  type: "BLANK",
  stem: "",
  options: [],
  answers: [],
  explanation: "",
  rubric: "",
  knowledgeTags: [],
  score: 5,
});
function OptionsInput({
  options,
  onChange,
}: {
  options: QuestionContent["options"];
  onChange: (options: QuestionContent["options"]) => void;
}) {
  return (
    <Field label="选项" hint="每行一个选项，按 A、B、C… 顺序自动编号">
      <textarea
        value={options.map((o) => o.text).join("\n")}
        onChange={(e) =>
          onChange(
            e.target.value
              .split("\n")
              .map((text, i) => ({ label: String.fromCharCode(65 + i), text })),
          )
        }
        placeholder="选项 A 的内容\n选项 B 的内容"
      />
    </Field>
  );
}
export function QuestionBody({ question }: { question: BankQuestion }) {
  return (
    <>
      <MarkdownText text={question.content.stem} />
      {question.content.options.length > 0 && (
        <div className="p-options">
          {question.content.options.map((o) => (
            <p key={o.label}>
              {o.label}. {o.text}
            </p>
          ))}
        </div>
      )}
      {question.content.images.map((url, i) => (
        <Image
          unoptimized
          width={1000}
          height={1000}
          key={url}
          src={url}
          alt={`题目材料 ${i + 1}`}
          className="p-scan-image"
        />
      ))}
      {question.content.parts.map((p, i) => (
        <div key={p.id} className="p-question">
          <strong>
            （{i + 1}）{QUESTION_LABELS[p.type]} · {p.score} 分
          </strong>
          <MarkdownText text={p.stem} />
          {p.options.map((o) => (
            <p key={o.label}>
              {o.label}. {o.text}
            </p>
          ))}
        </div>
      ))}
    </>
  );
}
export function QuestionEditor({
  question,
  mutate,
  pending,
  close,
  defaults,
}: {
  defaults?: { subject: string; grade: string };
  question: BankQuestion | null;
  mutate: Mutate;
  pending: boolean;
  close: () => void;
}) {
  const [type, setType] = useState<QuestionType>(question?.type ?? "SINGLE"),
    [content, setContent] = useState(question?.content ?? freshContent());
  const [uploading, setUploading] = useState(false),
    [uploadError, setUploadError] = useState("");
  async function uploadImage(file?: File) {
    if (!file) return;
    setUploading(true);
    setUploadError("");
    try {
      const form = new FormData();
      form.set("file", file);
      const r = await apiRequest<{ url: string }>("/api/platform/assets", {
        method: "POST",
        body: form,
      });
      setContent((current) => ({ ...current, images: [...current.images, r.url] }));
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "图片上传失败");
    } finally {
      setUploading(false);
    }
  }
  const patch = (value: Partial<QuestionContent>) => setContent({ ...content, ...value });
  const patchPart = (index: number, value: Partial<QuestionPart>) =>
    patch({ parts: content.parts.map((p, i) => (i === index ? { ...p, ...value } : p)) });
  return (
    <Panel
      title={question ? "编辑试题" : "创建试题"}
      description="支持 Markdown 和数学公式。填空题的每个答案与题目中的空按顺序对应。"
      actions={
        <button className="button secondary" onClick={close}>
          关闭编辑
        </button>
      }
    >
      <form
        className="p-form"
        onSubmit={async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const d = new FormData(e.currentTarget);
          const result = await mutate({
            type: "question.save",
            question: {
              id: question?.id,
              type,
              subject: String(d.get("subject")),
              grade: String(d.get("grade")),
              difficulty: Number(d.get("difficulty")),
              knowledgeTags: splitList(String(d.get("tags"))),
              content,
            },
          });
          if (result.error) return;
          close();
        }}
      >
        <div className="p-form-grid">
          <Field label="学科">
            <select name="subject" defaultValue={question?.subject ?? defaults?.subject ?? "数学"}>
              {SUBJECTS.filter((s) => !defaults || s === defaults.subject).map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="年级">
            <GradeSelect
              name="grade"
              required
              defaultValue={question?.grade ?? defaults?.grade ?? "高中一年级"}
            />
          </Field>
          <Field label="题型">
            <select value={type} onChange={(e) => setType(e.target.value as QuestionType)}>
              {Object.entries(QUESTION_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="难度（0–1）">
            <input
              type="number"
              name="difficulty"
              min={0}
              max={1}
              step={0.05}
              required
              defaultValue={question?.difficulty ?? 0.5}
            />
          </Field>
        </div>
        <Field label="题干">
          <textarea
            required
            value={content.stem}
            onChange={(e) => patch({ stem: e.target.value })}
            placeholder="输入题目内容，可使用 $...$ 数学公式"
          />
        </Field>
        {(type === "SINGLE" || type === "MULTIPLE") && (
          <OptionsInput options={content.options} onChange={(options) => patch({ options })} />
        )}
        <Field
          label={
            type === "BLANK"
              ? "各空标准答案（每行一个空）"
              : "标准答案（每行一个，选择题填写 A、B 等选项）"
          }
        >
          <textarea
            value={content.answers.join("\n")}
            onChange={(e) => patch({ answers: e.target.value.split("\n").filter(Boolean) })}
          />
        </Field>
        <div className="p-form-grid">
          <Field label="解析">
            <textarea
              value={content.explanation}
              onChange={(e) => patch({ explanation: e.target.value })}
            />
          </Field>
          <Field label="评分标准">
            <textarea
              value={content.rubric}
              onChange={(e) => patch({ rubric: e.target.value })}
              placeholder="列出得分要点与可接受的不同解法"
            />
          </Field>
        </div>
        <Field label="知识点（用逗号分隔）">
          <input name="tags" defaultValue={question?.knowledgeTags.join("，")} />
        </Field>
        <Field label="上传题目配图" hint="支持 PNG、JPG；上传后图片与题目一起保存。">
          <input
            type="file"
            accept="image/png,image/jpeg"
            disabled={uploading}
            onChange={(e) => void uploadImage(e.target.files?.[0])}
          />
        </Field>
        {uploading && (
          <p role="status" className="p-muted">
            正在上传配图…
          </p>
        )}
        {uploadError && (
          <p role="alert" className="field-error">
            {uploadError}
          </p>
        )}
        {content.images.map((url, i) => (
          <div className="p-list-row" key={url}>
            <Image
              unoptimized
              src={url}
              alt={`题目配图 ${i + 1}`}
              width={160}
              height={120}
              style={{ maxWidth: 160, height: "auto" }}
            />
            <button
              type="button"
              className="link-button"
              onClick={() => patch({ images: content.images.filter((_, n) => n !== i) })}
            >
              移除配图
            </button>
          </div>
        ))}
        {type === "MIXED" && (
          <>
            <h3>复合题小问</h3>
            {content.parts.map((p, i) => (
              <section className="p-part" key={p.id}>
                <div className="p-actions">
                  <strong>第 {i + 1} 小问</strong>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => patch({ parts: content.parts.filter((_, n) => n !== i) })}
                  >
                    移除
                  </button>
                </div>
                <div className="p-form-grid">
                  <Field label="小问题型">
                    <select
                      value={p.type}
                      onChange={(e) =>
                        patchPart(i, { type: e.target.value as QuestionPart["type"] })
                      }
                    >
                      {Object.entries(QUESTION_LABELS)
                        .filter(([k]) => k !== "MIXED")
                        .map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field label="小问分值">
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      value={p.score}
                      onChange={(e) => patchPart(i, { score: Number(e.target.value) })}
                    />
                  </Field>
                </div>
                <Field label="小问题干">
                  <textarea
                    value={p.stem}
                    onChange={(e) => patchPart(i, { stem: e.target.value })}
                  />
                </Field>
                {(p.type === "SINGLE" || p.type === "MULTIPLE") && (
                  <OptionsInput
                    options={p.options}
                    onChange={(options) => patchPart(i, { options })}
                  />
                )}
                <Field label="各空答案 / 参考答案（每行一个）">
                  <textarea
                    value={p.answers.join("\n")}
                    onChange={(e) =>
                      patchPart(i, { answers: e.target.value.split("\n").filter(Boolean) })
                    }
                  />
                </Field>
                <Field label="小问评分标准">
                  <input
                    value={p.rubric}
                    onChange={(e) => patchPart(i, { rubric: e.target.value })}
                  />
                </Field>
                <Field label="小问知识点">
                  <input
                    value={p.knowledgeTags.join("，")}
                    onChange={(e) => patchPart(i, { knowledgeTags: splitList(e.target.value) })}
                  />
                </Field>
              </section>
            ))}
            <button
              type="button"
              className="button secondary"
              onClick={() => patch({ parts: [...content.parts, freshPart()] })}
            >
              添加小问
            </button>
          </>
        )}
        <div className="p-actions">
          <Submit pending={pending}>保存试题</Submit>
          <button type="button" className="button secondary" onClick={close}>
            取消
          </button>
        </div>
      </form>
    </Panel>
  );
}
