"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";
import { UPLOAD_LIMITS, type ExamTaskSummary } from "@/contracts/exam-tasks";
import { apiRequest } from "@/lib/http-client";

export function taskLabel(task: ExamTaskSummary) {
  if (task.status === "COMPLETED") return "已完成 · 查看结果";
  if (task.status === "FAILED") return "识别失败 · 查看详情";
  if (task.status === "QUEUED") return "等待识别";
  if (!task.totalPages) return "正在准备页面";
  const phase = task.phase === "verifying" ? "核对" : task.phase === "saved" ? "已保存" : "识别";
  return `${phase}第 ${task.page} / ${task.totalPages} 页`;
}

export function ExamWorkbench({ initialTasks, model, isAdmin }: { initialTasks: ExamTaskSummary[]; model: string | null; isAdmin: boolean }) {
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [percent, setPercent] = useState(0);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const uploadRequest = useRef<XMLHttpRequest | null>(null);
  const tasks = useQuery({ queryKey: ["exams"], queryFn: () => apiRequest<{ tasks: ExamTaskSummary[] }>("/api/exams"),
    initialData: { tasks: initialTasks }, refetchInterval: (query) => query.state.data?.tasks.some((t) => ["QUEUED", "RUNNING"].includes(t.status)) ? 2500 : false });

  function addFiles(incoming: File[]) {
    setError("");
    const next = [...files];
    for (const file of incoming) {
      if (!/\.(pdf|jpe?g|png)$/i.test(file.name)) { setError("请选择 PDF、JPG 或 PNG 文件。"); return; }
      if (!file.size || file.size > UPLOAD_LIMITS.fileBytes) { setError("单个文件需要大于 0 字节且不超过 40 MB。"); return; }
      if (!next.some((existing) => existing.name === file.name && existing.size === file.size && existing.lastModified === file.lastModified)) next.push(file);
    }
    if (next.length > UPLOAD_LIMITS.files) { setError("每次最多上传 20 个文件。"); return; }
    if (next.reduce((sum, file) => sum + file.size, 0) > UPLOAD_LIMITS.totalBytes) { setError("每次上传总大小不能超过 100 MB。"); return; }
    setFiles(next);
  }
  function move(index: number, delta: number) {
    setFiles((old) => { const next = [...old]; [next[index], next[index + delta]] = [next[index + delta], next[index]]; return next; });
  }
  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!files.length || uploading) return;
    setUploading(true); setError(""); setPercent(0);
    const data = new FormData(); files.forEach((file) => data.append("files", file));
    try {
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest(); uploadRequest.current = xhr;
        xhr.open("POST", "/api/exams"); xhr.responseType = "json"; xhr.timeout = 300_000;
        xhr.upload.onprogress = (event) => { if (event.lengthComputable) setPercent(Math.round(event.loaded / event.total * 100)); };
        xhr.onload = () => xhr.status === 202 ? resolve() : reject(new Error(xhr.response?.error ?? "上传失败，请重新提交。"));
        xhr.onerror = () => reject(new Error("网络连接失败，请检查网络后重试。"));
        xhr.ontimeout = () => reject(new Error("上传超时，请检查网络后重试。"));
        xhr.onabort = () => reject(new Error("上传已取消。"));
        xhr.send(data);
      });
      setFiles([]); if (input.current) input.current.value = "";
      await tasks.refetch();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "上传失败，请重试。"); }
    finally { setUploading(false); uploadRequest.current = null; }
  }

  return <>
    <section className="upload-section" aria-labelledby="upload-heading">
      <div className="section-heading"><h2 id="upload-heading">上传一份试卷</h2>{model && <span className="hint model-caption">识别模型：{model}</span>}</div>
      {!model && <div className="setup-note"><p>配置识别模型后即可上传试卷。</p>{isAdmin ? <Link href="/admin/ai">前往 AI 提供商设置</Link> : <p className="hint">请联系管理员完成 AI 配置。</p>}</div>}
      <form onSubmit={upload}>
        <div className={`upload-dropzone${dragging ? " is-dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); if (!uploading && model) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => {
          event.preventDefault(); setDragging(false); if (!uploading && model) addFiles(Array.from(event.dataTransfer.files));
        }}>
          <label className="upload-target" htmlFor="exam-files"><strong>选择文件，或拖到这里</strong><span>PDF、JPG、PNG · 单个文件不超过 40 MB</span></label>
          <input ref={input} id="exam-files" type="file" accept=".pdf,.jpg,.jpeg,.png" multiple disabled={uploading || !model} onChange={(event) => {
            addFiles(Array.from(event.target.files ?? [])); event.target.value = "";
          }} />
          <p className="hint">多张照片请按页码顺序添加，将合并为一份试卷。最多 20 个文件、50 页、总计 100 MB。</p>
        </div>
        {!!files.length && <ol className="upload-files">{files.map((file, index) => <li key={`${file.name}-${file.lastModified}-${file.size}`}>
          <div className="file-info"><span>{file.name}</span><small className="muted">{(file.size / 1024 / 1024).toFixed(1)} MB</small></div>
          <div className="inline-actions"><button type="button" className="text-button" disabled={uploading || index === 0} aria-label={`上移 ${file.name}`} onClick={() => move(index, -1)}>上移</button><button type="button" className="text-button" disabled={uploading || index === files.length - 1} aria-label={`下移 ${file.name}`} onClick={() => move(index, 1)}>下移</button><button type="button" className="text-button" disabled={uploading} aria-label={`移除 ${file.name}`} onClick={() => setFiles((old) => old.filter((_, i) => i !== index))}>移除</button></div>
        </li>)}</ol>}
        <div className="upload-actions"><button type="submit" className="button" disabled={!model || !files.length || uploading}>{uploading ? (percent === 100 ? "正在提交…" : `正在上传 ${percent}%`) : "开始识别"}</button>
          {uploading ? <button type="button" className="text-button" onClick={() => uploadRequest.current?.abort()}>取消上传</button> : <p className="hint">提交后可离开页面，稍后回来查看结果。</p>}</div>
        {error && <p className="form-error" role="alert">{error}</p>}
      </form>
    </section>
    <section className="exam-history" aria-labelledby="history-heading">
      <div className="section-heading"><h2 id="history-heading">我的试卷</h2><button className="text-button" onClick={() => void tasks.refetch()} disabled={tasks.isFetching}>刷新列表</button></div>
      {tasks.error && <p className="form-error" role="alert">进度暂时无法更新，请刷新列表重试。</p>}
      {!tasks.data.tasks.length && <p className="history-empty muted">还没有试卷。上传第一份试卷，识别结果会保存在这里。</p>}
      <div className="exam-list">{tasks.data.tasks.map((task) => <Link className="exam-row" href={`/exams/${task.id}`} key={task.id}>
        <div><h3>{task.name}</h3><p className="hint">{new Date(task.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })} · {task.model}</p></div>
        <span className={`task-status${task.status === "FAILED" ? " danger" : ""}`}>{taskLabel(task)}</span>
      </Link>)}</div>
      {tasks.data.tasks.length === 50 && <p className="hint">显示最近 50 份试卷。</p>}
    </section>
  </>;
}
