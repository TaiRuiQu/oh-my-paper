"use client";
import { cohortLabel } from "@/lib/student-cohort";
import { useState } from "react";
import type { PlatformState } from "@/contracts/platform";
import { MAX_AI_BATCH_PAGES } from "@/contracts/platform-ai";
import { DOCUMENT_UPLOAD_ACCEPT, type UploadedPage } from "@/contracts/uploads";
import { uploadDocument } from "@/lib/document-upload";
import { canReviewSubject } from "@/contracts/permissions";
import { Field } from "./primitives";

export function BatchGradingForm({
  state,
  busy,
  start,
}: {
  state: PlatformState;
  busy: boolean;
  start: (kind: "BATCH_GRADE", input: unknown) => Promise<{ id: string } | undefined>;
}) {
  const [assessmentId, setAssessmentId] = useState("");
  const [classroomId, setClassroomId] = useState("");
  const [paperId, setPaperId] = useState("");
  const [pages, setPages] = useState<UploadedPage[]>([]);
  const [uploading, setUploading] = useState(false);
  const [failure, setFailure] = useState("");
  const assessment = state.assessments.find((a) => a.id === assessmentId);
  const classrooms = state.classrooms.filter(
    (c) =>
      assessment?.classroomIds.includes(c.id) &&
      assessment.papers.some((p) =>
        canReviewSubject(state.actor, assessment, c, p.subject, state.classrooms),
      ),
  );
  const classroom = classrooms.find((c) => c.id === classroomId);
  const configs =
    assessment?.papers.filter(
      (p) =>
        classroom &&
        canReviewSubject(state.actor, assessment, classroom, p.subject, state.classrooms),
    ) ?? [];
  const selectedPaper = configs.length === 1 ? configs[0].paperId : paperId;
  const pending = state.submissions.filter(
    (s) =>
      s.assessmentId === assessmentId &&
      s.paperId === selectedPaper &&
      classroom?.students.some((st) => st.id === s.studentId) &&
      !state.reviews.some((r) => r.submissionId === s.id),
  );
  const disabled = busy || uploading;
  async function upload(files: File[]) {
    if (!files.length) return;
    setFailure("");
    if (
      files.length + pages.length > MAX_AI_BATCH_PAGES ||
      files.reduce((n, file) => n + file.size, 0) + pages.reduce((n, page) => n + page.size, 0) >
        150_000_000
    ) {
      setFailure("一批最多 100 页、150 MB，请拆分后上传。");
      return;
    }
    setUploading(true);
    let count = pages.length;
    let bytes = pages.reduce((n, page) => n + page.size, 0);
    try {
      for (const file of files) {
        if (count >= MAX_AI_BATCH_PAGES) throw new Error("本批已达 100 页，请分批提交其余材料。");
        const result = await uploadDocument(file, MAX_AI_BATCH_PAGES - count);
        bytes += result.pages.reduce((n, p) => n + p.size, 0);
        if (bytes > 150_000_000) throw new Error("展开后的页面超过 150 MB，请拆分材料。");
        count += result.pageCount;
        setPages((current) => [...current, ...result.pages]);
      }
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "上传失败，请重试。已上传的页面已保留。");
    } finally {
      setUploading(false);
    }
  }
  return (
    <form
      className="p-ai-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (
          disabled ||
          !assessment ||
          !classroom ||
          !selectedPaper ||
          (!pages.length && !pending.length)
        )
          return;
        await start("BATCH_GRADE", {
          assessmentId,
          classroomId,
          paperId: selectedPaper,
          assetUrls: pages.map((p) => p.url),
        });
      }}
    >
      <p>
        选择班级，上传全班作业或试卷。AI
        自动识别姓名与考号、合并同一学生的多页作答、定位题目并逐题批改，无需手工框选。
      </p>
      <div className="p-form-grid">
        <Field label="作业 / 考试安排">
          <select
            required
            disabled={disabled}
            value={assessmentId}
            onChange={(e) => {
              setAssessmentId(e.target.value);
              setClassroomId("");
              setPaperId("");
            }}
          >
            <option value="">选择安排</option>
            {state.assessments
              .filter((a) => !a.published)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="批改班级">
          <select
            required
            disabled={disabled || !assessment}
            value={classroomId}
            onChange={(e) => {
              setClassroomId(e.target.value);
              setPaperId("");
            }}
          >
            <option value="">选择班级</option>
            {classrooms.map((c) => (
              <option key={c.id} value={c.id}>
                {cohortLabel(c)} · {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="练习册 / 科目试卷">
          <select
            required
            disabled={disabled || !classroom}
            value={selectedPaper}
            onChange={(e) => setPaperId(e.target.value)}
          >
            <option value="">选择题本</option>
            {configs.map((p) => (
              <option key={p.paperId} value={p.paperId}>
                {p.subject} · {state.papers.find((paper) => paper.id === p.paperId)?.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {!state.assessments.some((a) => !a.published) && (
        <p className="p-notice">
          请先按班级布置作业或安排考试。已发布的成绩需要先撤回发布才能继续批改。
        </p>
      )}
      <Field label="全班扫描材料">
        <input
          type="file"
          multiple
          accept={DOCUMENT_UPLOAD_ACCEPT}
          disabled={disabled}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            void upload(files);
          }}
        />
      </Field>
      <p className="p-muted">
        支持多张图片及多页 PDF，每批最多 100
        页。无需指定学生或框选题目；姓名或考号无法确认的页面会保留待确认，其余作业继续批改。
      </p>
      {uploading && <p role="status">正在上传并展开扫描页，请稍候…</p>}
      {failure && (
        <p className="p-notice error" role="alert">
          {failure}
        </p>
      )}
      {!!pages.length && (
        <details>
          <summary>已上传 {pages.length} 页 · 查看与移除</summary>
          <ul>
            {pages.map((page) => (
              <li key={page.id}>
                <a href={page.url} target="_blank" rel="noreferrer">
                  {page.name}
                </a>{" "}
                <button
                  type="button"
                  className="button secondary"
                  disabled={disabled}
                  onClick={() => setPages((current) => current.filter((p) => p.id !== page.id))}
                  aria-label={`移除 ${page.name}`}
                >
                  移除
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {classroom && (
        <p role="status">
          {classroom.students.length} 位学生 · 班内已录入的未评分作答 {pending.length} 份。
          {pages.length
            ? "本次将批改上传材料中的学生作答。"
            : "不上传材料时，将批量批改这些已录入作答。"}
        </p>
      )}
      <button
        className="button"
        disabled={disabled || !classroom || !selectedPaper || (!pages.length && !pending.length)}
      >
        {uploading ? "正在上传…" : busy ? "正在提交…" : "开始班级批量批改"}
      </button>
    </form>
  );
}
