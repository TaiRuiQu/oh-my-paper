"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search, ArrowUpRight, FileText } from "lucide-react";
import type { ExamTaskSummary } from "@/contracts/exam-tasks";
import { apiRequest } from "@/lib/http-client";
import { formatDate } from "@/lib/date-time";
import { reportClientError, taskErrorMessage } from "@/lib/error-message";
import { submitExamUpload, validateUploadBatch } from "@/lib/exam-upload";
import type { TaskModelSelection, UserAiSettings } from "@/contracts/user-ai";
import { TaskModelPicker, useTaskModelSettings } from "./task-model-picker";
import { FileUpload } from "./file-upload";
import { StatusBadge } from "./processing-state";
export const taskLabels: Record<ExamTaskSummary["status"], string> = {
  QUEUED: "处理中",
  RUNNING: "处理中",
  COMPLETED: "已完成",
  FAILED: "需重试",
};
export function ExamWorkbench({
  initialTasks,
  isAdmin = false,
  initialModels,
}: {
  initialTasks: ExamTaskSummary[];
  isAdmin?: boolean;
  initialModels?: UserAiSettings;
}) {
  const modelQuery = useTaskModelSettings(initialModels);
  const [models, setModels] = useState<TaskModelSelection>({});
  const router = useRouter(),
    request = useRef<XMLHttpRequest | null>(null);
  const [files, setFiles] = useState<File[]>([]),
    [answerFiles, setAnswerFiles] = useState<File[]>([]),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false),
    [progress, setProgress] = useState(0),
    [adding, setAdding] = useState(!initialTasks.length),
    [search, setSearch] = useState("");
  useEffect(() => () => request.current?.abort(), []);
  const tasks = useQuery({
    queryKey: ["exams"],
    queryFn: () => apiRequest<{ tasks: ExamTaskSummary[] }>("/api/exams"),
    initialData: { tasks: initialTasks },
    refetchInterval: (query) =>
      query.state.data?.tasks.some(
        (task) => ["QUEUED", "RUNNING"].includes(task.status) || task.answerStatus === "PROCESSING",
      )
        ? 2500
        : false,
  });
  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!files.length || pending || modelQuery.isPending || modelQuery.error) return;
    setPending(true);
    setError("");
    setProgress(0);
    try {
      const id = await submitExamUpload({
        files,
        models,
        answerFiles,
        onProgress: setProgress,
        onRequest: (xhr) => {
          request.current = xhr;
        },
      });
      router.push(`/exams/${id}`);
    } catch (error) {
      const message = reportClientError("exam.upload", error);
      setError(isAdmin ? message : taskErrorMessage(error, "试卷添加失败，请稍后重试。"));
    } finally {
      request.current = null;
      setPending(false);
    }
  }
  const visible = tasks.data.tasks.filter((task) =>
    task.name.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>试卷管理</h1>
          <p className="intro">整理试题与标准答案，为每一次批改做好准备。</p>
        </div>
        <button
          className="button"
          onClick={() => setAdding(!adding)}
          aria-expanded={adding}
          aria-controls="add-exam"
        >
          <Plus size={17} />
          添加试卷
        </button>
      </div>
      {adding && (
        <section className="surface upload-section" id="add-exam">
          <div className="section-heading">
            <h2>添加试卷</h2>
            <button
              className="button secondary"
              disabled={pending}
              onClick={() => setAdding(false)}
            >
              收起
            </button>
          </div>
          <p className="intro">上传一套完整试卷，添加后可查看试题并生成标准答案。</p>
          <form onSubmit={upload} aria-busy={pending}>
            <FileUpload
              id="exam-files"
              files={files}
              onChange={(next) => {
                validateUploadBatch([...next, ...answerFiles]);
                setFiles(next);
              }}
              disabled={pending}
              onError={setError}
              student={false}
              label="选择试卷文件或拖放到这里"
              limitsLabel="试卷与标准答案合计最多 20 个文件，共 100 MB。"
            />
            <details className="reference-upload answer-disclosure">
              <summary>
                标准答案（可选）
                {answerFiles.length > 0 && (
                  <span className="count-label">已选 {answerFiles.length} 个文件</span>
                )}
              </summary>
              <p className="hint">可与试卷一起上传。系统先解析试卷，再按题号匹配并保存答案。</p>
              <FileUpload
                id="exam-answer-files"
                files={answerFiles}
                onChange={(next) => {
                  validateUploadBatch([...files, ...next]);
                  setAnswerFiles(next);
                }}
                disabled={pending}
                onError={setError}
                student={false}
                label="选择标准答案或拖放到这里"
                limitsLabel="与试卷合计最多 20 个文件，共 100 MB。"
              />
            </details>
            <TaskModelPicker
              query={modelQuery}
              purposes={answerFiles.length ? ["exam", "answer"] : ["exam"]}
              value={models}
              onChange={setModels}
              disabled={pending}
            />
            <div className="upload-actions">
              <button
                className="button"
                disabled={!files.length || pending || modelQuery.isPending || !!modelQuery.error}
              >
                {pending ? `正在上传 ${progress}%` : "添加试卷"}
              </button>
            </div>
            {pending && <progress value={progress} max={100} aria-label="上传进度" />}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
          </form>
        </section>
      )}
      <section className="surface list-surface" aria-labelledby="exam-list-heading">
        <div className="list-toolbar">
          <h2 id="exam-list-heading">
            试卷列表 <span className="count-label">{tasks.data.tasks.length}</span>
          </h2>
          <label className="search-field">
            <Search size={17} aria-hidden="true" />
            <input
              type="search"
              placeholder="搜索试卷名称"
              aria-label="搜索试卷"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </div>
        {tasks.error && (
          <p className="form-error" role="alert">
            {isAdmin ? tasks.error.message : "列表暂时无法加载。"}
            <button className="button secondary" onClick={() => void tasks.refetch()}>
              重新加载
            </button>
          </p>
        )}
        {!visible.length ? (
          <div className="empty-state">
            <FileText size={32} aria-hidden="true" />
            <h3>{search ? "没有找到匹配的试卷" : "还没有试卷"}</h3>
            <p>
              {search ? "试试其他名称，或清除搜索。" : "点击「添加试卷」，上传你的第一套试题。"}
            </p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="management-table">
              <thead>
                <tr>
                  <th>试卷名称</th>
                  <th>添加时间</th>
                  <th>状态</th>
                  <th>标准答案</th>
                  <th className="table-actions">操作</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((task) => (
                  <tr key={task.id}>
                    <td>
                      <Link className="table-title" href={`/exams/${task.id}`}>
                        <FileText size={19} aria-hidden="true" />
                        {task.name}
                      </Link>
                    </td>
                    <td>
                      <time dateTime={task.createdAt}>{formatDate(task.createdAt)}</time>
                    </td>
                    <td>
                      <StatusBadge status={task.status} />
                    </td>
                    <td>
                      <span className="hint">
                        {task.answerStatus === "READY"
                          ? "已生成"
                          : task.answerStatus === "PROCESSING"
                            ? "处理中"
                            : "待生成"}
                      </span>
                    </td>
                    <td className="table-actions">
                      <Link href={`/exams/${task.id}?view=answers`} className="text-action">
                        {task.status === "COMPLETED"
                          ? task.answerStatus === "READY"
                            ? "查看答案"
                            : "生成答案"
                          : "查看"}
                        <ArrowUpRight size={14} />
                      </Link>
                      {task.status === "COMPLETED" && (
                        <Link className="text-action" href={`/grading?exam=${task.id}`}>
                          批改答卷
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
