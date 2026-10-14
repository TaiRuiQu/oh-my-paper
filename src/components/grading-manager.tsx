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
import { groupStudentUploads } from "@/lib/student-uploads";
import type { TaskModelSelection, UserAiSettings } from "@/contracts/user-ai";
import { TaskModelPicker, useTaskModelSettings } from "./task-model-picker";
import { FileUpload } from "./file-upload";
import { StatusBadge } from "./processing-state";
export function GradingManager({
  quick: initiallyQuick = true,
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
  const [useSource, setUseSource] = useState(!initiallyQuick || !!selectedExam);
  const quick = !useSource;
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
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => () => request.current?.abort(), []);
  const exams = useQuery({
    queryKey: ["exams"],
    queryFn: () => apiRequest<{ tasks: ExamTaskSummary[] }>("/api/exams"),
    initialData: { tasks: initialTasks },
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
    history = query.data.workflows;
  const students = groupStudentUploads(files);
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
    setNotice("");
    setProgress(0);
    try {
      const id = await submitExamUpload({
        files,
        models: quick
          ? models
          : {
              answer: models.answer,
              grading: models.grading,
              reasoningEfforts: {
                answer: models.reasoningEfforts?.answer,
                grading: models.reasoningEfforts?.grading,
              },
            },
        answerFiles: quick ? answerFiles : [],
        endpoint: quick ? "/api/homework" : `/api/homework?exam=${sourceId}`,
        resultKey: "workflow",
        onProgress: setProgress,
        onRequest: (xhr) => {
          request.current = xhr;
        },
      });
      if (students.length === 1) router.push(quick ? `/quick-grading/${id}` : `/grades/${id}`);
      else {
        setFiles([]);
        setAnswerFiles([]);
        setNotice(`已提交 ${students.length} 份作业，每位学生的进度和报告可在下方查看。`);
        await query.refetch();
      }
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
          <h1>作业批改</h1>
          <p className="intro">上传带有试题和作答痕迹的试卷，每位学生单独生成批改报告。</p>
        </div>
      </div>
      <section className="surface upload-section">
        <h2>上传学生作业</h2>
        <form onSubmit={upload} aria-busy={pending}>
          <fieldset className="grading-reference-choice" disabled={pending}>
            <legend>试题来源</legend>
            <label>
              <input
                type="radio"
                name="homework-reference"
                checked={quick}
                onChange={() => setUseSource(false)}
              />
              从作业中识别试题
            </label>
            <label>
              <input
                type="radio"
                name="homework-reference"
                checked={!quick}
                onChange={() => {
                  setUseSource(true);
                  setAnswerFiles([]);
                }}
              />
              使用已录入的试卷
            </label>
          </fieldset>
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
                      : "系统会先自动准备标准答案，再分别批改学生作业。"}
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
              groupStudentUploads(next);
              setFiles(next);
            }}
            disabled={pending || (!quick && !sourceId)}
            onError={setError}
            label="选择多份作业 PDF 或拖放到这里"
            limitsLabel={quick ? "作答试卷与标准答案合计最多 20 个文件，共 100 MB。" : undefined}
            groupingLabel="每个 PDF 对应一位学生，多页保留在同一个 PDF 中。图片按列表顺序合为一位学生的作业，请与 PDF 分开提交。"
            student={false}
          />
          {!!students.length && (
            <p className="selection-note" role="status">
              已选择 {students.length} 位学生的作业，将生成 {students.length} 份独立报告。
            </p>
          )}
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
              {pending
                ? `正在上传 ${progress}%`
                : students.length > 1
                  ? `开始批改 ${students.length} 份作业`
                  : "开始批改"}
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
      {notice && (
        <p className="selection-note" role="status">
          {notice}
        </p>
      )}
      <section className="surface list-surface">
        <div className="list-toolbar">
          <h2>
            作业批改记录
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
            <h3>还没有作业批改记录</h3>
            <p>一次选择多份 PDF，每份作业将单独批改并保存报告。</p>
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
                        href={
                          flow.kind === "QUICK" ? `/quick-grading/${flow.id}` : `/grades/${flow.id}`
                        }
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
                        href={
                          flow.kind === "QUICK" ? `/quick-grading/${flow.id}` : `/grades/${flow.id}`
                        }
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
