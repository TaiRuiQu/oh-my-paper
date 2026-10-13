"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, ClipboardCheck } from "lucide-react";
import type { ExamTaskSummary } from "@/contracts/exam-tasks";
import type { WorkflowSummary } from "@/contracts/workflows";
import { apiRequest } from "@/lib/http-client";
import { formatDate } from "@/lib/date-time";
import { reportClientError, taskErrorMessage } from "@/lib/error-message";
import { submitExamUpload, validateUploadBatch } from "@/lib/exam-upload";
import type { TaskModelSelection, UserAiSettings } from "@/contracts/user-ai";
import { TaskModelPicker, useTaskModelSettings } from "./task-model-picker";
import { FileUpload } from "./file-upload";
import { StatusBadge } from "./processing-state";
export function GradingManager({
  quick = false,
  initialTasks = [],
  initialWorkflows = [],
  selectedExam = "",
  isAdmin,
  initialModels,
}: {
  quick?: boolean;
  initialTasks?: ExamTaskSummary[];
  initialWorkflows?: WorkflowSummary[];
  selectedExam?: string;
  isAdmin: boolean;
  initialModels?: UserAiSettings;
}) {
  const modelQuery = useTaskModelSettings(initialModels);
  const [models, setModels] = useState<TaskModelSelection>({});
  const router = useRouter(),
    request = useRef<XMLHttpRequest | null>(null);
  const [sourceId, setSourceId] = useState(
      initialTasks.some((task) => task.id === selectedExam && task.status === "COMPLETED")
        ? selectedExam
        : "",
    ),
    [files, setFiles] = useState<File[]>([]),
    [answerFiles, setAnswerFiles] = useState<File[]>([]),
    [pending, setPending] = useState(false),
    [progress, setProgress] = useState(0),
    [error, setError] = useState("");
  useEffect(() => () => request.current?.abort(), []);
  const exams = useQuery({
    queryKey: ["exams"],
    queryFn: () => apiRequest<{ tasks: ExamTaskSummary[] }>("/api/exams"),
    initialData: { tasks: initialTasks },
    enabled: !quick,
  });
  const query = useQuery({
    queryKey: ["workflows"],
    queryFn: () => apiRequest<{ workflows: WorkflowSummary[] }>("/api/workflows"),
    initialData: { workflows: initialWorkflows },
    refetchInterval: (query) =>
      query.state.data?.workflows.some((flow) => ["QUEUED", "RUNNING"].includes(flow.status))
        ? 2500
        : false,
  });
  const available = exams.data.tasks.filter((task) => task.status === "COMPLETED"),
    selected = available.find((task) => task.id === sourceId),
    history = query.data.workflows.filter((flow) => flow.kind === (quick ? "QUICK" : "GRADING"));
  async function upload(event: FormEvent) {
    event.preventDefault();
    if (
      pending ||
      !files.length ||
      (!quick && !sourceId) ||
      modelQuery.isPending ||
      modelQuery.error
    )
      return;
    setPending(true);
    setError("");
    setProgress(0);
    try {
      const id = await submitExamUpload({
        files,
        models,
        answerFiles: quick ? answerFiles : [],
        endpoint: quick ? "/api/quick-grade" : `/api/exams/${sourceId}/grade`,
        resultKey: "workflow",
        onProgress: setProgress,
        onRequest: (xhr) => {
          request.current = xhr;
        },
      });
      router.push(quick ? `/quick-grading/${id}` : `/grades/${id}`);
    } catch (error) {
      const message = reportClientError("grading.upload", error);
      setError(isAdmin ? message : taskErrorMessage(error, "答卷提交失败，请稍后重试。"));
    } finally {
      request.current = null;
      setPending(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{quick ? "快速批改" : "批改管理"}</h1>
          <p className="intro">
            {quick
              ? "直接上传有作答痕迹的试卷，一次提交即可获得批改报告。"
              : "选择试卷，上传学生答卷，查看逐题反馈。"}
          </p>
        </div>
      </div>
      <section className="surface upload-section">
        <h2>{quick ? "上传作答试卷" : "新建批改"}</h2>
        <form onSubmit={upload} aria-busy={pending}>
          {!quick && (
            <div className="field exam-select">
              <label htmlFor="grading-exam">选择试卷</label>
              <select
                id="grading-exam"
                value={sourceId}
                disabled={pending}
                onChange={(event) => setSourceId(event.target.value)}
              >
                <option value="">请选择一套试卷</option>
                {available.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.name}
                  </option>
                ))}
              </select>
              {!available.length ? (
                <p className="hint">
                  请先在<Link href="/dashboard">试卷管理</Link>中添加试卷。
                </p>
              ) : (
                selected && (
                  <p className="selection-note">
                    {selected.answerStatus === "READY"
                      ? "将使用这套试卷的标准答案进行批改。"
                      : "系统会先自动准备标准答案，再批改这份答卷。"}
                    <Link className="text-action" href={`/exams/${sourceId}`}>
                      查看试卷
                      <ArrowUpRight size={14} />
                    </Link>
                  </p>
                )
              )}
            </div>
          )}
          <FileUpload
            id={quick ? "quick-files" : "grading-files"}
            files={files}
            onChange={(next) => {
              validateUploadBatch([...next, ...answerFiles]);
              setFiles(next);
            }}
            disabled={pending || (!quick && !sourceId)}
            onError={setError}
            label={quick ? "选择有作答痕迹的试卷" : "选择学生答卷或拖放到这里"}
            limitsLabel={quick ? "作答试卷与标准答案合计最多 20 个文件，共 100 MB。" : undefined}
          />
          {quick && (
            <details className="reference-upload answer-disclosure">
              <summary>
                标准答案（可选）
                {answerFiles.length > 0 && (
                  <span className="count-label">已选 {answerFiles.length} 个文件</span>
                )}
              </summary>
              <p className="hint">
                有标准答案时，可一起上传；系统按这份答案批改。不上传则自动生成。
              </p>
              <FileUpload
                id="quick-answer-files"
                files={answerFiles}
                onChange={(next) => {
                  validateUploadBatch([...files, ...next]);
                  setAnswerFiles(next);
                }}
                disabled={pending}
                student={false}
                onError={setError}
                label="选择标准答案或拖放到这里"
                limitsLabel="与作答试卷合计最多 20 个文件，共 100 MB。"
              />
            </details>
          )}
          <TaskModelPicker
            query={modelQuery}
            purposes={
              quick
                ? ["exam", "answer", "grading"]
                : selected?.answerStatus === "READY"
                  ? ["grading"]
                  : ["answer", "grading"]
            }
            value={models}
            onChange={setModels}
            disabled={pending}
          />
          <div className="upload-actions">
            <button
              className="button"
              disabled={
                pending ||
                !files.length ||
                (!quick && !sourceId) ||
                modelQuery.isPending ||
                !!modelQuery.error
              }
            >
              {pending ? `正在上传 ${progress}%` : "开始批改"}
            </button>
            <span className="hint">提交后可以离开，结果会自动保存。</span>
          </div>
          {pending && <progress value={progress} max={100} aria-label="上传进度" />}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {exams.error && !quick && (
            <p className="form-error" role="alert">
              试卷列表暂时无法加载。
              <button
                type="button"
                className="button secondary"
                onClick={() => void exams.refetch()}
              >
                重新加载
              </button>
            </p>
          )}
        </form>
      </section>
      <section className="surface list-surface">
        <div className="list-toolbar">
          <h2>
            {quick ? "快速批改记录" : "批改记录"}
            <span className="count-label">{history.length}</span>
          </h2>
        </div>
        {query.error && (
          <p className="form-error" role="alert">
            {isAdmin ? query.error.message : "批改记录暂时无法加载。"}
            <button className="button secondary" onClick={() => void query.refetch()}>
              重新加载
            </button>
          </p>
        )}
        {!history.length ? (
          <div className="empty-state">
            <ClipboardCheck size={32} aria-hidden="true" />
            <h3>还没有批改记录</h3>
            <p>提交答卷后，你可以在这里查看结果。</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="management-table">
              <thead>
                <tr>
                  <th>答卷名称</th>
                  <th>试卷</th>
                  <th>提交时间</th>
                  <th>状态</th>
                  <th className="table-actions">操作</th>
                </tr>
              </thead>
              <tbody>
                {history.map((flow) => (
                  <tr key={flow.id}>
                    <td>
                      <Link
                        className="table-title"
                        href={quick ? `/quick-grading/${flow.id}` : `/grades/${flow.id}`}
                      >
                        {flow.name}
                      </Link>
                    </td>
                    <td>{flow.source.name}</td>
                    <td>
                      <time dateTime={flow.createdAt}>{formatDate(flow.createdAt)}</time>
                    </td>
                    <td>
                      <StatusBadge status={flow.status} />
                    </td>
                    <td className="table-actions">
                      <Link
                        className="text-action"
                        href={quick ? `/quick-grading/${flow.id}` : `/grades/${flow.id}`}
                      >
                        {flow.status === "COMPLETED" ? "查看报告" : "查看"}
                        <ArrowUpRight size={14} />
                      </Link>
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
