"use client";
/* Authenticated source images retain the original resolution for reading diagrams. */
/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import type { PracticeView } from "@/contracts/learning";
import { apiRequest, jsonBody } from "@/lib/http-client";
import { MathText } from "./math-text";
export function Practice({ initialData }: { initialData: PracticeView }) {
  const query = useQuery({ queryKey: ["practice",initialData.id], queryFn: () => apiRequest<PracticeView>(`/api/practice/${initialData.id}`), initialData, refetchInterval: (q) => ["QUEUED","RUNNING"].includes(q.state.data?.status ?? "") || ["QUEUED","RUNNING"].includes(q.state.data?.handwriting?.status ?? "") ? 2000 : false });
  const task = query.data; const [answers, setAnswers] = useState<Record<string,string>>({}); const [busy,setBusy] = useState(false); const [error,setError] = useState("");
  const running = ["QUEUED","RUNNING"].includes(task.status);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await apiRequest(`/api/practice/${task.id}`,{method:"POST",...jsonBody({answers:task.questions.map((q)=>({id:q.id,answer:answers[q.id]??""}))})}); await query.refetch(); }
    catch(e) {setError(e instanceof Error?e.message:"提交失败，请重试。");} finally {setBusy(false);}
  }
  async function uploadHandwriting(files: File[]) {
    if (!files.length) return;
    setBusy(true); setError("");
    try { const body = new FormData(); files.forEach((f) => body.append("files", f)); await apiRequest(`/api/practice/${task.id}/handwriting`, { method: "POST", body }); await query.refetch(); }
    catch (e) { setError(e instanceof Error ? e.message : "手写文件未上传，请重试。"); }
    finally { setBusy(false); }
  }
  return <><Link className="back-link" href="/wrong-questions">返回错题本</Link><div className="workspace-heading"><h1>{task.mode === "original" ? "再练一次" : "相似题练习"}</h1><p className="intro">先独立作答，提交后查看答案与反馈。</p></div>
    {(error||query.error)&&<p className="form-error" role="alert">{error||"暂时无法更新进度，请刷新页面。"}</p>}
    {running&&<section className="recognition-progress" role="status"><h2>{task.submitted?"正在批改你的练习":"正在准备并核对练习题"}</h2><p>你可以稍后回来，练习进度会保留。</p></section>}
    {task.status==="FAILED"&&<p className="review-note" role="alert">{task.error} <Link href="/wrong-questions">返回错题本重试</Link></p>}
    {!!task.questions.length&&!task.submitted&&<details className="advanced-settings"><summary>上传手写作答</summary><label htmlFor="handwriting-files">作答照片或 PDF</label><input id="handwriting-files" type="file" multiple accept=".pdf,.jpg,.jpeg,.png" disabled={busy || running} onChange={(e) => { void uploadHandwriting(Array.from(e.target.files ?? [])); e.target.value = ""; }} /><p className="hint">可以先在纸上完成练习，再上传清晰照片。请标明题号。</p>{task.handwriting && <><p className="hint" role="status">{["QUEUED","RUNNING"].includes(task.handwriting.status) ? "正在识别手写作答…" : task.handwriting.message}</p>{task.handwriting.status === "COMPLETED" && <button type="button" className="button secondary" onClick={() => setAnswers({ ...answers, ...Object.fromEntries(task.handwriting!.answers.filter((a) => a.answer).map((a) => [a.id, a.answer])) })}>填入识别作答</button>}</>}</details>}
    {!!task.questions.length&&!task.submitted&&<form onSubmit={submit}><fieldset disabled={busy||running}>{task.questions.map((q,i)=><article className="wrong-question" key={q.id}><h2>第 {i+1} 题</h2><p className="exam-text question-preview"><MathText images={task.mathImages ?? {}} text={q.stem}/></p>{q.figures?.map((f) => <figure className="exam-figure" key={f.url}><img src={f.url} alt={f.caption} /><figcaption>{f.caption}</figcaption></figure>)}<div className="field"><label htmlFor={`answer-${i}`}>你的作答</label><textarea id={`answer-${i}`} required rows={4} maxLength={12000} value={answers[q.id]??""} onChange={(e)=>setAnswers({...answers,[q.id]:e.target.value})} placeholder="写下答案和解题过程"/></div></article>)}<button className="button" type="submit">{busy?"正在提交…":"提交作答"}</button></fieldset></form>}
    {task.result&&<><p className="review-note">{task.result.totals.pendingQuestions?"有题目暂时无法确认分数，本次不计为已巩固。":task.mode === "original" ? "本次结果已保存。连续两次原题练习正确后，该题会标为已巩固。" : "本次练习结果已保存。回到错题本继续巩固。"}</p>{task.result.questions.map((q,i)=><article className="wrong-question" key={q.questionId}><div className="section-heading"><h2>第 {i+1} 题</h2><span className="status-tag">{q.needsReview?"待核对":q.score===q.maxPoints?"正确":"再想一想"}</span></div><p className="exam-text question-preview"><MathText images={task.mathImages ?? {}} text={q.questionText}/></p><dl><div><dt>你的作答</dt><dd><MathText images={task.mathImages ?? {}} text={q.studentAnswer}/></dd></div><div><dt>参考答案</dt><dd><MathText images={task.mathImages ?? {}} text={q.expectedAnswer}/></dd></div></dl><p className="grade-feedback"><MathText images={task.mathImages ?? {}} text={q.feedback}/></p></article>)}<Link className="button" href="/wrong-questions">回到错题本</Link></>}
  </>;
}
