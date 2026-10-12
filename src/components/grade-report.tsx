"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { gradeReviewSchema, type GradeQuestionResult, type GradeTaskDetail } from "@/contracts/grading";
import { apiRequest, jsonBody } from "@/lib/http-client";
import { MathText } from "./math-text";

const verdicts = { correct: "正确", partial: "部分正确", incorrect: "错误", unanswered: "未作答", needs_review: "待核对" };
const phases: Record<string, string> = { queued: "等待后台开始批改", preparing: "正在准备批改资料", solving: "正在独立求解参考答案", verifying_reference: "正在独立核对参考答案", grading: "正在逐评分点批改", saved: "当前题已保存", done: "批改完成" };

function ReviewEditor({ question, taskId, onSaved }: { question: GradeQuestionResult; taskId: string; onSaved: () => Promise<unknown> }) {
  const [score, setScore] = useState(String(question.score ?? question.suggestedScore ?? ""));
  const [maximum, setMaximum] = useState(String(question.maxPoints ?? ""));
  const [note, setNote] = useState(""); const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function save(event: FormEvent) {
    event.preventDefault(); setError("");
    const input = gradeReviewSchema.safeParse({ questionId: question.questionId, score: Number(score), maxPoints: Number(maximum), note });
    if (!input.success) { setError(input.error.issues[0]?.message ?? "请检查分值。"); return; }
    setBusy(true);
    try { await apiRequest(`/api/grades/${taskId}`, { method: "PATCH", ...jsonBody(input.data) }); await onSaved(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "核对失败，请重试。"); }
    finally { setBusy(false); }
  }
  const id = `review-${question.questionId}`;
  return <details className="grade-review-editor"><summary>核对或调整分数</summary><form onSubmit={save}><fieldset disabled={busy}>
    <div className="grading-input-pair"><div className="field"><label htmlFor={`${id}-score`}>确认得分</label><input id={`${id}-score`} type="number" required min={0} max={1000} step="0.01" value={score} onChange={(e) => setScore(e.target.value)} /></div>
      <div className="field"><label htmlFor={`${id}-max`}>确认满分</label><input id={`${id}-max`} type="number" required min={0} max={1000} step="0.01" value={maximum} onChange={(e) => setMaximum(e.target.value)} /></div></div>
    <div className="field"><label htmlFor={`${id}-note`}>核对说明</label><textarea id={`${id}-note`} required rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="记录已核对的答案、分值或调整依据" /></div>
    <button className="button secondary" type="submit">{busy ? "正在保存…" : "确认分数并计入总分"}</button>
  </fieldset></form>{error && <p className="form-error" role="alert">{error}</p>}</details>;
}

