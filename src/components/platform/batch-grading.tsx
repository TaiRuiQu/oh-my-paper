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
  start: (kind: "GRADE", input: unknown) => Promise<{ id: string } | undefined>;
}) {
  const [assessmentId, setAssessmentId] = useState("");
  const [classroomId, setClassroomId] = useState("");
  const [paperId, setPaperId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [pages, setPages] = useState<UploadedPage[]>([]);
  const [pagesPerStudent, setPagesPerStudent] = useState(1);
  const [studentIds, setStudentIds] = useState<string[]>([]);
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
  const templates = (state.templates ?? []).filter((t) => t.paperId === selectedPaper && !t.preset);
  const selectedTemplate =
    templates.length === 1 ? templates[0].id : templates.find((t) => t.id === templateId)?.id;
  const needsTemplate = assessment?.kind === "EXAM" && pages.length > 0;
  const groupSize =
    assessment?.kind === "EXAM"
      ? (templates.find((t) => t.id === selectedTemplate)?.layout.pageCount ?? 0)
      : Number.isInteger(pagesPerStudent) &&
          pagesPerStudent >= 1 &&
          pagesPerStudent <= MAX_AI_BATCH_PAGES
        ? pagesPerStudent
        : 0;
  const groupCount = groupSize > 0 ? Math.ceil(pages.length / groupSize) : 0;
  const assignedStudents = studentIds.slice(0, groupCount);
  const groupingError =
    pages.length && groupSize > 0 && pages.length % groupSize
      ? `已上传 ${pages.length} 页，不能按每人 ${groupSize} 页完整分组，请补齐或移除多余页面。`
      : "";
  const invalidGrouping =
    pages.length > 0 &&
    (!groupSize ||
      !!groupingError ||
      assignedStudents.length !== groupCount ||
      assignedStudents.some((id) => !classroom?.students.some((s) => s.id === id)) ||
      new Set(assignedStudents).size !== groupCount);
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
          (needsTemplate && !selectedTemplate) ||
          invalidGrouping ||
          (!pages.length && !pending.length)
        )
          return;
        await start("GRADE", {
          assessmentId,
          classroomId,
          paperId: selectedPaper,
          assetUrls: pages.map((p) => p.url),
          ...(needsTemplate ? { templateId: selectedTemplate } : {}),
          ...(pages.length ? { pagesPerStudent: groupSize, studentIds: assignedStudents } : {}),
        });
      }}
    >
      <p>
        选择班级，按学生顺序上传练习册或答题卡。练习册按人定位作答并批改；考试按模板切题后，一次返回每位学生的整份评分。
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
              setTemplateId("");
              setStudentIds([]);
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
              setTemplateId("");
              setStudentIds([]);
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
            onChange={(e) => {
              setPaperId(e.target.value);
              setTemplateId("");
              setStudentIds([]);
            }}
          >
            <option value="">选择题本</option>
            {configs.map((p) => (
              <option key={p.paperId} value={p.paperId}>
                {p.subject} · {state.papers.find((paper) => paper.id === p.paperId)?.name}
              </option>
            ))}
          </select>
        </Field>
        {assessment?.kind === "EXAM" && (
          <Field label="答题卡模板">
            <select
              required={needsTemplate}
              disabled={disabled || !selectedPaper}
              value={selectedTemplate ?? ""}
              onChange={(e) => {
                setTemplateId(e.target.value);
                setStudentIds([]);
              }}
            >
              <option value="">选择扫描材料使用的模板</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        {assessment?.kind === "HOMEWORK" && (
          <Field label="每位学生页数">
            <input
              type="number"
              min={1}
              max={MAX_AI_BATCH_PAGES}
              step={1}
              required
              disabled={disabled}
              value={pagesPerStudent || ""}
              onChange={(e) => {
                setPagesPerStudent(Number(e.target.value));
                setStudentIds([]);
              }}
            />
          </Field>
        )}
      </div>
      {needsTemplate && !templates.length && (
        <p className="p-notice">请先为这套试卷创建答题卡模板，或直接批改已录入的作答。</p>
      )}
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
        支持多张图片及多页 PDF，每批最多 100 页。必须先上传第一个人的第 1 页、第 2
        页……，再上传第二个人的全部页面。PDF 按原页码展开；请按下面的分组指定学生。
      </p>
      {needsTemplate && groupSize > 0 && <p className="p-muted">答题卡模板每人 {groupSize} 页。</p>}
      {groupingError && (
        <p className="p-notice error" role="alert">
          {groupingError}
        </p>
      )}
      {classroom && groupCount > 0 && (
        <fieldset disabled={disabled}>
          <legend>按上传分组指定学生</legend>
          <div className="p-form-grid">
            {Array.from({ length: groupCount }, (_, index) => (
              <Field
                key={index}
                label={`第 ${index + 1} 位 · 上传第 ${index * groupSize + 1}–${Math.min((index + 1) * groupSize, pages.length)} 页`}
              >
                <select
                  required
                  value={studentIds[index] ?? ""}
                  onChange={(e) =>
                    setStudentIds((current) =>
                      Array.from({ length: groupCount }, (_, i) =>
                        i === index ? e.target.value : (current[i] ?? ""),
                      ),
                    )
                  }
                >
                  <option value="">选择这组材料的学生</option>
                  {classroom.students.map((s) => (
                    <option
                      key={s.id}
                      value={s.id}
                      disabled={assignedStudents.some((id, i) => i !== index && id === s.id)}
                    >
                      {s.studentNumber} · {s.name}
                    </option>
                  ))}
                </select>
              </Field>
            ))}
          </div>
        </fieldset>
      )}
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
                  onClick={() => {
                    setPages((current) => current.filter((p) => p.id !== page.id));
                    setStudentIds([]);
                  }}
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
        disabled={
          disabled ||
          !classroom ||
          !selectedPaper ||
          (needsTemplate && !selectedTemplate) ||
          invalidGrouping ||
          (!pages.length && !pending.length)
        }
      >
        {uploading ? "正在上传…" : busy ? "正在提交…" : "开始班级批量批改"}
      </button>
    </form>
  );
}
