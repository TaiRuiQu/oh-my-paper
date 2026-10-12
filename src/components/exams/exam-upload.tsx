"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ExamTaskSummary } from "@/contracts/exam-tasks";

import { mergeExamFiles, submitExamUpload } from "@/lib/exam-upload";

export function ExamUpload({
  tasks,
  model,
  isAdmin,
  grading,
  templateTaskId,
  onUploaded,
}: {
  tasks: ExamTaskSummary[];
  model: string | null;
  isAdmin: boolean;
  grading: boolean;
  templateTaskId?: string;
  onUploaded: () => Promise<unknown>;
}) {
  const mode = grading ? "quick" : "parse";
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [percent, setPercent] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [generateAnswers, setGenerateAnswers] = useState(true);
  const [templateId, setTemplateId] = useState(templateTaskId ?? "");
  const input = useRef<HTMLInputElement>(null);
  const uploadRequest = useRef<XMLHttpRequest | null>(null);

  function addFiles(incoming: File[]) {
    setError("");
    try {
      setFiles(mergeExamFiles(files, incoming));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "请选择有效的试卷文件。");
    }
  }
  function move(index: number, delta: number) {
    setFiles((old) => {
      const next = [...old];
      [next[index], next[index + delta]] = [next[index + delta], next[index]];
      return next;
    });
  }
  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!files.length || uploading) return;
    setUploading(true);
    setError("");
    setPercent(0);
    try {
      const taskId = await submitExamUpload({
        files,
        mode,
        generateAnswers,
        templateId: grading ? templateId : undefined,
        onProgress: setPercent,
        onRequest: (request) => {
          uploadRequest.current = request;
        },
      });
      setFiles([]);
      if (input.current) input.current.value = "";
      await onUploaded();
      router.push(`/exams/${taskId}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "上传失败，请重试。");
    } finally {
      setUploading(false);
      uploadRequest.current = null;
    }
  }

  return (
    <section className="upload-section" aria-labelledby="upload-heading">
      <div className="section-heading">
        <h2 id="upload-heading">{grading ? "上传学生作答" : "新建题套"}</h2>
      </div>
      {!model && (
        <div className="setup-note">
          <p>试卷处理服务尚未准备好。</p>
          {isAdmin ? (
            <Link href="/admin/ai">前往服务设置</Link>
          ) : (
            <p className="hint">请联系管理员开启服务。</p>
          )}
        </div>
      )}
      <form onSubmit={upload}>
        {grading ? (
          <div className="field">
            <label htmlFor="grading-template">本次作答对应的题套</label>
            <select
              id="grading-template"
              value={templateId}
              disabled={uploading}
              onChange={(event) => setTemplateId(event.target.value)}
            >
              <option value="">不选题套，直接解析完整作答卷</option>
              {tasks
                .filter((t) => t.status === "COMPLETED" && !t.autoGrade)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
            <p className="hint">
              答题卡需选择题套；完整作答卷可直接上传，系统先准备标准答案再批改。
            </p>
          </div>
        ) : (
          <div className="field">
            <label className="checkbox-field answer-generation-choice">
              <input
                type="checkbox"
                checked={generateAnswers}
                disabled={uploading}
                onChange={(event) => setGenerateAnswers(event.target.checked)}
              />
              生成标准答案与解题解析
            </label>
            <p className="hint">
              已有参考答案会优先整理。取消生成后，可在保存的题套中补充答案，再进入批改。
            </p>
          </div>
        )}
        <div
          className={`upload-dropzone${dragging ? " is-dragging" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            if (!uploading && model) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            if (!uploading && model) addFiles(Array.from(event.dataTransfer.files));
          }}
        >
          <Upload size={28} className="upload-icon" aria-hidden="true" />
          <label className="upload-target" htmlFor="exam-files">
            <strong>{grading ? "上传已作答试卷" : "上传空白试卷"}，或将文件拖到这里</strong>
            <span>PDF、JPG、PNG · 单个文件不超过 40 MB</span>
          </label>
          <input
            ref={input}
            id="exam-files"
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            multiple
            disabled={uploading || !model}
            onChange={(event) => {
              addFiles(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
          <p className="hint">多张照片按页码顺序添加，将合并为同一份试卷。</p>
        </div>
        {!!files.length && (
          <ol className="upload-files">
            {files.map((file, index) => (
              <li key={`${file.name}-${file.lastModified}-${file.size}`}>
                <div className="file-info">
                  <span>{file.name}</span>
                  <small className="muted">{(file.size / 1024 / 1024).toFixed(1)} MB</small>
                </div>
                <div className="inline-actions">
                  <button
                    type="button"
                    className="text-button"
                    disabled={uploading || index === 0}
                    aria-label={`上移 ${file.name}`}
                    onClick={() => move(index, -1)}
                  >
                    上移
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    disabled={uploading || index === files.length - 1}
                    aria-label={`下移 ${file.name}`}
                    onClick={() => move(index, 1)}
                  >
                    下移
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    disabled={uploading}
                    aria-label={`移除 ${file.name}`}
                    onClick={() => setFiles((old) => old.filter((_, i) => i !== index))}
                  >
                    移除
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}
        <div className="upload-actions">
          <Button type="submit" disabled={!model || !files.length || uploading}>
            {uploading
              ? percent === 100
                ? "正在提交…"
                : `正在上传 ${percent}%`
              : mode === "quick"
                ? "识别作答并批改"
                : "解析并保存题套"}
          </Button>
          {uploading ? (
            <button
              type="button"
              className="text-button"
              onClick={() => uploadRequest.current?.abort()}
            >
              取消上传
            </button>
          ) : (
            <p className="hint">提交后可离开页面，稍后回来查看结果。</p>
          )}
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
