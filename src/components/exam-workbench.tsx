"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Upload, Search, FileText } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";
import { UPLOAD_LIMITS, type ExamTaskSummary } from "@/contracts/exam-tasks";
import { apiRequest } from "@/lib/http-client";

export function taskLabel(task: ExamTaskSummary) {
  if (task.status === "COMPLETED") return task.autoGrade ? "识别完成 · 查看作答" : "已保存 · 查看题套";
  if (task.status === "FAILED") return "识别失败 · 查看详情";
  if (task.status === "QUEUED") return "等待识别";
  if (!task.totalPages) return "正在准备页面";
  const labels: Record<string, string> = {
    inventory: "全卷解析",
    localization: "逐题定位",
    transcription: "题目文本化",
    references: "提取参考答案",
    answer_parsing: "解析学生作答",
    parsing: "逐题识别",
    solving: "AI 解题",
    saved: "保存完成",
  };
  return `${labels[task.phase] ?? "准备中"} · ${task.page} / ${task.totalPages}`;
}

export function ExamWorkbench({
  initialTasks,
  model,
  isAdmin,
  grading = false,
  templateTaskId,
}: {
  initialTasks: ExamTaskSummary[];
  model: string | null;
  isAdmin: boolean;
  grading?: boolean;
  templateTaskId?: string;
}) {
  const mode = grading ? "quick" : "parse";
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [percent, setPercent] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [search, setSearch] = useState("");
  const [generateAnswers, setGenerateAnswers] = useState(true);
  const [templateId, setTemplateId] = useState(templateTaskId ?? "");
  const input = useRef<HTMLInputElement>(null);
  const uploadRequest = useRef<XMLHttpRequest | null>(null);
  const tasks = useQuery({
    queryKey: ["exams"],
    queryFn: () => apiRequest<{ tasks: ExamTaskSummary[] }>("/api/exams"),
    initialData: { tasks: initialTasks },
    refetchInterval: (query) =>
      query.state.data?.tasks.some((t) =>
        ["QUEUED", "RUNNING"].includes(t.status),
      )
        ? 2500
        : false,
  });

  function addFiles(incoming: File[]) {
    setError("");
    const next = [...files];
    for (const file of incoming) {
      if (!/\.(pdf|jpe?g|png)$/i.test(file.name)) {
        setError("请选择 PDF、JPG 或 PNG 文件。");
        return;
      }
      if (!file.size || file.size > UPLOAD_LIMITS.fileBytes) {
        setError("单个文件需要大于 0 字节且不超过 40 MB。");
        return;
      }
      if (
        !next.some(
          (existing) =>
            existing.name === file.name &&
            existing.size === file.size &&
            existing.lastModified === file.lastModified,
        )
      )
        next.push(file);
    }
    if (next.length > UPLOAD_LIMITS.files) {
      setError("每次最多上传 20 个文件。");
      return;
    }
    if (
      next.reduce((sum, file) => sum + file.size, 0) > UPLOAD_LIMITS.totalBytes
    ) {
      setError("每次上传总大小不能超过 100 MB。");
      return;
    }
    setFiles(next);
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
    const data = new FormData();
    files.forEach((file) => data.append("files", file));
    try {
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        uploadRequest.current = xhr;
        const params = new URLSearchParams({ mode, generateAnswers: String(generateAnswers) });
        if (grading && templateId) params.set("templateId", templateId);
        xhr.open("POST", `/api/exams?${params}`);
        xhr.responseType = "json";
        xhr.timeout = 300_000;
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable)
            setPercent(Math.round((event.loaded / event.total) * 100));
        };
        xhr.onload = () =>
          xhr.status === 202
            ? resolve()
            : reject(
                new Error(xhr.response?.error ?? "上传失败，请重新提交。"),
              );
        xhr.onerror = () =>
          reject(new Error("网络连接失败，请检查网络后重试。"));
        xhr.ontimeout = () => reject(new Error("上传超时，请检查网络后重试。"));
        xhr.onabort = () => reject(new Error("上传已取消。"));
        xhr.send(data);
      });
      setFiles([]);
      if (input.current) input.current.value = "";
      await tasks.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "上传失败，请重试。");
    } finally {
      setUploading(false);
      uploadRequest.current = null;
    }
  }

  return (
    <>
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
              <select id="grading-template" value={templateId} disabled={uploading}
                onChange={(event) => setTemplateId(event.target.value)}>
                <option value="">不选题套，直接解析完整作答卷</option>
                {tasks.data.tasks.filter((t) => t.status === "COMPLETED" && !t.autoGrade).map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              <p className="hint">答题卡需选择题套；完整作答卷可直接上传，系统先准备标准答案再批改。</p>
            </div>
          ) : (
            <div className="field">
              <label className="checkbox-field answer-generation-choice">
                <input type="checkbox" checked={generateAnswers} disabled={uploading}
                  onChange={(event) => setGenerateAnswers(event.target.checked)} />
                生成标准答案与解题解析
              </label>
              <p className="hint">已有参考答案会优先整理。取消生成后，可在保存的题套中补充答案，再进入批改。</p>
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
              if (!uploading && model)
                addFiles(Array.from(event.dataTransfer.files));
            }}
          >
            <Upload size={28} className="upload-icon" aria-hidden="true" />
            <label className="upload-target" htmlFor="exam-files">
              <strong>
                {grading ? "上传已作答试卷" : "上传空白试卷"}，或将文件拖到这里
              </strong>
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
                    <small className="muted">
                      {(file.size / 1024 / 1024).toFixed(1)} MB
                    </small>
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
                      onClick={() =>
                        setFiles((old) => old.filter((_, i) => i !== index))
                      }
                    >
                      移除
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          )}
          <div className="upload-actions">
            <Button
              type="submit"
              disabled={!model || !files.length || uploading}
            >
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
      <section className="exam-history" aria-labelledby="history-heading">
        <div className="section-heading">
          <h2 id="history-heading">{grading ? "作答记录" : "试卷存稿"}</h2>
          <button
            className="text-button"
            onClick={() => void tasks.refetch()}
            disabled={tasks.isFetching}
          >
            刷新列表
          </button>
        </div>
        {tasks.error && (
          <p className="form-error" role="alert">
            进度暂时无法更新，请刷新列表重试。
          </p>
        )}
        {!tasks.data.tasks.length && (
          <p className="history-empty muted">
            还没有试卷。上传第一份试卷，识别结果会保存在这里。
          </p>
        )}
        <div className="exam-search">
          <Search size={16} aria-hidden="true" />
          <Input
            aria-label="搜索试卷"
            placeholder="按试卷名称搜索"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="exam-list">
          {tasks.data.tasks
            .filter(
              (task) =>
                (grading ? task.autoGrade : !task.autoGrade) &&
                task.name.toLowerCase().includes(search.toLowerCase()),
            )
            .map((task) => (
              <Link
                className="exam-row"
                href={`/exams/${task.id}`}
                key={task.id}
              >
                <div className="exam-row-title">
                  <FileText size={20} aria-hidden="true" />
                  <div>
                    <h3>{task.name}</h3>
                    <p className="hint">
                      {new Date(task.createdAt).toLocaleString("zh-CN", {
                        timeZone: "Asia/Shanghai",
                      })}
                    </p>
                  </div>
                </div>
                <span
                  className={`task-status${task.status === "FAILED" ? " danger" : ""}`}
                >
                  {taskLabel(task)}
                </span>
              </Link>
            ))}
        </div>
        {tasks.data.tasks.length === 50 && (
          <p className="hint">显示最近 50 份试卷。</p>
        )}
      </section>
    </>
  );
}
