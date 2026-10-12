"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { MAX_GRADING_QUESTIONS, gradeRequestSchema, type GradeSubmission, type GradeTaskSummary } from "@/contracts/grading";
import { apiRequest, jsonBody } from "@/lib/http-client";
import type { ExamTaskSummary } from "@/contracts/exam-tasks";
import { MathText } from "./math-text";

type Question = { id: string; number: string; section: string; stem: string; requiresReview: boolean };
export function GradingWorkspace({ examTaskId, title, model, questions, initialSubmissions, initialHistory, mathImages }: {
  examTaskId: string; title: string; model: string | null; questions: Question[]; initialSubmissions: GradeSubmission[]; initialHistory: GradeTaskSummary[];
  mathImages: Record<string, string>;
}) {
  const router = useRouter();
  const [referenceTask, setReferenceTask] = useState("");
  const [importNote, setImportNote] = useState("");
  const sources = useQuery({ queryKey: ["reference-sources"], queryFn: () => apiRequest<{ tasks: ExamTaskSummary[] }>("/api/exams") });
  const [answers, setAnswers] = useState(initialSubmissions);
  const [selected, setSelected] = useState(() => new Set(initialSubmissions.slice(0, MAX_GRADING_QUESTIONS).map((s) => s.questionId)));
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const history = useQuery({ queryKey: ["grade-history", examTaskId], queryFn: () => apiRequest<{ tasks: GradeTaskSummary[] }>(`/api/exams/${examTaskId}/grades`),
    initialData: { tasks: initialHistory }, refetchInterval: (query) => query.state.data?.tasks.some((t) => ["QUEUED", "RUNNING"].includes(t.status)) ? 2500 : false });
  const active = history.data.tasks.find((t) => ["QUEUED", "RUNNING"].includes(t.status));
  async function importReference() {
    setError(""); setBusy(true); setImportNote("");
    try {
      const source = await apiRequest<{ annotations: { number: string | null; section: string; partLabel: string | null; kind: string; text: string }[] }>(`/api/exams/${referenceTask}/reference`);
      setAnswers((old) => old.map((a, index) => {
        const question = questions[index];
        const matched = source.annotations.filter((n) => n.number === question.number && (n.section === question.section || (!n.section && questions.filter((q) => q.number === question.number).length === 1)));
        const refs = matched.filter((n) => n.kind === "reference_answer");
        if (!refs.length) return a;
        return { ...a, referenceAnswer: refs.map((n) => `${n.partLabel ?? ""} ${n.text}`).join("\n"), rubric: matched.filter((n) => n.kind === "rubric").map((n) => n.text).join("\n") || a.rubric };
      }));
      // State updates are scheduled; communicate that unmatched questions stay blank.
      setImportNote("已导入可对应的参考答案，请逐题核对。未能对应的题目保留原设置。");
    } catch (e) { setError(e instanceof Error ? e.message : "参考答案未能导入，请重试。"); }
    finally { setBusy(false); }
  }
  function update(id: string, value: Partial<GradeSubmission>) { setAnswers((old) => old.map((answer) => answer.questionId === id ? { ...answer, ...value, ...(value.answer !== undefined || value.unreadable !== undefined ? { answerEdited: true } : {}) } : answer)); }
  function toggle(id: string, checked: boolean) {
    if (checked && selected.size >= MAX_GRADING_QUESTIONS) { setError(`每次最多批改 ${MAX_GRADING_QUESTIONS} 道题，请先取消其他题目。`); return; }
    setSelected((old) => { const next = new Set(old); if (checked) next.add(id); else next.delete(id); return next; }); setError("");
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setError("");
    const input = gradeRequestSchema.safeParse({ submissions: answers.filter((a) => selected.has(a.questionId)) });
    if (!input.success) { setError(input.error.issues[0]?.message ?? "请检查批改内容。"); return; }
    setBusy(true);
    try {
      const response = await apiRequest<{ task: GradeTaskSummary }>(`/api/exams/${examTaskId}/grades`, { method: "POST", ...jsonBody(input.data) });
      router.push(`/grades/${response.task.id}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "提交失败，请重试。"); setBusy(false); }
  }

  return <>
    <Link href={`/exams/${examTaskId}`} className="back-link">返回识别结果</Link>
    <div className="workspace-heading"><h1>批改试卷</h1><p className="intro">{title} · {questions.length} 道题</p></div>
    <section className="grading-setup" aria-labelledby="grading-setup-heading">
      <h2 id="grading-setup-heading">核对作答</h2><p className="intro">已填入识别到的作答。你可以修改作答、补充参考答案和分值；留空的作答按未作答处理。</p>
      <p className="hint">批改会复用题套中已保存的标准答案；答案缺失时，请先补充。每次最多批改 {MAX_GRADING_QUESTIONS} 道题。</p>
      {!model && <p className="form-error">批改服务尚未准备好，请联系管理员。</p>}
      {active && <p className="setup-note">本卷正在批改。<Link href={`/grades/${active.id}`}>查看进度</Link></p>}
      <details className="advanced-settings"><summary>导入参考答案文件</summary><p className="hint">先在“试卷板块”上传答案文件并选择“整理空白试卷”，识别完成后在这里导入。</p><label>已识别的文件 <select value={referenceTask} onChange={(e) => setReferenceTask(e.target.value)}><option value="">选择参考答案文件</option>{sources.data?.tasks.filter((t) => t.id !== examTaskId && t.status === "COMPLETED").map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label><button className="button secondary" type="button" disabled={busy || !referenceTask || !!active} onClick={() => void importReference()}>导入并核对</button>{importNote && <p className="hint" role="status">{importNote}</p>}</details>
      <form onSubmit={submit}>
        <div className="grading-submit-row"><div><strong>已选择 {selected.size} 道题</strong></div><button className="button" disabled={busy || !model || !selected.size || !!active}>{busy ? "正在提交…" : "开始批改"}</button></div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <fieldset disabled={busy || !!active}>
          {questions.map((question, index) => {
            const answer = answers[index], id = `grade-input-${index}`;
            return <article className="grading-question-input" key={question.id}>
              <label className="grading-select"><input type="checkbox" checked={selected.has(question.id)} onChange={(e) => toggle(question.id, e.target.checked)} /><strong>{question.section} · 第 {question.number} 题</strong></label>
              <p className="exam-text question-preview"><MathText text={question.stem} images={mathImages} /></p>
              {question.requiresReview && <label className="checkbox-field"><input type="checkbox" checked={answer.questionConfirmed} onChange={(e) => update(question.id, { questionConfirmed: e.target.checked })} />已对照原图核对题目内容<p className="hint">识别结果有待核对提示；未确认时暂不自动判分。</p></label>}
              <details open={!answer.answer.trim() && selected.has(question.id)}>
                <summary>{answer.answer.trim() ? `作答：${answer.answer.slice(0, 80)}${answer.answer.length > 80 ? "…" : ""}` : "补充作答与评分设置"}</summary>
                <div className="grading-input-fields">
                  <div className="field"><label htmlFor={`${id}-answer`}>学生作答</label><textarea id={`${id}-answer`} rows={3} maxLength={12000} value={answer.answer} onChange={(e) => update(question.id, { answer: e.target.value })} placeholder="留空按未作答处理" /></div>
                  <label className="checkbox-field"><input type="checkbox" checked={answer.unreadable} onChange={(e) => update(question.id, { unreadable: e.target.checked })} />作答无法辨认，暂不判分</label>
                  <div className="field"><label htmlFor={`${id}-reference`}>参考答案（可选）</label><textarea id={`${id}-reference`} rows={3} maxLength={12000} value={answer.referenceAnswer} onChange={(e) => update(question.id, { referenceAnswer: e.target.value })} placeholder="填写已核对的参考答案；留空时复用题套标准答案" /></div>
                  <div className="grading-input-pair"><div className="field"><label htmlFor={`${id}-points`}>本题满分</label><input id={`${id}-points`} type="number" min={0} max={1000} step="0.01" value={answer.maxPoints ?? ""} onChange={(e) => update(question.id, { maxPoints: e.target.value === "" ? null : Number(e.target.value) })} placeholder="分值未知时留空" /></div>
                    <p className="hint">未设置满分时，可查看评语，分数需人工核对。</p></div>
                  <div className="field"><label htmlFor={`${id}-rubric`}>评分标准（可选）</label><textarea id={`${id}-rubric`} rows={2} maxLength={6000} value={answer.rubric} onChange={(e) => update(question.id, { rubric: e.target.value })} placeholder="例如各小题分值、步骤分、可接受的解法" /></div>
                </div>
              </details>
            </article>;
          })}
        </fieldset>
      </form>
    </section>
    <section className="exam-history" aria-labelledby="grade-history-heading"><div className="section-heading"><h2 id="grade-history-heading">批改记录</h2><button className="text-button" onClick={() => void history.refetch()} disabled={history.isFetching}>刷新记录</button></div>
      {history.error && <p className="form-error" role="alert">记录暂时无法更新，请刷新重试。</p>}
      {!history.data.tasks.length && <p className="history-empty muted">还没有批改记录。每次批改都会保留独立报告。</p>}
      {history.data.tasks.map((task) => <Link className="exam-row" href={`/grades/${task.id}`} key={task.id}><div><h3>{task.total} 道题</h3><p className="hint">{new Date(task.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</p></div><span className="task-status">{task.status === "COMPLETED" ? "查看批改报告" : task.status === "FAILED" ? "批改未完成" : `${task.progress} / ${task.total} 题已处理`}</span></Link>)}
    </section>
  </>;
}
