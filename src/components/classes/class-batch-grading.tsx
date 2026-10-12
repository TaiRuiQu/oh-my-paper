"use client";
import Link from "next/link";
import type { ClassroomSummary } from "@/contracts/classes";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import type { ClassWorkspace } from "./use-classes";

export function ClassBatchGrading({
  current,
  workspace,
}: {
  current: ClassroomSummary;
  workspace: ClassWorkspace;
}) {
  const {
    templates,
    query,
    busy,
    drafts,
    student,
    batch,
    files,
    create,
    upload,
    submitBatch,
    setBatch,
    setStudent,
    setDrafts,
    setFiles,
  } = workspace;
  return (
    <section className="account-section">
      <div className="section-heading">
        <h2>批改批次</h2>
        <button className="text-button" onClick={() => void query.refetch()}>
          刷新进度
        </button>
      </div>
      <details className="advanced-settings" open={!current.batches.length}>
        <summary>创建批次</summary>
        <form onSubmit={(e) => void create(e, "/api/classes/batches")}>
          <Input type="hidden" name="classroomId" value={current.id} />
          <div className="field">
            <label htmlFor="batch-name">本次试卷名称</label>
            <Input
              id="batch-name"
              name="name"
              required
              maxLength={80}
              placeholder="例如：第一单元练习"
            />
          </div>
          <div className="field">
            <label htmlFor="batch-template">空白题套</label>
            <select id="batch-template" name="templateId" required>
              <option value="">选择已解析并保存答案的题套</option>
              {templates.data?.tasks
                .filter((t) => t.status === "COMPLETED" && !t.autoGrade && !t.batchId)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
            <p className="hint">
              使用创建批次时的题套版本与标准答案。
              <Link href="/dashboard">上传新的空白题套</Link>
            </p>
          </div>
          <button className="button secondary" disabled={busy || !current.students.length}>
            创建批次
          </button>
        </form>
      </details>
      {!!current.batches.length && (
        <form className="batch-upload" onSubmit={upload}>
          <div className="field">
            <label htmlFor="batch-choice">上传到批次</label>
            <select
              id="batch-choice"
              required
              value={batch}
              onChange={(e) => setBatch(e.target.value)}
            >
              <option value="">选择批次</option>
              {current.batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="student-choice">这份作答属于</label>
            <select
              id="student-choice"
              required
              value={student}
              onChange={(e) => setStudent(e.target.value)}
            >
              <option value="">选择学生</option>
              {current.students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.number} · {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="batch-files">学生作答文件</label>
            <Input
              id="batch-files"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              multiple
              required
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
            <p className="hint">
              多张照片合并为这位学生的一份作答。提交后可继续添加下一位，任务独立处理。
            </p>
          </div>
          <button className="button" disabled={busy || !files.length || !batch || !student}>
            加入待批改列表
          </button>
        </form>
      )}
      {!!drafts.length && (
        <section className="account-section">
          <h3>待批改 · {drafts.length} 份作答</h3>
          <ul className="upload-files">
            {drafts.map((d, i) => (
              <li key={i}>
                {current.students.find((s) => s.id === d.studentId)?.name} ·{" "}
                {d.files.map((f) => f.name).join("、")}{" "}
                <button
                  className="text-button"
                  type="button"
                  disabled={busy}
                  onClick={() => setDrafts(drafts.filter((_, j) => i !== j))}
                >
                  移除
                </button>
              </li>
            ))}
          </ul>
          <button className="button" disabled={busy} onClick={() => void submitBatch()}>
            {busy ? "正在提交批次…" : "批改全部作答"}
          </button>
          <p className="hint">每位学生独立处理。提交失败的作答保留在列表中，可再次提交。</p>
        </section>
      )}
      {current.batches.map((b) => (
        <article className="wrong-question" key={b.id}>
          <h3>{b.name}</h3>
          <p className="hint">题套：{b.templateName ?? "旧批次未关联题套"}</p>
          {!b.exams.length ? (
            <p className="hint">还没有上传学生作答。</p>
          ) : (
            <div className="table-scroll">
              <Table>
                <caption className="sr-only">{b.name}成绩</caption>
                <TableHeader>
                  <TableRow>
                    <TableHead>学生</TableHead>
                    <TableHead>进度</TableHead>
                    <TableHead>已计分</TableHead>
                    <TableHead>待核对</TableHead>
                    <TableHead>报告</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {b.exams.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell>
                        {e.number} · {e.student}
                      </TableCell>
                      <TableCell>{e.status}</TableCell>
                      <TableCell>
                        {e.score === null || e.maximum === 0
                          ? "待核对"
                          : `${e.score} / ${e.maximum}`}
                      </TableCell>
                      <TableCell>{e.pending ?? "—"}</TableCell>
                      <TableCell>
                        <Link href={e.gradeId ? `/grades/${e.gradeId}` : `/exams/${e.id}`}>
                          查看
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </article>
      ))}
    </section>
  );
}
