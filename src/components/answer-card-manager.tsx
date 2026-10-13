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
  async function upload(e: FormEvent, kind: "template" | "batch") {
    e.preventDefault();
    if (!canSubmit) return;
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
      <Link href="/grading" className="back-link">
        返回批改管理
      </Link>
      <div className="page-heading">
        <div>
          <h1>答题卡批量批改</h1>
          <p className="intro">标记一次作答区域，为同版式答题卡逐题评分。</p>
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
        <h2>答题卡模板</h2>
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
              onChange={(e) => setSourceId(e.target.value)}
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
      </section>
      <section className="surface upload-section">
        <h2>批量上传学生答题卡</h2>
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
          <p className="hint">
            评分前，请在对应试卷详情页准备完整标准答案。每个 PDF
            对应一位学生，页数与模板一致；图片按下面的文件数连续分组，按正面、反面的顺序上传。
          </p>
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
                  {i + 1} 个{i === 0 ? "（单页图片或完整 PDF）" : ""}
                </option>
              ))}
            </select>
          </div>
          <FileUpload
            id="card-batch-files"
            files={studentFiles}
            onChange={setStudentFiles}
            onError={setError}
            disabled={!!pending || template?.status !== "COMPLETED"}
            label="批量选择学生答题卡或拖放到这里"
          />
          {!!studentFiles.length && (
            <p className="selection-note">
              当前分组：
              {Array.from({ length: Math.ceil(studentFiles.length / perStudent) }, (_, i) =>
                studentFiles
                  .slice(i * perStudent, (i + 1) * perStudent)
                  .map((f) => f.name)
                  .join(" + "),
              ).join("；")}
            </p>
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
                studentFiles.length % perStudent !== 0 ||
                (perStudent > 1 && studentFiles.some((f) => /\.pdf$/i.test(f.name)))
              }
            >
              {pending === "batch" ? `正在上传 ${progress}%` : "开始批量批改"}
            </button>
            <span className="hint">同学之间、题目之间并发评分，提交后可以离开。</span>
          </div>
          {pending === "batch" && (
            <progress value={progress} max={100} aria-label="答题卡上传进度" />
          )}
        </form>
      </section>
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
