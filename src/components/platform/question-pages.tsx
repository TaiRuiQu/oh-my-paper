"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { QuestionStatistics } from "@/contracts/platform";
import type { QuestionSearchMode } from "@/contracts/platform-search";
import { useEffect, useState } from "react";
import { useBankQuestion, useQuestionPage } from "./question-bank-picker";
import { Plus, ArrowRight, Upload } from "lucide-react";
import { SUBJECTS } from "@/contracts/platform";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MarkdownText } from "@/components/markdown-text";
import { useDomain } from "./domain-provider";
import { Panel, Empty } from "./primitives";
import { MissingRecord, PageHeader, PageTabs } from "./page-header";
import { QuestionBody, QuestionEditor, QUESTION_LABELS } from "./questions";
import { PlatformAI } from "./ai";
import { QuestionSearchControls } from "./question-search-controls";

export function QuestionListPage() {
  const [query, setQuery] = useState("");
  const [subject, setSubject] = useState("");
  const [type, setType] = useState("");
  const [searchMode, setSearchMode] = useState<QuestionSearchMode>("keyword");
  const [page, setPage] = useState(1);
  const { questions, total, loading, error, idle, warning, indexedTotal, retry } = useQuestionPage(
    { q: query, subject, type, searchMode },
    page,
  );
  return (
    <>
      <PageHeader
        title="题库管理"
        description="检索和维护可复用试题，为考试组卷和日常作业提供教学素材。"
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/questions/import">
                <Upload />
                导入题目
              </Link>
            </Button>
            <Button asChild>
              <Link href="/questions/new">
                <Plus />
                创建题目
              </Link>
            </Button>
          </>
        }
      />
      <Panel
        title="全部试题"
        description={
          idle
            ? "输入题意后开始语义搜索，每页 20 题。"
            : loading
              ? "正在查询题库…"
              : error
                ? "查询未完成，请根据提示重试。"
                : searchMode === "semantic"
                  ? `${total} 道匹配试题 · ${indexedTotal ?? total} 道题可供检索 · 按相关度排列`
                  : `${total} 道题 · 按加入时间倒序，每页 20 题`
        }
      >
        <QuestionSearchControls
          query={query}
          mode={searchMode}
          onSearch={(value, mode) => {
            setQuery(value);
            setSearchMode(mode);
            setPage(1);
          }}
        >
          <select
            aria-label="筛选学科"
            value={subject}
            onChange={(e) => {
              setSubject(e.target.value);
              setPage(1);
            }}
          >
            <option value="">全部学科</option>
            {SUBJECTS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select
            aria-label="筛选题型"
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setPage(1);
            }}
          >
            <option value="">全部题型</option>
            {Object.entries(QUESTION_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </QuestionSearchControls>
        {warning && <p className="p-notice">{warning}</p>}
        {error && (
          <div className="p-notice error" role="alert">
            <p>{error}</p>
            <Button variant="outline" onClick={retry}>
              重新查询
            </Button>
          </div>
        )}
        {loading && (
          <p className="p-empty" role="status">
            正在查询题库…
          </p>
        )}
        {questions.length ? (
          questions.map((q) => (
            <article className="p-question" key={q.id}>
              <div className="p-question-head">
                <div className="p-actions">
                  <Badge variant="secondary">
                    {q.subject} · {q.grade}
                  </Badge>
                  <Badge variant="outline">{QUESTION_LABELS[q.type]}</Badge>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/questions/${q.id}`}>
                    查看试题
                    <ArrowRight />
                  </Link>
                </Button>
              </div>
              <MarkdownText text={q.content.stem} />
              <div className="p-tags">
                {q.knowledgeTags.map((t) => (
                  <span className="p-tag" key={t}>
                    {t}
                  </span>
                ))}
              </div>
            </article>
          ))
        ) : !loading && !error && !idle ? (
          <div className="p-empty-action">
            <h3>{query || subject || type ? "没有匹配的试题" : "建立自己的教学题库"}</h3>
            <p>
              {query || subject || type
                ? "试着调整搜索描述或筛选条件，或创建新的题目。"
                : "创建题干、答案与评分标准，或从试卷图片导入，再用于组卷和作业。"}
            </p>
            <Button asChild variant="outline">
              <Link href="/questions/new">创建题目</Link>
            </Button>
          </div>
        ) : null}
        <div className="p-actions p-pagination">
          <Button
            variant="outline"
            disabled={idle || !!error || loading || page === 1}
            onClick={() => setPage(page - 1)}
          >
            上一页
          </Button>
          <span>
            第 {page} 页 / 共 {Math.max(1, Math.ceil(total / 20))} 页
          </span>
          <Button
            variant="outline"
            disabled={idle || !!error || loading || page * 20 >= total}
            onClick={() => setPage(page + 1)}
          >
            下一页
          </Button>
        </div>
      </Panel>
    </>
  );
}

export function QuestionEditPage({ id }: { id?: string }) {
  const { mutate, pending } = useDomain();
  const router = useRouter();
  const { question: q, loading } = useBankQuestion(id);
  if (loading) return <p role="status">正在加载试题…</p>;
  if (id && !q) return <MissingRecord back="/questions" />;
  return (
    <>
      <PageHeader
        title={q ? "编辑题目" : "创建题目"}
        description="完整记录题干、材料、标准答案与评分标准。试题保存后可加入试卷或练习册。"
        back={{ href: q ? `/questions/${id}` : "/questions", label: q ? "试题详情" : "全部试题" }}
      />
      <QuestionEditor
        question={q ?? null}
        mutate={async (command) => {
          const r = await mutate(command);
          if (r.id) router.push(`/questions/${r.id}`);
          return r;
        }}
        pending={pending}
        close={() => router.push(q ? `/questions/${id}` : "/questions")}
      />
    </>
  );
}

export function QuestionDetailPage({
  id,
  answers = false,
  usage = false,
}: {
  id: string;
  answers?: boolean;
  usage?: boolean;
}) {
  const { state } = useDomain();
  const { question: q, loading } = useBankQuestion(id);
  if (loading) return <p role="status">正在加载试题…</p>;
  if (!q) return <MissingRecord back="/questions" />;
  return (
    <>
      <PageHeader
        title={answers ? "答案与解析" : usage ? "试题使用记录" : "试题详情"}
        description={`${q.subject} · ${q.grade} · ${QUESTION_LABELS[q.type]} · 难度 ${q.difficulty}`}
        back={{ href: "/questions", label: "全部试题" }}
        actions={
          <Button asChild>
            <Link href={`/questions/${id}/edit`}>编辑题目</Link>
          </Button>
        }
      />
      <PageTabs
        active={`/questions/${id}${answers ? "/answers" : usage ? "/usage" : ""}`}
        links={[
          { href: `/questions/${id}`, label: "题目内容" },
          { href: `/questions/${id}/answers`, label: "答案与解析" },
          { href: `/questions/${id}/usage`, label: "使用记录" },
        ]}
      />
      {usage ? (
        <Panel title="使用此题的试卷与作业">
          {state.papers.filter((p) => p.items.some((i) => i.questionId === id)).length ? (
            state.papers
              .filter((p) => p.items.some((i) => i.questionId === id))
              .map((p) => (
                <div className="p-list-row" key={p.id}>
                  <Link href={`${p.kind === "EXAM" ? "/exams/papers" : "/homework"}/${p.id}`}>
                    {p.name}
                  </Link>
                  <Badge variant="secondary">{p.kind === "EXAM" ? "考试" : "作业"}</Badge>
                </div>
              ))
          ) : (
            <Empty>此题尚未加入试卷或作业，可在排版工作台中选用。</Empty>
          )}
        </Panel>
      ) : (
        <Panel title={answers ? "标准答案与评分依据" : "题目内容"}>
          <div className="p-panel-content">
            <QuestionBody question={q} />
            {answers && (
              <>
                <div className="p-answers">
                  <h3>标准答案</h3>
                  <MarkdownText text={q.content.answers.join("；") || "待填写"} />
                  <h3>解析</h3>
                  <MarkdownText text={q.content.explanation || "待填写"} />
                  <h3>评分标准</h3>
                  <MarkdownText text={q.content.rubric || "待填写"} />
                </div>
                {q.content.parts.map((p, i) => (
                  <div className="p-answers" key={p.id}>
                    <h3>小问 {i + 1}</h3>
                    <MarkdownText text={p.answers.join("；") || "待填写"} />
                    <MarkdownText text={p.explanation} />
                    <MarkdownText text={p.rubric} />
                  </div>
                ))}
              </>
            )}
            <div className="p-tags">
              {q.knowledgeTags.map((t) => (
                <span className="p-tag" key={t}>
                  {t}
                </span>
              ))}
            </div>
          </div>
        </Panel>
      )}
    </>
  );
}

export function QuestionImportPage({ history = false }: { history?: boolean }) {
  const { state, refresh, notify } = useDomain();
  return (
    <>
      <PageHeader
        title={history ? "导入与生成记录" : "导入题目"}
        description={
          history
            ? "跟进后台任务，查看导入结果并处理失败记录。"
            : "上传试卷扫描图片或 PDF，由自主 Agent 识别题目与材料，导入后继续核对和编辑。"
        }
        actions={
          <Button asChild variant="outline">
            <Link href={history ? "/questions/import" : "/questions/import/history"}>
              {history ? "导入题目" : "查看导入记录"}
            </Link>
          </Button>
        }
      />
      <PlatformAI
        state={state}
        tab={history ? "overview" : "questions"}
        refresh={refresh}
        notify={notify}
      />
    </>
  );
}

export function QuestionAnalysisPage({ knowledge = false }: { knowledge?: boolean }) {
  const [stats, setStats] = useState<QuestionStatistics>();
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/platform/questions?stats=1", { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "统计加载失败");
        setStats(data);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      });
    return () => controller.abort();
  }, []);
  return (
    <>
      <PageHeader
        title={knowledge ? "知识点目录" : "题库分析"}
        description="统计覆盖整个题库，可用于检查教学素材的分布和完整度。"
      />
      {error && <p role="alert">{error}</p>}
      {!stats ? (
        <p role="status">正在统计题库…</p>
      ) : knowledge ? (
        <Panel title="知识点与覆盖题量">
          <div className="p-table">
            <table>
              <thead>
                <tr>
                  <th>知识点</th>
                  <th>题量</th>
                  <th>学科</th>
                  <th>平均难度</th>
                </tr>
              </thead>
              <tbody>
                {stats.tags.map((tag) => (
                  <tr key={tag.tag}>
                    <td>{tag.tag}</td>
                    <td>{tag.count}</td>
                    <td>{tag.subjects.join("、")}</td>
                    <td>{tag.difficulty.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!stats.tags.length && <Empty>为试题填写知识点标签后，生成目录与题量统计。</Empty>}
          </div>
        </Panel>
      ) : (
        <>
          <div className="p-summary-strip">
            {[
              ["题目总量", stats.total],
              ["知识点覆盖", stats.tags.length],
              ["缺少答案", stats.missingAnswers],
              ["缺少解析", stats.missingExplanations],
            ].map(([label, value]) => (
              <div key={label}>
                <small>{label}</small>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <div className="p-detail-grid">
            <Panel title="学科分布">
              {SUBJECTS.map((subject) => (
                <div className="p-list-row" key={subject}>
                  <span>{subject}</span>
                  <strong>{stats.subjects[subject] ?? 0} 题</strong>
                </div>
              ))}
            </Panel>
            <Panel title="题型分布">
              {Object.entries(QUESTION_LABELS).map(([type, label]) => (
                <div className="p-list-row" key={type}>
                  <span>{label}</span>
                  <strong>{stats.types[type] ?? 0} 题</strong>
                </div>
              ))}
            </Panel>
          </div>
        </>
      )}
    </>
  );
}