export function GradeReport({ initialData }: { initialData: GradeTaskDetail }) {
  const query = useQuery({ queryKey: ["grade", initialData.task.id], queryFn: () => apiRequest<GradeTaskDetail>(`/api/grades/${initialData.task.id}`), initialData,
    refetchInterval: (query) => ["QUEUED", "RUNNING"].includes(query.state.data?.task.status ?? "QUEUED") ? 2500 : false });
  const { task, result } = query.data;
  const images = query.data.mathImages ?? {};
  const running = ["QUEUED", "RUNNING"].includes(task.status);
  return <>
    <Link href={`/exams/${task.examTaskId}/grade`} className="back-link">返回作答与批改设置</Link>
    <div className="workspace-heading"><h1>批改报告</h1><p className="intro">{task.model} · {task.total} 道题</p></div>
    {query.error && <p className="form-error" role="alert">最新进度暂时无法加载。<button className="text-button" onClick={() => void query.refetch()}>重新加载</button></p>}
    {running && <section className="recognition-progress" role="status" aria-labelledby="grading-progress-heading"><h2 id="grading-progress-heading">{phases[task.phase] ?? "正在批改"}</h2><progress max={task.total} value={task.progress} aria-label="已处理题目" /><p className="hint">已处理 {task.progress} / {task.total} 题。可以离开页面，稍后回来查看报告。</p></section>}
    {task.status === "FAILED" && <p className="review-note" role="alert">{task.error} <Link href={`/exams/${task.examTaskId}/grade`}>重新提交批改</Link></p>}
    {result && <>
      <div className="result-toolbar grade-summary"><div><strong>{result.totals.scoredQuestions ? `计入总分：${result.totals.awardedPoints} / ${result.totals.gradedMaxPoints} 分` : running ? "尚无已计分题目" : "等待核对分数"}</strong><p className="hint">已计分 {result.totals.scoredQuestions} 题 · 待核对 {result.totals.pendingQuestions} 题{result.totals.totalMaxPoints !== null ? ` · 已处理题目满分 ${result.totals.totalMaxPoints} 分` : " · 有题目分值未设置"}</p></div>
        {task.status === "COMPLETED" && <div className="inline-actions"><a className="button secondary" href={`/api/grades/${task.id}/download?format=markdown`}>下载批改报告</a><a className="text-button" href={`/api/grades/${task.id}/download`}>下载 JSON</a></div>}</div>
      <p className="hint grade-explanation">待核对的建议分数未计入总分。AI 推导的参考答案、主观评分和识别不清的内容需要核对；人工确认后会重新汇总。</p>
      {result.questions.map((question) => <article className="grade-question-result" key={question.questionId}>
        <div className="section-heading"><h2>{question.section} · 第 {question.number} 题</h2><div className="inline-actions"><a href={`/api/grades/${task.id}/source/${question.sourcePage}`} target="_blank" rel="noreferrer">查看原图</a><span className={`status-tag${question.needsReview ? " warning" : ""}`}>{question.review ? "已人工核对" : question.needsReview ? "待核对" : verdicts[question.verdict]}</span></div></div>
        <p className="question-preview exam-text"><MathText text={question.questionText} images={images} /></p>
        <div className="grade-score-line"><strong>{question.needsReview ? `建议得分：${question.suggestedScore ?? "暂未判分"}` : `计入得分：${question.score ?? "暂未判分"}`}{question.maxPoints !== null && ` / ${question.maxPoints} 分`}</strong><span className="hint">模型判定：{verdicts[question.verdict]}</span></div>
        <dl className="grade-answer-comparison"><div><dt>学生作答</dt><dd className="exam-text"><MathText text={question.studentAnswer || "未作答"} images={images} /></dd></div><div><dt>{question.referenceOrigin === "supplied" ? "已提供参考答案" : question.referenceOrigin === "model" ? "AI 推导参考答案" : "参考答案"}</dt><dd className="exam-text"><MathText text={question.expectedAnswer || "未生成"} images={images} /></dd></div></dl>
        <p className="exam-text grade-feedback"><MathText text={question.feedback} images={images} /></p>
        {question.needsReview && <ul className="grade-review-reasons">{question.reviewReasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>}
        {!!question.criteria.length && <details className="grade-criteria"><summary>查看 AI 评分点与依据</summary><div className="table-scroll"><table><caption className="sr-only">第 {question.number} 题评分点</caption><thead><tr><th scope="col">评分点</th><th scope="col">建议分数</th><th scope="col">依据</th></tr></thead><tbody>{question.criteria.map((criterion, index) => <tr key={index}><td>{criterion.description}</td><td>{criterion.awardedPoints} / {criterion.maxPoints}</td><td>{criterion.explanation}</td></tr>)}</tbody></table></div></details>}
        {question.review && <p className="hint">人工核对说明：{question.review.note} · {new Date(question.review.reviewedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</p>}
        {task.status === "COMPLETED" && <ReviewEditor key={`${question.questionId}-${question.review?.reviewedAt ?? "initial"}`} question={question} taskId={task.id} onSaved={() => query.refetch()} />}
      </article>)}
      <details className="verification-details"><summary>模型与用量记录</summary><p className="hint">提示词版本：{result.promptVersion}</p><p className="hint">模型调用 {result.usage.calls} 次 · 输入 {result.usage.inputTokens} token · 输出 {result.usage.outputTokens} token · 缓存读取 {result.usage.cachedInputTokens} token · 缓存写入 {result.usage.cacheWriteTokens} token</p><p className="hint">报告保留提交时的试卷、作答和 AI 配置。用量来自 API 返回值。</p></details>
    </>}
  </>;
}
