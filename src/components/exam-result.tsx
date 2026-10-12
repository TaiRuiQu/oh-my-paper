"use client";

import { QuestionEditor } from "./question-editor";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import type { ContentBlock } from "@/contracts/exams";
import type { ExamTaskDetail, ExamTaskSummary } from "@/contracts/exam-tasks";
import { apiRequest } from "@/lib/http-client";

const statusText = { verified: "识别完成", needs_review: "有内容需要人工核对", partial: "部分页面未完成识别" };
const annotationLabels = { student_answer: "学生作答", reference_answer: "参考答案", teacher_annotation: "教师批注", rubric: "评分标准" };
const phaseText: Record<string, string> = { queued: "试卷已提交，等待后台开始识别。", preparing: "正在转换文件并准备清晰的页面图像。", parsing: "正在识别题干、选项、公式和配图。", verifying: "正在对照原图核对识别内容。", saved: "当前页已保存，继续处理下一页。", failed: "当前页未完成，正在保留可恢复的内容。" };

export function ExamResult({ initialTask }: { initialTask: ExamTaskSummary }) {
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<"questions" | "annotations">("questions");
  const [retrying, setRetrying] = useState(false);
  const [actionError, setActionError] = useState("");
  const data = useQuery({ queryKey: ["exam", initialTask.id], queryFn: () => apiRequest<ExamTaskDetail>(`/api/exams/${initialTask.id}`),
    refetchInterval: (query) => !query.state.data || ["QUEUED", "RUNNING"].includes(query.state.data.task.status) ? 2500 : false });
  const task = data.data?.task ?? initialTask;
  const exam = data.data?.exam;
  const images = data.data?.mathImages ?? {};
  const fileURL = (key: string) => `/api/exams/${task.id}/files/${key.split("/").map(encodeURIComponent).join("/")}`;

  async function cancel() {
    setActionError("");
    try { await apiRequest(`/api/exams/${task.id}/cancel`, { method: "POST" }); await data.refetch(); }
    catch (e) { setActionError(e instanceof Error ? e.message : "取消未成功，请重试。"); }
  }
  async function retry() {
    setRetrying(true); setActionError("");
    try { await apiRequest(`/api/exams/${task.id}/retry`, { method: "POST" }); await data.refetch(); }
    catch (error) { setActionError(error instanceof Error ? error.message : "提交失败，请重试。"); }
    finally { setRetrying(false); }
  }
  function math(latex: string) {
    // SVGs are displayed in the browser's isolated image context, never inserted as HTML.
    // eslint-disable-next-line @next/next/no-img-element
    return typeof images[latex] === "string" ? <img className="math-image" src={images[latex]} alt={latex} /> : <code className="math-fallback">{latex}</code>;
  }
  function textWithMath(text: string) {
    const pieces: ReactNode[] = []; let cursor = 0;
    for (const match of text.matchAll(/\$\$([\s\S]+?)\$\$|\$([^$\n]+)\$/g)) {
      pieces.push(text.slice(cursor, match.index), <span key={match.index}>{math(match[1] ?? match[2])}</span>);
      cursor = match.index + match[0].length;
    }
    pieces.push(text.slice(cursor)); return pieces;
  }
  function blocks(content: ContentBlock[], keyPrefix: string) {
    return content.map((block, index) => {
      const key = `${keyPrefix}-${index}`;
      if (block.type === "text") return <p className="exam-text" key={key}>{textWithMath(block.text)}</p>;
      if (block.type === "math") return <div className="math-block" key={key}>{math(block.latex)}</div>;
      if (block.type === "table") return <div className="table-scroll" key={key}><table><caption className="sr-only">试卷表格</caption><tbody>{block.rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{textWithMath(cell)}</td>)}</tr>)}</tbody></table></div>;
      const asset = exam?.assets.find((asset) => JSON.stringify(asset.region) === JSON.stringify(block.region));
      return <figure className="exam-figure" key={key}>{asset?.cleanKey ? <>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={fileURL(asset.cleanKey)} alt={block.caption} loading="lazy" />
      </> : <p className="review-note">配图需核对，请查看原图{asset && <>或<Link href={fileURL(asset.evidenceKey)} target="_blank">查看图形证据</Link></>}。</p>}<figcaption>{block.caption}</figcaption></figure>;
    });
  }
  const currentPage = exam?.pages.find((item) => item.page === page) ?? exam?.pages[0];
  const selectedPage = currentPage?.page ?? page;
  const questions = exam?.questions.filter((question) => question.regions.some((region) => region.page === selectedPage)) ?? [];
  const materials = exam?.materials.filter((material) => material.regions.some((region) => region.page === selectedPage) || questions.some((q) => q.materialRefs.includes(material.key))) ?? [];

  return <>
    <Link href="/dashboard" className="back-link">返回我的试卷</Link>
    <div className="workspace-heading result-heading"><h1>{exam?.title || task.name}</h1><p className="intro">{exam ? `${exam.pages.length} 页 · ${exam.questions.length} 道题` : "正在处理你的试卷"}</p></div>
    {data.error && <div className="review-note" role="alert"><p>暂时无法加载最新结果，请重试。</p><button className="text-button" onClick={() => void data.refetch()}>重新加载</button></div>}
    {actionError && <p className="form-error" role="alert">{actionError}</p>}
    {["QUEUED", "RUNNING"].includes(task.status) && <section className="recognition-progress" aria-labelledby="progress-heading" role="status">
      <h2 id="progress-heading">{task.status === "QUEUED" ? "等待识别" : "正在识别试卷"}</h2><p>{phaseText[task.phase] ?? "正在处理试卷。"}</p>
      {task.totalPages > 0 && <><progress max={task.totalPages} value={Math.max(0, task.page - (task.phase === "saved" ? 0 : 1))} aria-label="已处理页面" /><p className="hint">当前第 {task.page} / {task.totalPages} 页</p></>}
      <p className="hint">多页试卷可能需要几分钟。你可以离开页面，后台会继续处理。</p>
      {task.status === "QUEUED" && <p className="hint">若长时间没有开始，请联系管理员检查处理服务。</p>}<button className="text-button" onClick={() => void cancel()}>取消处理</button>
    </section>}
    {task.status === "FAILED" && <section className="recognition-progress" aria-labelledby="failure-heading"><h2 id="failure-heading">识别未完成</h2><p className="form-error">{task.error}</p><button className="button" disabled={retrying} onClick={() => void retry()}>{retrying ? "正在提交…" : "重新识别"}</button><p className="hint">请确认文件清晰、完整，再重新提交。</p></section>}
    {task.status === "COMPLETED" && !exam && !data.error && <p className="setup-note" role="status">正在加载识别结果…</p>}
    {exam && <>
      <div className="result-toolbar"><div><strong>{statusText[exam.verification.status]}</strong><p className="hint">模型核对后仍可能有误，请对照原图确认。</p></div><div className="inline-actions">{!!exam.questions.length && <Link className="button" href={`/exams/${task.id}/grade`}>核对作答并批改</Link>}<a className="button secondary" href={`${fileURL("exam.html")}?download`}>下载试卷</a><details className="technical-download"><summary>更多下载</summary><a href={`${fileURL("exam.json")}?download`}>结构化数据</a><br /><a href={`${fileURL("exam.md")}?download`}>文本与公式</a></details></div></div>
      {!!exam.verification.findings.length && <details className="review-findings" ><summary>{exam.verification.findings.length} 条待核对提示</summary><ul>{exam.verification.findings.map((finding, index) => <li key={index}><button className="text-button" onClick={() => setPage(finding.page)}>第 {finding.page} 页{finding.questionNumber ? ` · 第 ${finding.questionNumber} 题` : ""}</button><p>{finding.severity === "error" ? "本处内容未能完整识别，请对照原图核对。" : "本处识别内容可能有误，请对照原图确认。"}</p></li>)}</ul></details>}
      <div className="result-controls"><label htmlFor="source-page">查看页面 <select id="source-page" value={selectedPage} onChange={(e) => setPage(Number(e.target.value))}>{exam.pages.map((page) => <option key={page.page} value={page.page}>第 {page.page} 页{page.status === "failed" ? "（识别失败）" : ""}</option>)}</select></label>
        <div className="inline-actions" role="group" aria-label="识别内容类型"><button className={`tab-button${tab === "questions" ? " is-active" : ""}`} aria-pressed={tab === "questions"} onClick={() => setTab("questions")}>题目与材料</button><button className={`tab-button${tab === "annotations" ? " is-active" : ""}`} aria-pressed={tab === "annotations"} onClick={() => setTab("annotations")}>作答与批注</button></div></div>
      <div className="exam-comparison">
        <section className="source-panel" aria-labelledby="source-heading"><div className="section-heading"><h2 id="source-heading">原图 · 第 {selectedPage} 页</h2>{currentPage && <a href={fileURL(currentPage.key)} target="_blank" rel="noreferrer">放大查看</a>}</div>
          {currentPage && <a href={fileURL(currentPage.key)} target="_blank" rel="noreferrer" aria-label={`放大查看第 ${selectedPage} 页原图`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="source-image" src={fileURL(currentPage.key)} alt={`试卷第 ${selectedPage} 页原图`} />
          </a>}
        </section>
        <section className="transcription-panel" aria-labelledby="transcription-heading"><h2 id="transcription-heading">{tab === "questions" ? "识别内容" : "作答与批注"}</h2>
          {tab === "questions" ? <>
            {selectedPage === 1 && !!exam.instructions.length && <div className="exam-instructions">{exam.instructions.map((instruction, index) => <p key={index}>{textWithMath(instruction)}</p>)}</div>}
            {materials.map((material) => <article className="exam-material" key={material.key}><h3>{material.title || "共用材料"}</h3>{blocks(material.blocks, material.key)}</article>)}
            {questions.map((question) => <article className="exam-question" key={question.id}><div className="section-heading"><h3>{question.section && <span className="muted">{question.section} · </span>}第 {question.number} 题{question.points !== null && <span className="hint">（{question.points} 分）</span>}</h3>{question.status === "needs_review" && <span className="status-tag warning">需核对</span>}</div>
              {blocks(question.blocks, question.id)}{question.options.map((option) => <div className="exam-option" key={option.label}><strong>{option.label}.</strong><div>{blocks(option.blocks, `${question.id}-${option.label}`)}</div></div>)}
              {question.parts.map((part, index) => <div className="exam-part" key={index}><strong>{part.parentLabel ? `${part.parentLabel} ` : ""}{part.label}</strong>{blocks(part.blocks, `${question.id}-part-${index}`)}</div>)}
              {question.regions.length > 1 && <p className="hint">本题涉及第 {[...new Set(question.regions.map((r) => r.page))].join("、")} 页，请结合原图核对。</p>}
              {task.outputKey && <QuestionEditor key={`${question.id}-${task.outputKey}`} question={question} examId={task.id} outputKey={task.outputKey} onSaved={() => data.refetch()} />}
            </article>)}
            {!questions.length && !materials.length && <p className="setup-note muted">本页没有识别出题目。若为答题卡或答案页，可切换到“作答与批注”；若原图包含题目，请检查核对提示。</p>}
          </> : <>
            <p className="hint">下载的试卷仅包含题目和材料。</p>
            {exam.annotations.filter((annotation) => annotation.regions.some((region) => region.page === selectedPage)).map((annotation, index) => <article className="exam-question" key={index}><h3>{annotationLabels[annotation.kind]}{annotation.questionNumber && ` · 第 ${annotation.questionNumber} 题`}</h3>{blocks(annotation.blocks, `annotation-${index}`)}</article>)}
            {!exam.annotations.some((annotation) => annotation.regions.some((region) => region.page === selectedPage)) && <p className="setup-note muted">本页没有识别到作答或批注。</p>}
          </>}
        </section>
      </div>
      <details className="verification-details"><summary>识别与核对记录</summary><p className="hint">核对模型：{task.model}</p>{exam.verification.corrections.filter((item) => item.changes.length).map((item) => <div key={item.page}><h3>第 {item.page} 页的修正</h3><ul>{item.changes.map((change, i) => <li key={i}>{change}</li>)}</ul></div>)}<a href={`${fileURL("verification.json")}?download`}>下载核对记录</a></details>
      <details className="verification-details"><summary>重新识别这份试卷</summary><p className="hint">重新识别后，这里会展示新的结果。</p><button className="button secondary" disabled={retrying} onClick={() => void retry()}>{retrying ? "正在提交…" : "重新识别"}</button></details>
    </>}
  </>;
}
