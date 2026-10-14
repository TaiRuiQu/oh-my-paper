"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import type { CardTemplate, CardBatch } from "@/contracts/answer-cards";
import type { ExamTaskSummary } from "@/contracts/exam-tasks";
import type { TaskModelSelection, UserAiSettings } from "@/contracts/user-ai";
import { apiRequest } from "@/lib/http-client";
import { submitExamUpload } from "@/lib/exam-upload";
import { formatDate } from "@/lib/date-time";
import { groupStudentUploads, isPdfUpload } from "@/lib/student-uploads";
import { FileUpload } from "./file-upload";
import { TaskModelPicker, useTaskModelSettings } from "./task-model-picker";
import { StatusBadge } from "./processing-state";

export function CardTemplatePreview({ template }: { template: CardTemplate }) {
  const [page, setPage] = useState(1),
    [imageError, setImageError] = useState(false);
  const questions = new Map(template.regions.map((r, i) => [r.questionId, i + 1]));
  return (
    <details className="card-template-preview">
      <summary>
        查看已标记区域 · {template.regions.length} 题 · {template.pageCount} 页
      </summary>
      <div className="field">
        <label htmlFor={`template-page-${template.id}`}>模板页面</label>
        <select
          id={`template-page-${template.id}`}
          value={page}
          onChange={(e) => {
            setPage(Number(e.target.value));
            setImageError(false);
          }}
        >
          {Array.from({ length: template.pageCount }, (_, i) => (
            <option key={i} value={i + 1}>
              第 {i + 1} 页
            </option>
          ))}
        </select>
      </div>
      <p className="hint">
        蓝色框为每道题的作答范围，编号按试卷题目顺序排列。学生答题卡应使用相同版式和页面顺序。
      </p>
      {imageError ? (
        <p role="alert" className="form-error">
          模板图片未能加载，请刷新重试。
        </p>
      ) : (
        <div className="card-region-image">
          {/* Authenticated user-uploaded template pages vary in dimensions. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/answer-cards/templates/${template.id}/pages/${page}`}
            alt={`答题卡模板第 ${page} 页及作答区域`}
            onError={() => setImageError(true)}
          />
          {template.regions.flatMap((r) =>
            r.boxes
              .filter((b) => b.page === page)
              .map((b, i) => (
                <span
                  key={`${r.questionId}-${i}`}
                  className="card-region-box"
                  style={{
                    left: `${b.x * 100}%`,
                    top: `${b.y * 100}%`,
                    width: `${b.width * 100}%`,
                    height: `${b.height * 100}%`,
                  }}
                >
                  <span>{questions.get(r.questionId)}</span>
                </span>
              )),
          )}
        </div>
      )}
    </details>
  );
}
export function AnswerCardManager({
  initialTasks,
  initialModels,
}: {
  initialTasks: ExamTaskSummary[];
  initialModels: UserAiSettings;
}) {
  const modelQuery = useTaskModelSettings(initialModels),
    router = useRouter(),
    request = useRef<XMLHttpRequest | null>(null);
  const [sourceId, setSourceId] = useState(""),
    [templateId, setTemplateId] = useState(""),
    [files, setFiles] = useState<File[]>([]),
    [studentFiles, setStudentFiles] = useState<File[]>([]),
    [perStudent, setPerStudent] = useState(1),
    [models, setModels] = useState<TaskModelSelection>({}),
    [pending, setPending] = useState(""),
    [progress, setProgress] = useState(0),
    [error, setError] = useState("");
  useEffect(() => () => request.current?.abort(), []);
  const query = useQuery({
    queryKey: ["answer-cards"],
    queryFn: () =>
      apiRequest<{ templates: CardTemplate[]; batches: CardBatch[] }>("/api/answer-cards"),
    refetchInterval: (q) =>
      q.state.data?.templates.some((t) => ["QUEUED", "RUNNING"].includes(t.status)) ||
      q.state.data?.batches.some((b) => ["QUEUED", "RUNNING"].includes(b.status))
        ? 2500
        : false,
  });
  const templates = query.data?.templates ?? [],
    template = templates.find((t) => t.id === templateId),
    tasks = initialTasks.filter((t) => t.status === "COMPLETED"),
    canSubmit = !pending && !modelQuery.isPending && !modelQuery.error;
  let students: File[][] = [],
    groupingError = "";
  try {
    students = groupStudentUploads(studentFiles, perStudent);
  } catch (cause) {
    groupingError = (cause as Error).message;
  }
  async function upload(e: FormEvent, kind: "template" | "batch") {
    e.preventDefault();
    if (
      !canSubmit ||
      (kind === "batch" && (!students.length || groupingError || template?.status !== "COMPLETED"))
    )
      return;
    setPending(kind);
    setError("");
    setProgress(0);
    try {
      const id = await submitExamUpload({
        files: kind === "template" ? files : studentFiles,
        models:
          kind === "template"
            ? {
                exam: models.exam,
                reasoningEfforts: models.reasoningEfforts?.exam
                  ? { exam: models.reasoningEfforts.exam }
                  : undefined,
              }
            : {
                grading: models.grading,
                reasoningEfforts: models.reasoningEfforts?.grading
                  ? { grading: models.reasoningEfforts.grading }
                  : undefined,
              },
        endpoint:
          kind === "template"
            ? `/api/exams/${sourceId}/answer-card-template`
            : `/api/answer-cards/templates/${templateId}/batches?filesPerStudent=${perStudent}`,
        onProgress: setProgress,
        onRequest: (xhr) => {
          request.current = xhr;
        },
      });
      if (kind === "batch") router.push(`/grading/cards/${id}`);
      else {
        setFiles([]);
        setTemplateId(id);
        await query.refetch();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传失败，请重试。");
    } finally {
      setPending("");
      request.current = null;
    }
  }
  async function retry(id: string) {
    setPending(id);
    setError("");
    try {
      await apiRequest(`/api/answer-cards/templates/${id}/retry`, { method: "POST" });
      await query.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "重试失败。");
    } finally {
      setPending("");
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>答题卡批改</h1>
          <p className="intro">上传只有作答、没有试题的答题卡，按对应试卷的标准答案批改。</p>
        </div>
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {query.error && (
        <p role="alert" className="form-error">
          答题卡记录未能加载。
          <button className="button secondary" onClick={() => void query.refetch()}>
            重新加载
          </button>
        </p>
      )}
      <section className="surface upload-section">
        <h2>上传学生答题卡</h2>
        {!templates.length && !query.isPending && (
          <p className="selection-note">
            首次使用，请先在下方建立答题卡模板，关联试卷并标记作答位置。模板可重复使用。
          </p>
        )}
        <form onSubmit={(e) => void upload(e, "batch")} aria-busy={pending === "batch"}>
          <div className="field">
            <label htmlFor="card-template">选择已标记的模板</label>
            <select
              id="card-template"
              value={templateId}
              disabled={!!pending}
              onChange={(e) => setTemplateId(e.target.value)}
            >
              <option value="">请选择模板</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id} disabled={t.status !== "COMPLETED"}>
                  {t.name}
                  {t.status !== "COMPLETED" ? "（尚未完成）" : `（${t.pageCount} 页）`}
                </option>
              ))}
            </select>
          </div>
          <p className="hint">答题卡须与模板版式、页数和页面顺序一致。</p>
          {template && (
            <p className="selection-note">
              对应试卷：{tasks.find((task) => task.id === template.sourceId)?.name ?? template.name}
              。
              <Link className="text-action" href={`/exams/${template.sourceId}`}>
                查看试卷与标准答案
              </Link>
            </p>
          )}
          {template &&
            tasks.find((task) => task.id === template.sourceId)?.answerStatus !== "READY" && (
              <p className="hint">批改前，请先在对应试卷详情页上传或生成完整标准答案。</p>
            )}
          {template?.status === "COMPLETED" && <CardTemplatePreview template={template} />}
          {studentFiles.some((file) => !isPdfUpload(file)) && (
            <div className="field">
              <label htmlFor="card-student-files">每位学生的图片文件数</label>
              <select
                id="card-student-files"
                value={perStudent}
                disabled={!!pending}
                onChange={(e) => setPerStudent(Number(e.target.value))}
              >
                {Array.from({ length: 20 }, (_, i) => (
                  <option value={i + 1} key={i}>
                    {i + 1} 张
                  </option>
                ))}
              </select>
            </div>
          )}
          <FileUpload
            id="card-batch-files"
            files={studentFiles}
            onChange={setStudentFiles}
            onError={setError}
            disabled={!!pending || template?.status !== "COMPLETED"}
            label="选择多份答题卡 PDF 或拖放到这里"
            student={false}
            groupingLabel="每个 PDF 对应一位学生，自动独立分组。上传图片时，请设置每位学生的图片数，并按页面顺序排列。PDF 与图片请分开提交。"
          />
          {groupingError && (
            <p className="form-error" role="alert">
              {groupingError}
            </p>
          )}
          {!!students.length && (
            <div className="selection-note" role="status">
              已选择 {students.length} 位学生的答题卡。
              <ol className="student-upload-groups">
                {students.map((group, index) => (
                  <li key={index}>
                    学生 {index + 1}：{group.map((f) => f.name).join(" + ")}
                  </li>
                ))}
              </ol>
            </div>
          )}
          <TaskModelPicker
            query={modelQuery}
            purposes={["grading"]}
            value={models}
            onChange={setModels}
            disabled={!!pending}
          />
          <div className="upload-actions">
            <button
              className="button"
              disabled={
                !canSubmit ||
                template?.status !== "COMPLETED" ||
                !studentFiles.length ||
                !!groupingError
              }
            >
              {pending === "batch"
                ? `正在上传 ${progress}%`
                : students.length > 0
                  ? `开始批改 ${students.length} 份答题卡`
                  : "开始批量批改"}
            </button>
            <span className="hint">提交后可以离开，结果会自动保存。</span>
          </div>
          {pending === "batch" && (
            <progress value={progress} max={100} aria-label="答题卡上传进度" />
          )}
        </form>
      </section>
      <details className="surface upload-section card-template-setup" id="new-card-template">
        <summary>新建答题卡模板</summary>
        <p className="hint">
          先选择已录入的试卷，上传一份同版式答题卡。模板可包含正反两面，也可上传多页 PDF。
        </p>
        <form onSubmit={(e) => void upload(e, "template")} aria-busy={pending === "template"}>
          <div className="field">
            <label htmlFor="card-exam">选择试卷</label>
            <select
              id="card-exam"
              value={sourceId}
              disabled={!!pending}
              onChange={(e) => {
                setSourceId(e.target.value);
                setFiles([]);
              }}
            >
              <option value="">请选择试卷</option>
              {tasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          {!tasks.length && (
            <p className="hint">
              请先在<Link href="/dashboard">试卷管理</Link>添加试卷。
            </p>
          )}
          <FileUpload
            id="card-template-files"
            files={files}
            onChange={setFiles}
            onError={setError}
            label="选择答题卡模板或拖放到这里"
            disabled={!!pending || !sourceId}
            student={false}
            groupingLabel="这里只上传一份模板；正反面或多页属于同一张答题卡。"
          />
          <TaskModelPicker
            query={modelQuery}
            purposes={["exam"]}
            value={models}
            onChange={setModels}
            disabled={!!pending}
          />
          <div className="upload-actions">
            <button className="button" disabled={!canSubmit || !sourceId || !files.length}>
              {pending === "template" ? `正在上传 ${progress}%` : "标记答题区域"}
            </button>
            <span className="hint">已建立的模板可以重复使用。</span>
          </div>
          {pending === "template" && (
            <progress value={progress} max={100} aria-label="模板上传进度" />
          )}
        </form>
        {templates.length > 0 && (
          <div className="card-template-list">
            {templates.map((t) => (
              <div className="card-template-row" key={t.id}>
                <div>
                  <strong>{t.name}</strong>
                  <span className="hint"> · 已消费 {Number(t.creditsSpent).toFixed(3)} credit</span>
                  <StatusBadge status={t.status} />
                  {t.status === "COMPLETED" && <CardTemplatePreview template={t} />}
                  <p className="hint">
                    {t.error ??
                      (["QUEUED", "RUNNING"].includes(t.status)
                        ? "正在标记答题区域，完成后即可批量上传。"
                        : "")}
                  </p>
                </div>
                {t.status === "FAILED" && (
                  <button
                    className="button secondary"
                    disabled={!!pending}
                    onClick={() => void retry(t.id)}
                  >
                    重试标记
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </details>
      <section className="surface list-surface">
        <div className="list-toolbar">
          <h2>答题卡批改记录</h2>
        </div>
        {query.isPending ? (
          <p className="hint">正在加载记录…</p>
        ) : !query.data?.batches.length ? (
          <div className="empty-state">
            <h3>还没有答题卡批改记录</h3>
            <p>建立模板后，即可批量提交学生答题卡。</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="management-table">
              <thead>
                <tr>
                  <th>批次</th>
                  <th>提交时间</th>
                  <th>题目进度</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {query.data.batches.map((b) => (
                  <tr key={b.id}>
                    <td>{b.name}</td>
                    <td>{formatDate(b.createdAt)}</td>
                    <td>
                      {b.completed} / {b.total}
                    </td>
                    <td>
                      <StatusBadge status={b.status} />
                    </td>
                    <td>
                      <Link href={`/grading/cards/${b.id}`} className="text-action">
                        查看结果
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
