"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AiJobDTO, AiKind } from "@/contracts/platform-ai";
import { SUBJECTS, type PlatformState, type QuestionType } from "@/contracts/platform";
import { apiRequest, jsonBody } from "@/lib/http-client";
import { Empty, Field, Panel, readForm, stringField, numberField } from "./primitives";
import { QUESTION_LABELS, QuestionBody } from "./questions";
const names: Record<AiKind, string> = {
  IMPORT: "图片识别导入",
  ENRICH: "知识点与参考答案",
  ASSEMBLE: "智能组卷",
  TEMPLATE: "智能答题卡",
  GRADE: "AI 阅卷",
  RECOMMEND: "巩固练习推荐",
};
type Models = { id: string; name: string; providerName: string }[];
export function PlatformAI({
  state,
  tab,
  refresh,
  notify,
}: {
  state: PlatformState;
  tab: string;
  refresh: () => Promise<void>;
  notify: (message: string, error?: boolean) => void;
}) {
  const [models, setModels] = useState<Models>([]),
    [jobs, setJobs] = useState<AiJobDTO[]>([]),
    [modelId, setModelId] = useState(""),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState("");
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
      notify(`${names[kind]}已提交，关闭页面后仍会继续执行。`);
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
          title={names[mode]}
          description="AI 自主查看材料并调用工具完成任务。生成内容保留可编辑，阅卷结果进入既定的复核流程。"
        >
          <div className="p-form">
            <Field label="使用模型">
              <select
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                disabled={!models.length}
              >
                <option value="">
                  {models[0]
                    ? `默认：${models[0].providerName} · ${models[0].name}`
                    : "暂无可用模型"}
                </option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.providerName} · {m.name}
                  </option>
                ))}
              </select>
            </Field>
            {!models.length && (
              <p className="p-muted">尚无可用模型，请联系管理员配置 AI 提供商。</p>
            )}
            {mode === "IMPORT" && (
              <AIImport state={state} start={start} busy={busy || !models.length} />
            )}{" "}
            {mode === "ASSEMBLE" && <AIAssembly start={start} busy={busy || !models.length} />}{" "}
            {(mode === "TEMPLATE" || mode === "GRADE" || mode === "RECOMMEND") && (
              <AISelect mode={mode} state={state} start={start} busy={busy || !models.length} />
            )}
          </div>
        </Panel>
      )}
      <AIJobs
        jobs={jobs}
        mode={mode}
        failure={failure}
        retry={async (id) => {
          setBusy(true);
          try {
            await apiRequest(`/api/platform/ai/${id}/retry`, { method: "POST", ...jsonBody({}) });
            await poll();
            notify("任务已重新排队。");
          } catch (e) {
            notify(e instanceof Error ? e.message : "重试失败", true);
          } finally {
            setBusy(false);
          }
        }}
        busy={busy}
        state={state}
      />
    </>
  );
}
type Start = (kind: AiKind, input: unknown) => Promise<{ id: string } | undefined>;
function AIImport({ state, start, busy }: { state: PlatformState; start: Start; busy: boolean }) {
  const [selected, setSelected] = useState<string[]>([]),
    [files, setFiles] = useState<File[]>([]),
    [uploading, setUploading] = useState(false),
    [subject, setSubject] = useState("数学"),
    [grade, setGrade] = useState("高一"),
    [error, setError] = useState("");
  async function upload() {
    setUploading(true);
    setError("");
    try {
      if (!files.length) throw new Error("请选择试卷图片。");
      const urls = [];
      for (const file of files) {
        const d = new FormData();
        d.set("file", file);
        const r = await apiRequest<{ url: string }>("/api/platform/assets", {
          method: "POST",
          body: d,
        });
        urls.push(r.url);
      }
      await start("IMPORT", { assetUrls: urls, subject, grade });
    } catch (e) {
      setError(e instanceof Error ? e.message : "图片上传失败");
    } finally {
      setUploading(false);
    }
  }
  return (
    <>
      <div className="p-form-grid">
        <Field label="导入学科">
          <select value={subject} onChange={(e) => setSubject(e.target.value)}>
            {SUBJECTS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="适用年级">
          <input value={grade} onChange={(e) => setGrade(e.target.value)} />
        </Field>
      </div>
      <Field label="试卷图片（支持批量）">
        <input
          type="file"
          multiple
          accept="image/png,image/jpeg"
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
        />
      </Field>
      {files.length > 0 && <p className="p-muted">已选择 {files.length} 张图片</p>}
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
        {uploading ? "正在上传试卷图片…" : "识别并导入题库"}
      </button>
      <details>
        <summary>为已有试题生成知识点、标准答案与评分标准</summary>
        <div className="p-form">
          {state.questions.length ? (
            state.questions.map((q) => (
              <label key={q.id} className="p-check">
                <input
                  type="checkbox"
                  checked={selected.includes(q.id)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked ? [...selected, q.id] : selected.filter((id) => id !== q.id),
                    )
                  }
                />
                <span>
                  {q.subject} · {q.content.stem.slice(0, 80)}
                </span>
              </label>
            ))
          ) : (
            <Empty>先创建或导入试题。</Empty>
          )}
          <button
            className="button"
            disabled={busy || !selected.length}
            onClick={() => void start("ENRICH", { questionIds: selected })}
          >
            生成已选 {selected.length} 道题的答案与知识点
          </button>
        </div>
      </details>
    </>
  );
}
function AIAssembly({ start, busy }: { start: Start; busy: boolean }) {
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
          kind: stringField(d, "kind"),
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
        <Field label="用途">
          <select name="kind">
            <option value="EXAM">考试试卷</option>
            <option value="HOMEWORK">日常作业</option>
          </select>
        </Field>
        <Field label="学科">
          <select name="subject" defaultValue="数学">
            {SUBJECTS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="年级">
          <input required name="grade" defaultValue="高一" />
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
}: {
  mode: "TEMPLATE" | "GRADE" | "RECOMMEND";
  state: PlatformState;
  start: Start;
  busy: boolean;
}) {
  return (
    <form
      className="p-ai-form"
      onSubmit={(e) => {
        const d = readForm(e);
        void start(
          mode,
          mode === "TEMPLATE"
            ? { paperId: stringField(d, "target") }
            : mode === "GRADE"
              ? { submissionId: stringField(d, "target") }
              : {
                  studentId: stringField(d, "target") || undefined,
                  count: numberField(d, "count"),
                  subject: stringField(d, "subject") || undefined,
                },
        );
      }}
    >
      <Field label={mode === "TEMPLATE" ? "对应试卷" : mode === "GRADE" ? "学生答卷" : "查看学生"}>
        <select required={mode !== "RECOMMEND" || state.actor.role !== "STUDENT"} name="target">
          <option value="">{state.actor.role === "STUDENT" ? "我的学习情况" : "请选择"}</option>
          {mode === "TEMPLATE"
            ? state.papers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))
            : mode === "GRADE"
              ? state.submissions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {
                      state.classrooms
                        .flatMap((c) => c.students)
                        .find((st) => st.id === s.studentId)?.name
                    }{" "}
                    · {state.papers.find((p) => p.id === s.paperId)?.subject} ·{" "}
                    {state.assessments.find((a) => a.id === s.assessmentId)?.name}
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
        {mode === "TEMPLATE"
          ? "智能制作答题卡"
          : mode === "GRADE"
            ? "开始 AI 阅卷"
            : "分析薄弱点并推荐练习"}
      </button>
    </form>
  );
}
function AIJobs({
  jobs,
  mode,
  failure,
  retry,
  busy,
  state,
}: {
  jobs: AiJobDTO[];
  mode: AiKind | null;
  failure: string;
  retry: (id: string) => Promise<void>;
  busy: boolean;
  state: PlatformState;
}) {
  const relevant = jobs.filter(
    (j) => !mode || j.kind === mode || (mode === "IMPORT" && j.kind === "ENRICH"),
  );
  if (!relevant.length && !failure) return null;
  return (
    <Panel title="AI 任务" description="后台任务会保留进度与结果，页面每三秒更新。">
      {failure && (
        <p role="alert" className="p-notice error">
          {failure}
        </p>
      )}
      {relevant.slice(0, 20).map((job) => {
        const result =
          job.result && typeof job.result === "object"
            ? (job.result as {
                summary?: string;
                result?: { recommendations?: unknown[] };
                recommendations?: unknown[];
              })
            : null;
        return (
          <article key={job.id} className="p-question">
            <div className="p-question-head">
              <strong>{names[job.kind]}</strong>
              <span
                className={`p-status${job.status === "COMPLETED" ? " success" : job.status === "FAILED" ? " warning" : ""}`}
              >
                {
                  {
                    QUEUED: "等待执行",
                    RUNNING: "正在处理",
                    COMPLETED: "已完成",
                    FAILED: "执行失败",
                  }[job.status]
                }
              </span>
            </div>
            <p className="p-muted">
              提交于{" "}
              {new Date(job.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}
            </p>
            {result?.summary && <p>{result.summary}</p>}
            {job.error && (
              <p role="alert" className="field-error">
                {job.error}
              </p>
            )}
            {job.status === "FAILED" && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void retry(job.id)}
              >
                重试任务
              </button>
            )}
            {job.events.length > 0 && (
              <details>
                <summary>查看执行记录（{job.events.length}）</summary>
                <div className="p-ai-events">
                  {job.events.map((event, index) => {
                    const data =
                      event && typeof event === "object"
                        ? (event as {
                            type?: string;
                            tool?: string;
                            name?: string;
                            status?: string;
                            message?: string;
                            summary?: string;
                          })
                        : null;
                    return (
                      <p key={index} className="p-muted">
                        {data?.message ??
                          data?.summary ??
                          [data?.type, data?.tool ?? data?.name, data?.status]
                            .filter(Boolean)
                            .join(" · ") ??
                          "处理中"}
                      </p>
                    );
                  })}
                </div>
              </details>
            )}
            {job.kind === "RECOMMEND" &&
              (result?.recommendations ?? result?.result?.recommendations) && (
                <div>
                  {(result.recommendations ?? result.result?.recommendations ?? []).map(
                    (rec, i) => {
                      const id =
                        typeof rec === "string"
                          ? rec
                          : rec && typeof rec === "object"
                            ? ((rec as { questionId?: string; id?: string }).questionId ??
                              (rec as { id?: string }).id)
                            : undefined;
                      const embedded =
                        rec && typeof rec === "object"
                          ? (rec as { question?: PlatformState["questions"][number] }).question
                          : undefined;
                      const question = embedded ?? state.questions.find((q) => q.id === id);
                      return question ? (
                        <div className="p-question" key={id}>
                          <QuestionBody question={question} />
                        </div>
                      ) : (
                        <p className="p-muted" key={i}>
                          {rec && typeof rec === "object"
                            ? ((rec as { reason?: string; stem?: string }).reason ??
                              (rec as { stem?: string }).stem ??
                              "已生成推荐题目")
                            : String(rec)}
                        </p>
                      );
                    },
                  )}
                </div>
              )}
          </article>
        );
      })}
    </Panel>
  );
}
