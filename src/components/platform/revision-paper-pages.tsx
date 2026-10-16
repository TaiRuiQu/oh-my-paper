"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { MarkdownText } from "@/components/markdown-text";
import { apiRequest, jsonBody } from "@/lib/http-client";
import { aiJobHref } from "@/lib/ai-job-display";
import { revisionPaperHref, revisionSourceKey, uniqueReplayQuestions } from "@/lib/revision-papers";
import { useDomain } from "./domain-provider";
import { MissingRecord, PageHeader } from "./page-header";
import { Empty, Field, Panel } from "./primitives";
import { QuestionBody } from "./questions";
import { DocumentExport } from "./document-export";
import { DocumentCanvas, PaperText } from "./document-canvas";
import { DocumentQuestionBody } from "./document-question";
import { StudentIdentity } from "./student-identity";
import { WorkbookAnswerSpace } from "./workbook-answer-space";
import { documentAnswerSpaceMm } from "@/lib/document-layout";
import styles from "./revision-papers.module.css";

export function RevisionPaperLink({
  studentId,
  assessmentId,
  kind,
  subject,
}: {
  studentId: string;
  assessmentId?: string;
  kind?: "EXAM" | "HOMEWORK";
  subject?: string;
}) {
  const query = new URLSearchParams({ studentId });
  if (assessmentId) query.set("assessmentId", assessmentId);
  if (kind) query.set("kind", kind);
  if (subject) query.set("subject", subject);
  return (
    <div className="p-actions">
      <Button asChild variant="outline">
        <Link href={`/workspace/revision-papers?${query}`}>错题复现</Link>
      </Button>
      <Button asChild>
        <Link href={`/workspace/revision-papers?${query}&mode=CONSOLIDATE`}>生成巩固卷</Link>
      </Button>
    </div>
  );
}

