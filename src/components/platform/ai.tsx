"use client";
import { useRouter } from "next/navigation";
import { DOCUMENT_UPLOAD_ACCEPT } from "@/contracts/uploads";
import { uploadDocument } from "@/lib/document-upload";
import { useQuestionPage } from "./question-bank-picker";
import { QuestionSearchControls } from "./question-search-controls";
import type { QuestionSearchMode } from "@/contracts/platform-search";
import { GradeSelect } from "./grade-select";
import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_AI_IMPORT_PAGES, type AiJobDTO, type AiKind } from "@/contracts/platform-ai";
import { SUBJECTS, type PlatformState, type QuestionType } from "@/contracts/platform";
import { apiRequest, jsonBody } from "@/lib/http-client";
import { Empty, Field, Panel, readForm, stringField, numberField } from "./primitives";
import { QUESTION_LABELS } from "./questions";
import { AI_JOB_NAMES as names, aiJobHref } from "@/lib/ai-job-display";
import { BatchGradingForm } from "./batch-grading";
import { AIJobList } from "./ai-job-list";
type Models = { id: string; name: string }[];
export function PlatformAI({
  state,
  tab,
  refresh,
  notify,
  fixedKind,
  importKind,
  initialPaperId,
}: {
  fixedKind?: "EXAM" | "HOMEWORK";
  importKind?: "EXAM" | "HOMEWORK";
  initialPaperId?: string;
  state: PlatformState;
  tab: string;
  refresh: () => Promise<void>;
  notify: (message: string, error?: boolean) => void;
}) {
  const router = useRouter();
  const [models, setModels] = useState<Models>([]),
    [jobs, setJobs] = useState<AiJobDTO[]>([]),
    [modelId, setModelId] = useState(""),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState(""),
    [loading, setLoading] = useState(true);
  const completed = useRef(new Set<string>()),
    loaded = useRef(false);
  const poll = useCallback(async () => {
    try {
      const data = await apiRequest<{ models: Models; jobs: AiJobDTO[] }>("/api/platform/ai");
      setModels(data.models);
      setJobs(data.jobs);
      setFailure("");
      for (const job of data.jobs) {
        if (job.status === "COMPLETED" && !completed.current.has(job.id)) {
          completed.current.add(job.id);
          if (loaded.current) await refresh();
        }
      }
      loaded.current = true;
    } catch (e) {
      setFailure(e instanceof Error ? e.message : "AI 任务加载失败");
    } finally {
      setLoading(false);
    }
  }, [refresh]);
  useEffect(() => {
    const initial = setTimeout(() => void poll(), 0);
    const timer = setInterval(() => void poll(), 3000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [poll]);
  async function start(kind: AiKind, input: unknown) {
    setBusy(true);
    try {
      const result = await apiRequest<{ id: string }>("/api/platform/ai", {
        method: "POST",
        ...jsonBody({ kind, modelId: modelId || models[0]?.id, input }),
      });
      await poll();
      notify(`${names[kind]}已提交，关闭页面后仍会继续处理。`);
      router.push(aiJobHref(result.id));
      return result;
    } catch (e) {
      notify(e instanceof Error ? e.message : "AI 任务提交失败", true);
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  const mode: AiKind | null =
    tab === "questions"
      ? "IMPORT"
      : tab === "papers"
        ? "ASSEMBLE"
        : tab === "templates"
          ? "TEMPLATE"
          : tab === "reviews"
            ? "GRADE"
            : tab === "analytics"
              ? "RECOMMEND"
              : null;
  if (!mode && tab !== "overview") return null;
  return (
    <>
      {mode && (
        <Panel
          title={
            mode === "IMPORT" && importKind
              ? `图片识别${importKind === "HOMEWORK" ? "作业" : "试卷"}`
              : names[mode]
          }
          description={
            mode === "TEMPLATE"
              ? "根据整卷内容安排题区和作答空间，生成后可继续编辑。任务提交后可离开页面，完成后从任务记录查看答题卡。"
              : "AI 会根据您提交的材料进行处理，完成后请核对结果。题目可继续编辑，评分仍需按评阅要求复核。"
          }
        >
          <div className="p-form">
            <Field label="使用模型">
              <select
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                disabled={!models.length}
              >
                <option value="">{models[0] ? `默认：${models[0].name}` : "暂无可用模型"}</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </Field>
            {!models.length && (
              <p className="p-muted">尚无可用模型，请联系管理员配置 AI 提供商。</p>
            )}
            {mode === "IMPORT" && (
              <AIImport
                state={state}
                start={start}
                busy={busy || !models.length}
                importKind={importKind}
              />
            )}{" "}
            {mode === "ASSEMBLE" && (
              <AIAssembly start={start} busy={busy || !models.length} fixedKind={fixedKind} />
            )}{" "}
            {mode === "GRADE" && (
              <BatchGradingForm state={state} start={start} busy={busy || !models.length} />
            )}
            {(mode === "TEMPLATE" || mode === "RECOMMEND") && (
              <AISelect
                mode={mode}
                state={state}
                start={start}
                busy={busy || !models.length}
                initialPaperId={initialPaperId}
              />
            )}
          </div>
        </Panel>
      )}
      <AIJobList
        jobs={jobs}
        mode={mode}
        failure={failure}
        loading={loading}
        compact={Boolean(mode)}
        refresh={poll}
      />
    </>
  );
}
type Start = (kind: AiKind, input: unknown) => Promise<{ id: string } | undefined>;
function AIImport({
  start,
  busy,
  importKind,
}: {
  state: PlatformState;
  start: Start;
  busy: boolean;
  importKind?: "EXAM" | "HOMEWORK";
}) {
  const [bankQuery, setBankQuery] = useState(""),
    [bankSearchMode, setBankSearchMode] = useState<QuestionSearchMode>("keyword"),
    [bankPage, setBankPage] = useState(1);
  const {
    questions,
    total,
    loading: bankLoading,
    error: bankError,
    warning: bankWarning,
    idle: bankIdle,
    retry: retryBank,
  } = useQuestionPage({ q: bankQuery, searchMode: bankSearchMode }, bankPage);
  const [selected, setSelected] = useState<string[]>([]),
    [files, setFiles] = useState<File[]>([]),
    [uploading, setUploading] = useState(false),
    [subject, setSubject] = useState(""),
    [grade, setGrade] = useState(""),
    [nameMode, setNameMode] = useState("auto"),
    [name, setName] = useState(""),
    [error, setError] = useState("");
  async function upload() {
    setUploading(true);
    setError("");
    try {
      if (!files.length) throw new Error("请选择试卷扫描图片或 PDF。");
      if (importKind && nameMode === "manual" && !name.trim())
        throw new Error("请输入名称，或选择 AI 自动识别。");
      const urls = [];
      for (const file of files) {
        if (urls.length >= MAX_AI_IMPORT_PAGES)
          throw new Error("一次识别最多 20 页，请拆分材料后上传。");
        const document = await uploadDocument(file, MAX_AI_IMPORT_PAGES - urls.length);
        urls.push(...document.pages.map((page) => page.url));
      }
      await start("IMPORT", {
        assetUrls: urls,
        ...(subject ? { subject } : {}),
        ...(grade ? { grade } : {}),
        ...(importKind ? { kind: importKind } : {}),
        ...(importKind && nameMode === "manual" ? { name: name.trim() } : {}),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "图片上传失败");
    } finally {
      setUploading(false);
    }
  }
  return (
    <>
      {importKind && (
        <>
          <Field
            label={importKind === "HOMEWORK" ? "作业名称" : "试卷名称"}
            hint="优先识别材料中的标题，没有标题时根据内容生成。"
          >
            <select
              value={nameMode}
              onChange={(e) => setNameMode(e.target.value)}
              disabled={uploading || busy}
            >
              <option value="auto">AI 自动识别（推荐）</option>
              <option value="manual">手动填写</option>
            </select>
          </Field>
          {nameMode === "manual" && (
            <Field label={importKind === "HOMEWORK" ? "填写作业名称" : "填写试卷名称"}>
              <input
                required
                value={name}
                maxLength={200}
                onChange={(e) => setName(e.target.value)}
                placeholder={
                  importKind === "HOMEWORK" ? "例如：函数课后练习" : "例如：期中考试试卷"
                }
                disabled={uploading || busy}
              />
            </Field>
          )}
        </>
      )}
      <div className="p-form-grid">
        <Field label="导入学科">
          <select
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            disabled={uploading || busy}
          >
            <option value="">AI 自动识别（推荐）</option>
            {SUBJECTS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="适用年级">
          <GradeSelect
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
            emptyLabel="AI 自动识别（推荐）"
            disabled={uploading || busy}
          />
        </Field>
      </div>
      <Field
        label={`${importKind === "HOMEWORK" ? "作业" : "试卷"}扫描材料（图片或 PDF，支持批量）`}
        hint="PDF 按页码逐页识别，一次最多 20 页。"
      >
        <input
          type="file"
          multiple
          accept={DOCUMENT_UPLOAD_ACCEPT}
          disabled={uploading || busy}
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
        />
      </Field>
      {files.length > 0 && <p className="p-muted">已选择 {files.length} 个扫描文件</p>}
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      <button
        className="button"
        disabled={busy || uploading || !files.length}
        onClick={() => void upload()}
      >
        {uploading
          ? "正在读取扫描材料…"
          : importKind
            ? `识别并创建${importKind === "HOMEWORK" ? "作业" : "试卷"}`
            : "识别并导入题库"}
      </button>
      {!importKind && (
        <details>
          <summary>为已有试题生成知识点、标准答案与评分标准</summary>
          <div className="p-form">
            <QuestionSearchControls
              compact
              query={bankQuery}
              mode={bankSearchMode}
              onSearch={(query, mode) => {
                setBankQuery(query);
                setBankSearchMode(mode);
                setBankPage(1);
              }}
            />
            {bankLoading && <p role="status">正在查询题库…</p>}
            {bankWarning && <p className="p-notice">{bankWarning}</p>}
            {bankError && (
              <div className="p-notice error" role="alert">
                <p>{bankError}</p>
                <button type="button" className="button secondary" onClick={retryBank}>
                  重新查询
                </button>
              </div>
            )}
            {questions.length ? (
              questions.map((q) => (
                <label key={q.id} className="p-check">
                  <input
                    type="checkbox"
                    checked={selected.includes(q.id)}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...selected, q.id]
                          : selected.filter((id) => id !== q.id),
                      )
                    }
                  />
                  <span>
                    {q.subject} · {q.content.stem.slice(0, 80)}
                  </span>
                </label>
              ))
            ) : !bankLoading && !bankError ? (
              <Empty>
                {bankIdle ? "输入题意后开始搜索。" : "没有匹配的试题，请调整搜索或先创建题目。"}
              </Empty>
            ) : null}
            <button
              className="button"
              disabled={busy || !selected.length}
              onClick={() => void start("ENRICH", { questionIds: selected })}
            >
              生成已选 {selected.length} 道题的答案与知识点
            </button>
            <div className="p-actions">
              <button
                type="button"
                className="button secondary"
                disabled={bankIdle || !!bankError || bankLoading || bankPage === 1}
                onClick={() => setBankPage(bankPage - 1)}
              >
                上一页
              </button>
              <span>
                第 {bankPage} 页 · {total} 题
              </span>
              <button
                type="button"
                className="button secondary"
                disabled={bankIdle || !!bankError || bankLoading || bankPage * 20 >= total}
                onClick={() => setBankPage(bankPage + 1)}
              >
                下一页
              </button>
            </div>
          </div>
        </details>
      )}
    </>
  );
}
function AIAssembly({
  start,
  busy,
  fixedKind,
}: {
  start: Start;
  busy: boolean;
  fixedKind?: "EXAM" | "HOMEWORK";
}) {
  const [counts, setCounts] = useState<
      { type: QuestionType; count: number; score: number; section: string }[]
    >([{ type: "SINGLE", count: 3, score: 5, section: "选择题" }]),
    [distribution, setDistribution] = useState([{ tag: "", percent: 100 }]);
  return (
    <form
      className="p-ai-form"
      onSubmit={async (e) => {
        const d = readForm(e);
        await start("ASSEMBLE", {
          name: stringField(d, "name"),
          subject: stringField(d, "subject"),
          grade: stringField(d, "grade"),
          kind: fixedKind ?? stringField(d, "kind"),
          difficulty: numberField(d, "difficulty"),
          difficultyTolerance: numberField(d, "difficultyTolerance"),
          counts,
          knowledgeDistribution: distribution,
        });
      }}
    >
      <div className="p-form-grid">
        <Field label="试卷 / 作业名称">
          <input required name="name" />
        </Field>
        {!fixedKind && (
          <Field label="用途">
            <select name="kind">
              <option value="EXAM">考试试卷</option>
              <option value="HOMEWORK">日常作业</option>
            </select>
          </Field>
        )}
        <Field label="学科">
          <select name="subject" defaultValue="数学">
            {SUBJECTS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="适用年级">
          <GradeSelect required name="grade" defaultValue="高中一年级" />
        </Field>
        <Field label="目标难度（0–1）">
          <input type="number" name="difficulty" min={0} max={1} step={0.05} defaultValue={0.5} />
        </Field>
        <Field label="难度容差">
          <input
            type="number"
            name="difficultyTolerance"
            min={0}
            max={1}
            step={0.05}
            defaultValue={0.2}
          />
        </Field>
      </div>
      <h3>题型结构</h3>
      {counts.map((c, i) => (
        <div className="p-form-grid" key={i}>
          <Field label="题型">
            <select
              value={c.type}
              onChange={(e) =>
                setCounts(
                  counts.map((item, n) =>
                    n === i ? { ...item, type: e.target.value as QuestionType } : item,
                  ),
                )
              }
            >
              {Object.entries(QUESTION_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="题数">
            <input
              required
              type="number"
              min={1}
              max={100}
              value={c.count}
              onChange={(e) =>
                setCounts(
                  counts.map((item, n) =>
                    n === i ? { ...item, count: Number(e.target.value) } : item,
                  ),
                )
              }
            />
          </Field>
          <Field label="每题分值">
            <input
              required
              type="number"
              min={0.5}
              step={0.5}
              value={c.score}
              onChange={(e) =>
                setCounts(
                  counts.map((item, n) =>
                    n === i ? { ...item, score: Number(e.target.value) } : item,
                  ),
                )
              }
            />
          </Field>
          <Field label="大题标题">
            <input
              value={c.section}
              onChange={(e) =>
                setCounts(
                  counts.map((item, n) => (n === i ? { ...item, section: e.target.value } : item)),
                )
              }
            />
          </Field>
          <button
            className="link-button"
            type="button"
            onClick={() => setCounts(counts.filter((_, n) => n !== i))}
          >
            移除此题型
          </button>
        </div>
      ))}
      <button
        className="button secondary"
        type="button"
        disabled={counts.length >= 5}
        onClick={() =>
          setCounts([...counts, { type: "SUBJECTIVE", count: 1, score: 10, section: "解答题" }])
        }
      >
        添加题型
      </button>
      <h3>知识点分布</h3>
      {distribution.map((d, i) => (
        <div className="p-form-grid" key={i}>
          <Field label="知识点">
            <input
              required
              value={d.tag}
              onChange={(e) =>
                setDistribution(
                  distribution.map((item, n) =>
                    n === i ? { ...item, tag: e.target.value } : item,
                  ),
                )
              }
            />
          </Field>
          <Field label="占比（%）">
            <input
              required
              type="number"
              min={0.1}
              max={100}
              step={0.1}
              value={d.percent}
              onChange={(e) =>
                setDistribution(
                  distribution.map((item, n) =>
                    n === i ? { ...item, percent: Number(e.target.value) } : item,
                  ),
                )
              }
            />
          </Field>
          <button
            className="link-button"
            type="button"
            onClick={() => setDistribution(distribution.filter((_, n) => n !== i))}
          >
            移除此知识点
          </button>
        </div>
      ))}
      <div className="p-actions">
        <button
          className="button secondary"
          type="button"
          onClick={() => setDistribution([...distribution, { tag: "", percent: 0 }])}
        >
          添加知识点
        </button>
        <span className="p-muted">
          占比合计 {distribution.reduce((s, d) => s + d.percent, 0)}%（须为 100%）
        </span>
      </div>
      <button
        className="button"
        disabled={
          busy ||
          !counts.length ||
          !distribution.length ||
          Math.abs(distribution.reduce((s, d) => s + d.percent, 0) - 100) > 0.001
        }
      >
        从题库智能组卷
      </button>
    </form>
  );
}
function AISelect({
  mode,
  state,
  start,
  busy,
  initialPaperId,
}: {
  mode: "TEMPLATE" | "RECOMMEND";
  state: PlatformState;
  start: Start;
  busy: boolean;
  initialPaperId?: string;
}) {
  const papers = state.papers.filter(
    (p) => p.kind === "EXAM" && (p.ownerId === state.actor.id || state.actor.role === "ADMIN"),
  );
  return (
    <form
      className="p-ai-form"
      onSubmit={(e) => {
        const d = readForm(e);
        void start(
          mode,
          mode === "TEMPLATE"
            ? { paperId: stringField(d, "target") }
            : {
                studentId: stringField(d, "target") || undefined,
                count: numberField(d, "count"),
                subject: stringField(d, "subject") || undefined,
              },
        );
      }}
    >
      <Field label={mode === "TEMPLATE" ? "对应试卷" : "查看学生"}>
        <select
          required={mode !== "RECOMMEND" || state.actor.role !== "STUDENT"}
          name="target"
          defaultValue={
            mode === "TEMPLATE" && papers.some((p) => p.id === initialPaperId) ? initialPaperId : ""
          }
        >
          <option value="">{state.actor.role === "STUDENT" ? "我的学习情况" : "请选择"}</option>
          {mode === "TEMPLATE"
            ? papers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))
            : state.analytics.students.map((s) => (
                <option key={s.studentId} value={s.studentId}>
                  {state.classrooms.flatMap((c) => c.students).find((st) => st.id === s.studentId)
                    ?.name ?? state.actor.name}
                </option>
              ))}
        </select>
      </Field>
      {mode === "RECOMMEND" && (
        <div className="p-form-grid">
          <Field label="练习题数量">
            <input type="number" min={1} max={20} defaultValue={5} name="count" />
          </Field>
          <Field label="学科">
            <select name="subject">
              <option value="">全部学科</option>
              {SUBJECTS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
        </div>
      )}
      <button className="button" disabled={busy}>
        {mode === "TEMPLATE" ? "开始 AI 自动排版" : "分析薄弱点并推荐练习"}
      </button>
    </form>
  );
}
