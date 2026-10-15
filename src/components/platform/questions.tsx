"use client";
import { GradeSelect } from "./grade-select";
import Image from "next/image";
import { useRef, useState } from "react";
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
import { Field, Panel, Submit } from "./primitives";
import { StringListEditor } from "./editable-list";
import { QuestionOptionsEditor } from "./question-options-editor";
import { useUnsavedChanges } from "./use-unsaved-changes";
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
  onSaved,
  defaults,
}: {
  defaults?: { subject: string; grade: string };
  question: BankQuestion | null;
  mutate: Mutate;
  pending: boolean;
  close: () => void;
  onSaved?: (result: Awaited<ReturnType<Mutate>>) => void;
}) {
  const [type, setType] = useState<QuestionType>(question?.type ?? "SINGLE"),
    [content, setContent] = useState(question?.content ?? freshContent());
  const [knowledgeTags, setKnowledgeTags] = useState(question?.knowledgeTags ?? []);
  const [dirty, setDirty] = useState(false);
  const { confirmDiscard, markSaved } = useUnsavedChanges(
    dirty,
    "有未保存的试题修改，离开后会丢失。确定离开？",
  );
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const uploadInFlight = useRef(false);
  const [uploadFile, setUploadFile] = useState<File>();
  const [saveError, setSaveError] = useState("");
  const [uploading, setUploading] = useState(false),
    [uploadError, setUploadError] = useState("");
  async function uploadImage(file?: File) {
    if (!file || uploadInFlight.current) return;
    uploadInFlight.current = true;
    setDirty(true);
    setUploadFile(file);
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
      setUploadFile(undefined);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "图片上传失败");
    } finally {
      uploadInFlight.current = false;
      setUploading(false);
    }
  }
  const patch = (value: Partial<QuestionContent>) => {
    setDirty(true);
    setContent((current) => ({ ...current, ...value }));
  };
  const patchPart = (index: number, value: Partial<QuestionPart>) =>
    patch({ parts: content.parts.map((p, i) => (i === index ? { ...p, ...value } : p)) });
  const cancel = () => {
    if (!submitting.current && confirmDiscard()) close();
  };
  function changeType(next: QuestionType, partIndex?: number) {
    const current = partIndex === undefined ? content : content.parts[partIndex];
    const previous = partIndex === undefined ? type : content.parts[partIndex].type;
    const wasChoice = previous === "SINGLE" || previous === "MULTIPLE";
    const isChoice = next === "SINGLE" || next === "MULTIPLE";
    const effects: string[] = [];
    if (partIndex === undefined && next !== "MIXED" && content.parts.length)
      effects.push("移除已有小问及其答案");
    if (wasChoice && !isChoice && current.options.some((option) => option.text.trim()))
      effects.push("移除选择题选项");
    if (wasChoice !== isChoice && current.answers.length) effects.push("清空原题型的答案");
    if (next === "SINGLE" && wasChoice && current.answers.length > 1)
      effects.push("仅保留第一个正确答案");
    if (effects.length && !window.confirm(`切换题型将${effects.join("、")}。确定切换？`)) return;
    const update = {
      options: isChoice ? current.options : [],
      answers:
        wasChoice !== isChoice
          ? []
          : next === "SINGLE"
            ? current.answers.slice(0, 1)
            : current.answers,
    };
    if (partIndex === undefined) {
      setType(next);
      patch({ ...update, parts: next === "MIXED" ? content.parts : [] });
    } else {
      patchPart(partIndex, { ...update, type: next as QuestionPart["type"] });
    }
  }
  return (
    <Panel
      title={question ? "编辑试题" : "创建试题"}
      description="填写题干、选项与答案，也可上传配图。选择题可直接勾选正确答案。"
      actions={
        <button
          type="button"
          className="button secondary"
          disabled={saving || pending}
          onClick={cancel}
        >
          关闭编辑
        </button>
      }
    >
      <form
        className="p-form"
        onChange={(event) => {
          const field = event.target;
          if (
            (field instanceof HTMLInputElement || field instanceof HTMLSelectElement) &&
            ["subject", "grade", "difficulty"].includes(field.name)
          )
            setDirty(true);
        }}
        onSubmit={async (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (submitting.current || pending || uploadInFlight.current || uploadFile) return;
          submitting.current = true;
          setSaving(true);
          setSaveError("");
          const d = new FormData(e.currentTarget);
          let saved = false;
          try {
            const result = await mutate({
              type: "question.save",
              question: {
                id: question?.id,
                type,
                subject: String(d.get("subject")),
                grade: String(d.get("grade")),
                difficulty: Number(d.get("difficulty")),
                knowledgeTags,
                content: {
                  ...content,
                  options: type === "SINGLE" || type === "MULTIPLE" ? content.options : [],
                  parts:
                    type === "MIXED"
                      ? content.parts.map((part) => ({
                          ...part,
                          options:
                            part.type === "SINGLE" || part.type === "MULTIPLE" ? part.options : [],
                        }))
                      : [],
                },
              },
            });
            if (result.error) {
              setSaveError(result.error);
              return;
            }
            saved = true;
            markSaved();
            setDirty(false);
            if (onSaved) onSaved(result);
            else close();
          } catch (error) {
            setSaveError(error instanceof Error ? error.message : "试题保存失败，请重试。");
          } finally {
            submitting.current = saved;
            setSaving(saved);
          }
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
          <Field label="适用年级">
            <GradeSelect
              name="grade"
              required
              defaultValue={question?.grade ?? defaults?.grade ?? "高中一年级"}
            />
          </Field>
          <Field label="题型">
            <select
              value={type}
              onChange={(e) => {
                changeType(e.target.value as QuestionType);
              }}
            >
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
            placeholder="填写题目内容"
          />
        </Field>
        {(type === "SINGLE" || type === "MULTIPLE") && (
          <QuestionOptionsEditor
            options={content.options}
            answers={content.answers}
            multiple={type === "MULTIPLE"}
            onChange={patch}
          />
        )}
        {type !== "SINGLE" && type !== "MULTIPLE" && (
          <StringListEditor
            label={type === "BLANK" ? "各空标准答案" : "参考答案"}
            itemLabel={type === "BLANK" ? "填空答案" : "答案"}
            values={content.answers}
            multiline
            onChange={(answers) => patch({ answers })}
          />
        )}
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
        <StringListEditor
          label="知识点"
          itemLabel="知识点"
          values={knowledgeTags}
          onChange={(tags) => {
            setDirty(true);
            setKnowledgeTags(tags);
          }}
        />
        <Field label="上传题目配图" hint="支持 PNG、JPG；上传后图片与题目一起保存。">
          <input
            type="file"
            accept="image/png,image/jpeg"
            disabled={uploading || saving || pending}
            onChange={(e) => {
              void uploadImage(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </Field>
        {uploading && (
          <p role="status" className="p-muted">
            正在上传配图…配图上传完成后可保存。
          </p>
        )}
        {uploadError && (
          <div role="alert" className="field-error">
            <p>{uploadError}。配图尚未加入试题，请重试或移除后保存。</p>
            <div className="p-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => void uploadImage(uploadFile)}
              >
                重试上传
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  setUploadFile(undefined);
                  setUploadError("");
                }}
              >
                移除所选配图
              </button>
            </div>
          </div>
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
                      onChange={(e) => changeType(e.target.value as QuestionPart["type"], i)}
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
                  <QuestionOptionsEditor
                    options={p.options}
                    answers={p.answers}
                    multiple={p.type === "MULTIPLE"}
                    onChange={(value) => patchPart(i, value)}
                  />
                )}
                {p.type !== "SINGLE" && p.type !== "MULTIPLE" && (
                  <StringListEditor
                    label="各空答案 / 参考答案"
                    itemLabel="答案"
                    values={p.answers}
                    multiline
                    onChange={(answers) => patchPart(i, { answers })}
                  />
                )}
                <Field label="小问评分标准">
                  <input
                    value={p.rubric}
                    onChange={(e) => patchPart(i, { rubric: e.target.value })}
                  />
                </Field>
                <StringListEditor
                  label="小问知识点"
                  itemLabel="知识点"
                  values={p.knowledgeTags}
                  onChange={(knowledgeTags) => patchPart(i, { knowledgeTags })}
                />
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
          <Submit pending={pending || saving} disabled={uploading || !!uploadFile}>
            保存试题
          </Submit>
          <button
            type="button"
            className="button secondary"
            disabled={saving || pending}
            onClick={cancel}
          >
            取消
          </button>
        </div>
        {saveError && (
          <p role="alert" className="field-error">
            {saveError}
          </p>
        )}
      </form>
    </Panel>
  );
}
