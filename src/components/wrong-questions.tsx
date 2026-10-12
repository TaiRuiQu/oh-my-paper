"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { TOPICS, type LearningOverview } from "@/contracts/learning";
import { apiRequest, jsonBody } from "@/lib/http-client";
import { MathText } from "./math-text";
export function WrongQuestions({ initialData }: { initialData: LearningOverview }) {
  const query = useQuery({ queryKey: ["learning"], queryFn: () => apiRequest<LearningOverview>("/api/learning"), initialData });
  const router = useRouter(); const [topic, setTopic] = useState(""); const [filter, setFilter] = useState("pending");
  const [busy, setBusy] = useState(""); const [error, setError] = useState("");
  const entries = query.data.entries.filter((e) => (!topic || e.topicId === topic) && (filter === "all" || (filter === "mastered" ? e.mastered : !e.mastered)));
  async function practice(key: string, mode: "original" | "similar") {
    setBusy(key); setError("");
    try { const result = await apiRequest<{ id: string }>("/api/practice", { method: "POST", ...jsonBody({ entryKey: key, mode }) }); router.push(`/practice/${result.id}`); }
    catch (e) { setError(e instanceof Error ? e.message : "练习暂时无法开始，请重试。"); setBusy(""); }
  }
  async function tag(key: string, topicId: string) {
    setError("");
    try { await apiRequest("/api/learning", { method: "PATCH", ...jsonBody({ entryKey: key, topicId }) }); await query.refetch(); }
    catch (e) { setError(e instanceof Error ? e.message : "分类未保存，请重试。"); }
  }
  return <>
    <div className="workspace-heading"><h1>错题本</h1><p className="intro">把没做对的题，再认真练一次。</p></div>
    <div className="learning-toolbar"><div className="inline-actions"><label>练习状态 <select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="pending">待巩固</option><option value="mastered">已巩固</option><option value="all">全部</option></select></label><label>知识点 <select value={topic} onChange={(e) => setTopic(e.target.value)}><option value="">全部知识点</option>{TOPICS.map((t) => <option key={t.id} value={t.id}>{t.subject} · {t.name}</option>)}</select></label></div><button className="text-button" onClick={() => void query.refetch()}>刷新错题</button></div>
    {!!query.data.topics.length && <section className="topic-summary" aria-label="优先练习的知识点"><h2>从这些知识点开始</h2><div className="inline-actions">{[...query.data.topics].sort((a,b) => b.count-a.count).slice(0,4).map((t) => <button className="button secondary" key={t.id} onClick={() => setTopic(t.id)}>{t.name} · {t.count} 题待巩固</button>)}</div><p className="hint">按待巩固题目数排序。连续两次原题练习正确后，标为已巩固。</p></section>}
    {query.data.pending > 0 && <p className="review-note">还有 {query.data.pending} 道题需要核对分数，确认后再归入错题本。</p>}
    {(error || query.error) && <p className="form-error" role="alert">{error || "暂时无法更新错题，请刷新重试。"}</p>}
    {!entries.length && <section className="empty-state"><h2>{query.data.entries.length ? "这个分类暂时没有错题" : "你的错题会保存在这里"}</h2><p>{query.data.entries.length ? "试试其他知识点或练习状态。" : "上传作答并完成批改，核对分数后就可以开始复习。"}</p><Link className="button" href="/dashboard">上传试卷</Link></section>}
    {entries.map((e) => <article className="wrong-question" key={e.key}><div className="section-heading"><h2>第 {e.number} 题</h2><span className="status-tag">{e.mastered ? "已巩固" : e.verdict}</span></div><p className="hint">{e.title} · {new Date(e.lastErrorAt).toLocaleDateString("zh-CN")}</p><p className="question-preview exam-text"><MathText images={query.data.mathImages ?? {}} text={e.stem} /></p><div className="inline-actions"><button className="button" disabled={!!busy} onClick={() => void practice(e.key,"original")}>{busy === e.key ? "准备练习…" : "再练一次"}</button><button className="text-button" disabled={!!busy} onClick={() => void practice(e.key,"similar")}>练相似题</button><Link href={`/grades/${e.gradeTaskId}`}>查看批改</Link></div><p className="hint">已重练 {e.attempts} 次 · 正确 {e.correctAttempts} 次</p><details className="advanced-settings"><summary>整理知识点</summary><label>本题知识点 <select value={e.topicId ?? ""} onChange={(event) => void tag(e.key,event.target.value)}><option value="" disabled>选择知识点</option>{TOPICS.map((t) => <option key={t.id} value={t.id}>{t.subject} · {t.name}</option>)}</select></label></details></article>)}
  </>;
}