export function RevisionPaperBuilder({
  initialStudentId = "",
  initialAssessmentId = "",
  initialKind = "",
  initialMode = "REPLAY",
  initialSubject = "",
}: {
  initialStudentId?: string;
  initialAssessmentId?: string;
  initialKind?: string;
  initialMode?: string;
  initialSubject?: string;
}) {
  const { state, refresh, notify } = useDomain();
  const router = useRouter();
  const [studentId, setStudentId] = useState(
    initialStudentId || state.analytics.students[0]?.studentId || "",
  );
  const [subject, setSubject] = useState(initialSubject);
  const [assessmentId, setAssessmentId] = useState(initialAssessmentId);
  const [kind, setKind] = useState(initialKind);
  const [mode, setMode] = useState(initialMode === "CONSOLIDATE" ? "CONSOLIDATE" : "REPLAY");
  const [name, setName] = useState("");
  const [modelId, setModelId] = useState("");
  const [count, setCount] = useState(5);
  const [score, setScore] = useState(5);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ id: string; count: number } | null>(null);
  const submitting = useRef(false);
  const createdId = useRef<string | null>(null);
  const [savedLimit, setSavedLimit] = useState(20);
  const models = useQuery({
    queryKey: ["revision-paper-models"],
    enabled: mode === "CONSOLIDATE",
    queryFn: () => apiRequest<{ models: { id: string; name: string }[] }>("/api/platform/ai"),
  });
  const report = state.analytics.students.find((r) => r.studentId === studentId);
  const subjects = [...new Set(report?.wrongQuestions.map((w) => w.question.subject) ?? [])];
  const activeSubject = subjects.includes(subject) ? subject : (subjects[0] ?? "");
  const wrong = (report?.wrongQuestions ?? []).filter(
    (w) =>
      w.question.subject === activeSubject &&
      (!assessmentId || w.assessmentId === assessmentId) &&
      (!kind || state.assessments.find((a) => a.id === w.assessmentId)?.kind === kind),
  );
  const selected = wrong.filter((w) => !excluded.has(revisionSourceKey(w)));
  const unique = uniqueReplayQuestions(selected);
  const students = state.classrooms.flatMap((c) => c.students);
  const studentName = students.find((s) => s.id === studentId)?.name ?? state.actor.name;
  const title = mode === "REPLAY" ? "错题复现卷" : "巩固卷";
  const paperName = name.trim() || `${studentName}·${activeSubject}${title}`;
  const activeModel = modelId || models.data?.models[0]?.id || "";
  const saved = state.papers.filter((p) => p.ownerId === state.actor.id && p.kind === "HOMEWORK");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || createdId.current) return;
    submitting.current = true;
    setError("");
    setBusy(true);
    try {
      const input = {
        studentId,
        subject: activeSubject,
        name: paperName,
        sources: selected.map(({ assessmentId, itemId }) => ({ assessmentId, itemId })),
      };
      if (mode === "REPLAY") {
        const result = await apiRequest<{ id: string; count: number }>(
          "/api/platform/revision-papers",
          { method: "POST", ...jsonBody(input) },
        );
        createdId.current = result.id;
        setCreated(result);
        notify(`已生成 ${result.count} 道题的错题复现卷。`);
        try {
          await refresh();
        } catch {
          setError("题本已生成，但最新资料读取失败。请打开已生成题本或重新读取，无需再次生成。");
          return;
        }
        router.push(revisionPaperHref(result.id));
      } else {
        const result = await apiRequest<{ id: string }>("/api/platform/ai", {
          method: "POST",
          ...jsonBody({
            kind: "CONSOLIDATE",
            modelId: activeModel,
            input: { ...input, count, score },
          }),
        });
        router.push(aiJobHref(result.id));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成失败，请重试。");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader
        title="错题复习组卷"
        description="选择学生、学科和错题，整理原题复习，或从题库生成针对薄弱点的巩固卷。"
      />
      {created && (
        <Panel
          title="错题复现卷已生成"
          description={`已保存 ${created.count} 道题，请打开该题本继续。`}
        >
          <div className="p-panel-content">
            {error && <p role="alert">{error}</p>}
            <div className="p-actions">
              <a className="button" href={revisionPaperHref(created.id)}>
                打开已生成题本
              </a>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={async () => {
                  if (submitting.current) return;
                  submitting.current = true;
                  setBusy(true);
                  try {
                    await refresh();
                    setError("");
                    router.push(revisionPaperHref(created.id));
                  } catch {
                    setError("题本已生成，重新读取仍失败。可直接打开已生成题本，无需再次生成。");
                  } finally {
                    submitting.current = false;
                    setBusy(false);
                  }
                }}
              >
                {busy ? "正在读取…" : "重新读取并打开题本"}
              </Button>
            </div>
          </div>
        </Panel>
      )}
      <Panel title="生成设置">
        <form onSubmit={submit} className="p-panel-content">
          <fieldset disabled={busy || !!created} className={styles.fieldset}>
            <div className="p-form-grid">
              <Field label="学生">
                <select
                  aria-label="选择学生"
                  value={studentId}
                  onChange={(e) => {
                    setStudentId(e.target.value);
                    setSubject("");
                    setAssessmentId("");
                    setExcluded(new Set());
                  }}
                >
                  {!state.analytics.students.length && <option value="">暂无学习数据</option>}
                  {state.analytics.students.map((r) => (
                    <option key={r.studentId} value={r.studentId}>
                      {students.find((s) => s.id === r.studentId)?.name ?? state.actor.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="学科">
                <select
                  aria-label="选择复习学科"
                  value={activeSubject}
                  onChange={(e) => setSubject(e.target.value)}
                >
                  {!subjects.length && <option value="">暂无错题</option>}
                  {subjects.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </Field>
              <Field label="错题来源">
                <select
                  aria-label="筛选错题来源"
                  value={kind}
                  onChange={(e) => {
                    setKind(e.target.value);
                    setAssessmentId("");
                  }}
                >
                  <option value="">全部作业与考试</option>
                  <option value="HOMEWORK">作业</option>
                  <option value="EXAM">考试</option>
                </select>
              </Field>
              <Field label="教学安排">
                <select
                  aria-label="筛选教学安排"
                  value={assessmentId}
                  onChange={(e) => setAssessmentId(e.target.value)}
                >
                  <option value="">全部安排</option>
                  {state.assessments
                    .filter(
                      (a) =>
                        (!kind || a.kind === kind) &&
                        report?.wrongQuestions.some((w) => w.assessmentId === a.id),
                    )
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="生成方式">
                <select
                  aria-label="生成方式"
                  value={mode}
                  onChange={(e) => {
                    setMode(e.target.value);
                    setError("");
                  }}
                >
                  <option value="REPLAY">错题复现 · 重做原题</option>
                  <option value="CONSOLIDATE">巩固卷 · 练习相近新题</option>
                </select>
              </Field>
              <Field label="题本名称">
                <input
                  aria-label="题本名称"
                  value={name}
                  maxLength={200}
                  placeholder={paperName}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
            </div>
            <p className="p-muted">
              {mode === "REPLAY"
                ? "保留原题、配图、完整小问和原分值；相同版本且分值相同的重复题目合并为一题。"
                : "根据所选错题的失分知识点，由 AI 从同学科、同适用年级题库选取未作答的新题。题库不足时请减少题数或补充题库。"}
            </p>
            {mode === "CONSOLIDATE" && (
              <div className="p-form-grid">
                <Field label="题目数量">
                  <input
                    aria-label="巩固卷题目数量"
                    required
                    type="number"
                    min={1}
                    max={20}
                    value={count}
                    onChange={(e) => setCount(Number(e.target.value))}
                  />
                </Field>
                <Field label="每题分值">
                  <input
                    aria-label="巩固卷每题分值"
                    required
                    type="number"
                    min={0.5}
                    max={100}
                    step="any"
                    value={score}
                    onChange={(e) => setScore(Number(e.target.value))}
                  />
                </Field>
                <Field label="AI 模型">
                  <select
                    aria-label="巩固卷 AI 模型"
                    required
                    value={activeModel}
                    onChange={(e) => setModelId(e.target.value)}
                  >
                    {!models.data?.models.length && (
                      <option value="">
                        {models.isPending ? "正在加载模型…" : "暂无可用模型"}
                      </option>
                    )}
                    {models.data?.models.map((model) => (
                      <option value={model.id} key={model.id}>
                        {model.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            )}
            {models.isError && mode === "CONSOLIDATE" && (
              <p role="alert">
                模型加载失败。
                <button className="link-button" type="button" onClick={() => void models.refetch()}>
                  重新加载
                </button>
              </p>
            )}
            <div className={styles.summary} aria-live="polite">
              <span>
                已选 {selected.length} 条错题记录
                {mode === "REPLAY"
                  ? `，生成 ${unique.length} 题 / ${unique.reduce((n, w) => n + w.maximum, 0)} 分`
                  : `，生成 ${count} 题 / ${count * score} 分`}
              </span>
              <Button
                disabled={
                  busy ||
                  !!created ||
                  !selected.length ||
                  selected.length > 500 ||
                  (mode === "CONSOLIDATE" && !activeModel)
                }
                aria-busy={busy}
              >
                {busy ? "正在提交…" : mode === "REPLAY" ? "生成错题复现卷" : "AI 生成巩固卷"}
              </Button>
            </div>
            {selected.length > 500 && <p role="alert">每次最多选择 500 条错题，请缩小范围。</p>}
            {error && !created && (
              <p role="alert" className="field-error">
                {error}
              </p>
            )}
          </fieldset>
        </form>
      </Panel>
      <Panel title="选择错题" description="勾选需要重做的原题，或作为生成巩固卷的学习依据。">
        <div className="p-toolbar">
          <Button
            variant="outline"
            disabled={busy || !!created || !wrong.length}
            onClick={() => setExcluded(new Set())}
          >
            全选当前错题
          </Button>
          <Button
            variant="outline"
            disabled={busy || !!created || !wrong.length}
            onClick={() => setExcluded(new Set(wrong.map(revisionSourceKey)))}
          >
            取消全选
          </Button>
        </div>
        {wrong.length ? (
          wrong.map((w, i) => (
            <article className="p-question" key={revisionSourceKey(w)}>
              <label className={styles.choice}>
                <input
                  type="checkbox"
                  disabled={busy || !!created}
                  checked={!excluded.has(revisionSourceKey(w))}
                  aria-label={`选择第 ${i + 1} 条错题`}
                  onChange={(e) =>
                    setExcluded((old) => {
                      const next = new Set(old);
                      if (e.target.checked) next.delete(revisionSourceKey(w));
                      else next.add(revisionSourceKey(w));
                      return next;
                    })
                  }
                />
                <span>
                  {state.assessments.find((a) => a.id === w.assessmentId)?.name} · 原得分 {w.score}{" "}
                  / {w.maximum}
                </span>
              </label>
              <QuestionBody question={w.question} />
            </article>
          ))
        ) : (
          <Empty>
            {state.actor.role === "STUDENT"
              ? "当前范围没有已发布的错题，请选择其他学科或安排，或等待老师发布成绩。"
              : "当前范围没有已评阅的错题，请选择其他学生、学科或安排。"}
          </Empty>
        )}
      </Panel>
      {saved.length > 0 && (
        <Panel title={state.actor.role === "STUDENT" ? "我保存的复习卷" : "我保存的作业与复习卷"}>
          <div className="p-table" role="region" aria-label="已保存题本" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th>名称</th>
                  <th>学科</th>
                  <th>题数</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {saved.slice(0, savedLimit).map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>{p.subject}</td>
                    <td>{p.items.length}</td>
                    <td>
                      <Link href={revisionPaperHref(p.id)}>预览与导出</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {saved.length > savedLimit && (
            <div className="p-toolbar">
              <Button variant="outline" onClick={() => setSavedLimit((n) => n + 20)}>
                显示更多题本
              </Button>
            </div>
          )}
        </Panel>
      )}
    </>
  );
}

export function RevisionPaperPreview({ id }: { id: string }) {
  const { state } = useDomain();
  const paper = state.papers.find(
    (p) => p.id === id && (p.ownerId === state.actor.id || state.actor.role === "ADMIN"),
  );
  if (!paper) return <MissingRecord back="/workspace/revision-papers" />;
  return (
    <>
      <PageHeader
        title={paper.name}
        description={`${paper.subject} · ${paper.grade} · ${paper.items.length} 题 · ${paper.items.reduce((n, i) => n + i.score, 0)} 分`}
        actions={<DocumentExport paperId={paper.id} title={paper.name} />}
      />
      <div className="p-toolbar">
        <Button asChild variant="outline">
          <Link href="/workspace/revision-papers">返回错题组卷</Link>
        </Button>
        {state.actor.role !== "STUDENT" && (
          <Button asChild variant="outline">
            <Link href={`/homework/${paper.id}/edit`}>编辑题本与排版</Link>
          </Button>
        )}
      </div>
      <Panel title="题本预览">
        <div className="p-document-preview">
          <DocumentCanvas
            layout={paper.layout}
            header={
              <>
                <StudentIdentity />
                <PaperText readOnly title label="题本名称" value={paper.name} onChange={() => {}} />
                <div className="p-document-subtitle">
                  {paper.subject} · {paper.grade}
                </div>
                <PaperText
                  readOnly
                  label="卷面说明"
                  value={paper.instructions}
                  onChange={() => {}}
                />
              </>
            }
            blocks={paper.items.map((item, index) => ({
              key: item.questionId,
              pageBreakBefore: paper.layout.questionLayouts?.[item.questionId]?.pageBreakBefore,
              content: (
                <article
                  className="p-workbook-exercise"
                  style={{
                    paddingBottom: `${paper.layout.questionLayouts?.[item.questionId]?.spaceAfterMm ?? 2}mm`,
                  }}
                >
                  <p className="p-muted">
                    {item.section} · {item.score} 分
                  </p>
                  <DocumentQuestionBody question={item.snapshot} index={index} />
                  <WorkbookAnswerSpace
                    heightMm={documentAnswerSpaceMm(paper.layout, item.snapshot)}
                  />
                </article>
              ),
            }))}
          />
        </div>
      </Panel>
      <Panel title="参考答案与解析">
        <details className="p-panel-content">
          <summary>完成后展开核对答案</summary>
          {paper.items.map((item, i) => (
            <article className="p-question" key={item.id}>
              <strong>第 {i + 1} 题</strong>
              <MarkdownText text={item.snapshot.content.answers.join("；")} />
              <MarkdownText text={item.snapshot.content.explanation} />
              {item.snapshot.content.parts.map((part, index) => (
                <div key={part.id}>
                  <p>小问 {index + 1}</p>
                  <MarkdownText text={part.answers.join("；")} />
                  <MarkdownText text={part.explanation} />
                </div>
              ))}
            </article>
          ))}
        </details>
      </Panel>
    </>
  );
}
