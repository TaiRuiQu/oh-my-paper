"use client";
import { DocumentWorkbench } from "./document-workbench";
import { DocumentExport } from "./document-export";
import { DOCUMENT_DEFAULTS } from "@/lib/document-layout";
import { GradeSelect, normalizeGrade } from "./grade-select";
import { DocumentFormatControls, DocumentInsertTools } from "./document-controls";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2, Printer, Copy, Save, ArrowRight } from "lucide-react";
import {
  SUBJECTS,
  type BankQuestion,
  type Paper,
  type QuestionContent,
  type DocumentLayout,
} from "@/contracts/platform";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Field, Panel, Empty } from "./primitives";
import { QuestionBody, QUESTION_LABELS } from "./questions";
import { useDomain } from "./domain-provider";
import { useUnsavedChanges } from "./use-unsaved-changes";
import { DocumentQuestionBody } from "./document-question";
import { DocumentCanvas, PaperText } from "./document-canvas";
import { MissingRecord, PageHeader, PageTabs } from "./page-header";
import { RecordNameEditor } from "./record-name-editor";
import { StringListEditor } from "./editable-list";

function usePaperPaths() {
  return { homework: false, root: "/exams/papers", noun: "试卷" };
}

export function PaperListPage({ exporting = false }: { exporting?: boolean }) {
  const { state } = useDomain();
  const { root, noun, homework } = usePaperPaths();
  const [query, setQuery] = useState("");
  const [subject, setSubject] = useState("");
  const [status, setStatus] = useState("");
  const used = (id: string) =>
    state.assessments.some((a) => a.papers.some((p) => p.paperId === id));
  const papers = state.papers.filter(
    (p) =>
      `${p.name} ${p.grade}`.includes(query) &&
      (!subject || p.subject === subject) &&
      (!status || used(p.id) === (status === "assigned")),
  );
  return (
    <>
      <PageHeader
        title={exporting ? `导出${noun}` : homework ? "作业管理" : "组卷工作台"}
        description={
          exporting
            ? "选择一份已保存的内容，检查排版后导出或打印。"
            : `管理${noun}草稿和已布置内容，进入工作台继续编辑。`
        }
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={homework ? "/questions" : "/exams/assemble"}>
                {homework ? "前往题库" : "AI 辅助组卷"}
              </Link>
            </Button>
            <Button asChild>
              <Link href={`${root}/new`}>
                <Plus />
                创建{noun}
              </Link>
            </Button>
          </>
        }
      />
      <Panel
        title={exporting ? "选择导出内容" : `全部${noun}`}
        description={`共 ${state.papers.length} 份 · ${state.papers.filter((p) => !used(p.id)).length} 份草稿`}
      >
        <div className="p-toolbar p-toolbar-wrap">
          <Input
            aria-label={`搜索${noun}`}
            placeholder={`搜索${noun}名称或适用年级`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            aria-label="筛选学科"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          >
            <option value="">全部学科</option>
            {SUBJECTS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select
            aria-label="筛选使用状态"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">全部状态</option>
            <option value="draft">草稿</option>
            <option value="assigned">已布置</option>
          </select>
        </div>
        {papers.length ? (
          <div className="p-table" role="region" aria-label={`${noun}列表`} tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th>名称</th>
                  <th>学科 / 适用年级</th>
                  <th>题数 / 总分</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {papers.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <RecordNameEditor
                        record={p}
                        kind="paper"
                        noun={noun}
                        href={`${root}/${p.id}`}
                      />
                      <small>{new Date(p.updatedAt).toLocaleDateString("zh-CN")} 更新</small>
                    </td>
                    <td>
                      {p.subject} · {p.grade}
                    </td>
                    <td>
                      {p.items.length} 题 / {p.items.reduce((sum, i) => sum + i.score, 0)} 分
                    </td>
                    <td>
                      <Badge variant="secondary">{used(p.id) ? "已布置" : "草稿"}</Badge>
                    </td>
                    <td>
                      <Button asChild variant="outline" size="sm">
                        <Link href={`${root}/${p.id}/${exporting ? "export" : "edit"}`}>
                          {exporting ? "检查并导出" : "进入工作台"}
                          <ArrowRight />
                        </Link>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-empty-action">
            <h3>{state.papers.length ? "没有符合筛选条件的内容" : `创建第一份${noun}`}</h3>
            <p>
              {state.papers.length
                ? "调整搜索词或学科筛选后重试。"
                : "从题库选题，在纸面上调整题序、分值与内容，然后保存。"}
            </p>
            <Button asChild variant="outline">
              <Link href={`${root}/new`}>创建{noun}</Link>
            </Button>
          </div>
        )}
      </Panel>
    </>
  );
}

export function PaperNavigation({ paper, active }: { paper: Paper; active: string }) {
  const { root } = usePaperPaths();
  const base = `${root}/${paper.id}`;
  return (
    <PageTabs
      active={active}
      links={[
        { href: base, label: "工作台概览" },
        { href: `${base}/edit`, label: "可视化编辑" },
        { href: `${base}/answers`, label: "答案与评分标准" },
        { href: `${base}/layout`, label: "排版设置" },
        { href: `${base}/export`, label: "导出与打印" },
      ]}
    />
  );
}

export function PaperOverviewPage({ id }: { id: string }) {
  const { state, pending, mutate } = useDomain();
  const { root, noun, homework } = usePaperPaths();
  const router = useRouter();
  const paper = state.papers.find((p) => p.id === id);
  if (!paper) return <MissingRecord back={root} />;
  const assignments = state.assessments.filter((a) => a.papers.some((p) => p.paperId === id));
  return (
    <>
      <PageHeader
        title={paper.name}
        titleEditor={<RecordNameEditor record={paper} kind="paper" noun={noun} heading />}
        description={`${paper.subject} · ${paper.grade} · ${homework ? "题目与作答写在同一份练习册中" : "考试试卷工作台"}`}
        back={{ href: root, label: `全部${noun}` }}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={`${root}/${id}/export`}>
                <Printer />
                导出
              </Link>
            </Button>
            <Button asChild>
              <Link href={`${root}/${id}/edit`}>继续编辑</Link>
            </Button>
          </>
        }
      />
      <PaperNavigation paper={paper} active={`${root}/${id}`} />
      <div className="p-summary-strip">
        <div>
          <small>试题</small>
          <strong>{paper.items.length} 题</strong>
        </div>
        <div>
          <small>总分</small>
          <strong>{paper.items.reduce((n, i) => n + i.score, 0)} 分</strong>
        </div>
        <div>
          <small>使用状态</small>
          <strong>{assignments.length ? "已布置" : "草稿"}</strong>
        </div>
        <div>
          <small>纸张</small>
          <strong>
            {paper.layout.paperSize} · {paper.layout.columns} 栏
          </strong>
        </div>
      </div>
      <div className="p-detail-grid">
        <Panel title="内容预览" description="题目按保存的快照展示，题库后续修改不会影响此版本。">
          <div className="p-panel-content p-paper-content">
            {paper.items.slice(0, 3).map((i, n) => (
              <article key={i.id} className="p-question">
                <div className="p-question-head">
                  <strong>
                    {n + 1}. {i.section || QUESTION_LABELS[i.snapshot.type]}
                  </strong>
                  <span>{i.score} 分</span>
                </div>
                <QuestionBody question={i.snapshot} />
              </article>
            ))}
            {paper.items.length > 3 && (
              <Link href={`${root}/${id}/edit`}>查看全部 {paper.items.length} 道题</Link>
            )}
          </div>
        </Panel>
        <div>
          <Panel title="接下来">
            <div className="p-task-links">
              <Link href={`${root}/${id}/answers`}>
                <div>
                  核对标准答案<small>检查解析和评分依据</small>
                </div>
                <ArrowRight size={16} />
              </Link>
              <Link href={`${root}/${id}/layout`}>
                <div>
                  调整纸张与栏目<small>检查打印版面</small>
                </div>
                <ArrowRight size={16} />
              </Link>
              <Link href={`${homework ? "/homework/assignments" : "/exams"}/new?paperId=${id}`}>
                <div>
                  {homework ? "布置给班级" : "安排考试"}
                  <small>选择参与班级和评阅方式</small>
                </div>
                <ArrowRight size={16} />
              </Link>
            </div>
          </Panel>
          <Panel title="使用记录">
            {assignments.length ? (
              assignments.map((a) => (
                <div className="p-list-row" key={a.id}>
                  <Link href={`${homework ? "/homework/assignments" : "/exams"}/${a.id}`}>
                    {a.name}
                  </Link>
                  <Badge variant="secondary">{a.published ? "已发布" : "进行中"}</Badge>
                </div>
              ))
            ) : (
              <Empty>尚未布置，可继续编辑。</Empty>
            )}
          </Panel>
          {!assignments.length && (
            <Button
              variant="destructive"
              disabled={pending}
              onClick={async () => {
                if (window.confirm(`确定删除「${paper.name}」？`)) {
                  const result = await mutate({ type: "paper.delete", id });
                  if (!result.error) router.push(root);
                }
              }}
            >
              <Trash2 />
              删除{noun}
            </Button>
          )}
        </div>
      </div>
    </>
  );
}

type DraftItem = { questionId: string; score: number; section: string; snapshot: BankQuestion };
export function PaperEditorPage({
  id,
  view = "edit",
}: {
  id?: string;
  view?: "edit" | "answers" | "layout";
}) {
  const { state } = useDomain();
  const { root } = usePaperPaths();
  const paper = state.papers.find((p) => p.id === id);
  if (id && !paper) return <MissingRecord back={root} />;
  return <PaperWorkbench key={`${id ?? "new"}/${view}`} paper={paper} view={view} />;
}

function PaperWorkbench({ paper, view }: { paper?: Paper; view: "edit" | "answers" | "layout" }) {
  const { state, mutate, pending } = useDomain();
  const { root, noun, homework } = usePaperPaths();
  const router = useRouter();
  const [items, setItems] = useState<DraftItem[]>(
    paper?.items.map((i) => ({
      questionId: i.questionId,
      score: i.score,
      section: i.section,
      snapshot: structuredClone(i.snapshot),
    })) ?? [],
  );
  const [name, setName] = useState(paper?.name ?? "");
  const [subject, setSubject] = useState(paper?.subject ?? "数学");
  const [grade, setGrade] = useState(normalizeGrade(paper?.grade));
  const [instructions, setInstructions] = useState(paper?.instructions ?? "");
  const [layout, setLayout] = useState<DocumentLayout>(paper?.layout ?? { ...DOCUMENT_DEFAULTS });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedQuestionIndex = Math.max(0, Math.min(selectedIndex, items.length - 1));
  const selectedQuestion = items[selectedQuestionIndex];
  const [dirty, setDirty] = useState(false);
  useUnsavedChanges(dirty);
  const [dragging, setDragging] = useState<number>();
  const used = paper && state.assessments.some((a) => a.papers.some((p) => p.paperId === paper.id));
  const edit = (fn: () => void) => {
    fn();
    setDirty(true);
  };
  const patch = (index: number, value: Partial<DraftItem>) =>
    edit(() => setItems((old) => old.map((i, n) => (n === index ? { ...i, ...value } : i))));
  const content = (index: number, value: Partial<QuestionContent>) =>
    patch(index, {
      snapshot: {
        ...items[index].snapshot,
        content: { ...items[index].snapshot.content, ...value },
      },
    });
  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length || to === from) return;
    edit(() =>
      setItems((old) => {
        const next = [...old];
        const [item] = next.splice(from, 1);
        next.splice(to, 0, item);
        return next;
      }),
    );
  };
  async function save(copy = false) {
    const result = await mutate({
      type: "paper.save",
      paper: {
        id: copy ? undefined : paper?.id,
        name: copy ? `${name}（副本）` : name,
        kind: homework ? "HOMEWORK" : "EXAM",
        subject,
        grade,
        instructions,
        layout,
        items: items.map((i) => ({
          questionId: i.questionId,
          score: i.score,
          section: i.section,
          content: i.snapshot.content,
          question: i.snapshot,
        })),
      },
    });
    if (result.error || !result.id) return;
    setDirty(false);
    router.push(`${root}/${result.id}`);
  }
  const title =
    view === "answers"
      ? "答案与评分标准"
      : view === "layout"
        ? "排版设置"
        : paper
          ? `编辑${noun}`
          : `创建${noun}`;
  return (
    <>
      <PageHeader
        title={title}
        description={
          view === "answers"
            ? "逐题核对和修改标准答案、解析与评分标准，保存到本卷。"
            : view === "layout"
              ? "设置纸张、栏目和卷面说明，预览实际内容。"
              : "直接在纸面编辑内容，插入新题目或文字，也可从题库逐题导入。"
        }
        back={{ href: paper ? `${root}/${paper.id}` : root, label: paper?.name ?? `全部${noun}` }}
      />
      {paper && <PaperNavigation paper={paper} active={`${root}/${paper.id}/${view}`} />}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save(!!used);
        }}
      >
        <DocumentWorkbench
          outline={false}
          propertiesPanel={
            <>
              <aside
                className="p-paper-bank"
                aria-label={view === "layout" ? "版面设置" : "题库选题"}
              >
                {selectedQuestion && (
                  <div className="p-mobile-document-tools">
                    <h3>题目设置</h3>
                    <div className="p-form-grid">
                      <Field label="当前题目">
                        <select
                          value={selectedQuestionIndex}
                          onChange={(e) => setSelectedIndex(Number(e.target.value))}
                        >
                          {items.map((i, n) => (
                            <option key={i.questionId} value={n}>
                              第 {n + 1} 题 · {i.section}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="分值">
                        <Input
                          type="number"
                          min={0}
                          step={0.5}
                          value={selectedQuestion.score}
                          onChange={(e) =>
                            patch(selectedQuestionIndex, { score: Number(e.target.value) })
                          }
                        />
                      </Field>
                      <Field label="栏目">
                        <Input
                          value={selectedQuestion.section}
                          onChange={(e) =>
                            patch(selectedQuestionIndex, { section: e.target.value })
                          }
                        />
                      </Field>
                    </div>
                    <div className="p-actions">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={selectedQuestionIndex === 0}
                        onClick={() => {
                          move(selectedQuestionIndex, selectedQuestionIndex - 1);
                          setSelectedIndex(selectedQuestionIndex - 1);
                        }}
                      >
                        上移题目
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={selectedQuestionIndex === items.length - 1}
                        onClick={() => {
                          move(selectedQuestionIndex, selectedQuestionIndex + 1);
                          setSelectedIndex(selectedQuestionIndex + 1);
                        }}
                      >
                        下移题目
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                          edit(() => setItems(items.filter((_, n) => n !== selectedQuestionIndex)))
                        }
                      >
                        <Trash2 />
                        移除题目
                      </Button>
                      <label className="p-check">
                        <input
                          type="checkbox"
                          checked={
                            layout.questionLayouts?.[selectedQuestion.questionId]
                              ?.pageBreakBefore ?? false
                          }
                          onChange={(e) =>
                            edit(() =>
                              setLayout({
                                ...layout,
                                questionLayouts: {
                                  ...layout.questionLayouts,
                                  [selectedQuestion.questionId]: {
                                    ...layout.questionLayouts?.[selectedQuestion.questionId],
                                    pageBreakBefore: e.target.checked,
                                  },
                                },
                              }),
                            )
                          }
                        />
                        从新页开始
                      </label>
                    </div>
                    <p className="p-muted">纸面可横向滚动。点击「100% 编辑」放大文字后直接编辑。</p>
                  </div>
                )}
                {view === "layout" ? (
                  <>
                    <h2>版面设置</h2>
                    <div className="p-paper-settings">
                      <Field label="纸张大小">
                        <select
                          value={layout.paperSize}
                          onChange={(e) =>
                            edit(() =>
                              setLayout({ ...layout, paperSize: e.target.value as "A4" | "A3" }),
                            )
                          }
                        >
                          <option>A4</option>
                          <option>A3</option>
                        </select>
                      </Field>
                      <Field label="分栏">
                        <select
                          value={layout.columns}
                          onChange={(e) =>
                            edit(() => setLayout({ ...layout, columns: Number(e.target.value) }))
                          }
                        >
                          <option value={1}>单栏</option>
                          <option value={2}>双栏</option>
                          <option value={3}>三栏</option>
                          <option value={4}>四栏</option>
                        </select>
                      </Field>
                      <p className="p-muted">保存后可在「导出与打印」中下载 PDF 或 Word 文档。</p>
                    </div>
                  </>
                ) : (
                  <>
                    <h2>文档设置 · {subject}</h2>
                    <div className="p-paper-settings">
                      <Field label="学科">
                        <select
                          value={subject}
                          disabled={items.length > 0}
                          onChange={(e) => edit(() => setSubject(e.target.value))}
                        >
                          {SUBJECTS.map((v) => (
                            <option key={v}>{v}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label="适用年级">
                        <GradeSelect
                          value={grade}
                          onChange={(e) => edit(() => setGrade(e.target.value))}
                        />
                      </Field>
                    </div>
                    <DocumentInsertTools
                      subject={subject}
                      grade={grade}
                      usedIds={items.map((i) => i.questionId)}
                      onText={() =>
                        edit(() =>
                          setLayout({
                            ...layout,
                            textBlocks: [
                              ...(layout.textBlocks ?? []),
                              {
                                id: crypto.randomUUID(),
                                text: "",
                                beforeQuestionId: selectedQuestion?.questionId,
                              },
                            ],
                          }),
                        )
                      }
                      onAdd={(q) =>
                        edit(() =>
                          setItems([
                            ...items,
                            {
                              questionId: q.id,
                              score:
                                q.type === "MIXED"
                                  ? q.content.parts.reduce((n, p) => n + p.score, 0)
                                  : 5,
                              section: QUESTION_LABELS[q.type],
                              snapshot: structuredClone(q),
                            },
                          ]),
                        )
                      }
                    />
                  </>
                )}
              </aside>
              <aside className="p-paper-outline" aria-label="试题目录">
                <h2>试题目录</h2>
                {items.length ? (
                  items.map((i, n) => (
                    <a href={`#paper-item-${n}`} key={i.questionId}>
                      {n + 1}. {i.section || QUESTION_LABELS[i.snapshot.type]}
                      <span>{i.score} 分</span>
                    </a>
                  ))
                ) : (
                  <Empty>添加试题后显示目录。</Empty>
                )}
              </aside>
            </>
          }
          title={name.trim() || title}
          status={
            <>
              <Badge variant="secondary">
                {items.length} 题 · {items.reduce((n, i) => n + i.score, 0)} 分
              </Badge>
              <span className={dirty ? "p-dirty" : "p-muted"}>
                {dirty ? "有未保存的修改" : paper ? "已保存" : "新建草稿"}
              </span>
            </>
          }
          actions={
            <div className="p-actions">
              {paper && !used && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending || !name}
                  onClick={() => void save(true)}
                >
                  <Copy />
                  另存一份
                </Button>
              )}
              <Button type="submit" disabled={pending || !name.trim()}>
                <Save />
                {pending ? "正在保存…" : used ? "另存为新版本" : `保存${noun}`}
              </Button>
            </div>
          }
          ribbon={
            <div className="p-document-ribbon">
              <DocumentFormatControls
                layout={layout}
                onChange={(value) => edit(() => setLayout(value))}
              />
              <Field label="纸张">
                <select
                  value={layout.paperSize}
                  onChange={(e) =>
                    edit(() => setLayout({ ...layout, paperSize: e.target.value as "A4" | "A3" }))
                  }
                >
                  <option>A4</option>
                  <option>A3</option>
                </select>
              </Field>
              <Field label="分栏">
                <select
                  value={layout.columns}
                  onChange={(e) =>
                    edit(() => setLayout({ ...layout, columns: Number(e.target.value) }))
                  }
                >
                  <option value={1}>单栏</option>
                  <option value={2}>双栏</option>
                  <option value={3}>三栏</option>
                  <option value={4}>四栏</option>
                </select>
              </Field>
              <Field label="页边距 mm">
                <Input
                  type="number"
                  min={8}
                  max={40}
                  value={layout.marginMm ?? DOCUMENT_DEFAULTS.marginMm}
                  onChange={(e) =>
                    edit(() => setLayout({ ...layout, marginMm: Number(e.target.value) }))
                  }
                />
              </Field>
              <Field label="字号 pt">
                <Input
                  type="number"
                  min={9}
                  max={24}
                  value={layout.fontSizePt ?? DOCUMENT_DEFAULTS.fontSizePt}
                  onChange={(e) =>
                    edit(() => setLayout({ ...layout, fontSizePt: Number(e.target.value) }))
                  }
                />
              </Field>
              <Field label="行距">
                <Input
                  type="number"
                  min={1}
                  max={3}
                  step={0.05}
                  value={layout.lineHeight ?? DOCUMENT_DEFAULTS.lineHeight}
                  onChange={(e) =>
                    edit(() => setLayout({ ...layout, lineHeight: Number(e.target.value) }))
                  }
                />
              </Field>
            </div>
          }
          notice={
            used && <p className="p-notice">此版本已布置。修改后另存为新版本，再布置给班级。</p>
          }
        >
          <div className="p-paper-workbench">
            <div>
              <DocumentCanvas
                layout={layout}
                onTextBlocksChange={(textBlocks) =>
                  edit(() => setLayout({ ...layout, textBlocks }))
                }
                header={
                  <>
                    <PaperText
                      title
                      label={`${noun}名称`}
                      value={name}
                      onChange={(value) => edit(() => setName(value))}
                    />
                    <div className="p-document-subtitle">
                      {subject} · {grade}
                    </div>
                    <PaperText
                      label="卷面说明"
                      value={instructions}
                      onChange={(value) => edit(() => setInstructions(value))}
                    />
                  </>
                }
                empty={
                  <div className="p-empty-action">
                    <h3>开始编写试卷</h3>
                    <p>在右侧新建题目、添加文字，或从题库导入一道题目。</p>
                  </div>
                }
                blocks={items.map((item, index) => ({
                  key: item.questionId,
                  pageBreakBefore: layout.questionLayouts?.[item.questionId]?.pageBreakBefore,
                  content: (
                    <article
                      className="p-paper-question"
                      data-selected={selectedQuestionIndex === index}
                      onFocus={() => setSelectedIndex(index)}
                      onClick={() => setSelectedIndex(index)}
                      id={`paper-item-${index}`}
                      key={item.questionId}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (dragging !== undefined) move(dragging, index);
                        setDragging(undefined);
                      }}
                    >
                      <div className="p-question-meta p-document-edit-tools">
                        <strong
                          draggable
                          title={`拖动第 ${index + 1} 题排序`}
                          onDragStart={() => setDragging(index)}
                        >
                          {index + 1}.
                        </strong>
                        <Input
                          className="p-inline-input p-section-name"
                          aria-label={`第 ${index + 1} 题栏目`}
                          placeholder="栏目名称"
                          value={item.section}
                          onChange={(e) => patch(index, { section: e.target.value })}
                        />
                        <Input
                          className="p-score-input"
                          aria-label={`第 ${index + 1} 题分值`}
                          type="number"
                          min={0}
                          max={10000}
                          step={0.5}
                          required
                          value={item.score}
                          onChange={(e) => patch(index, { score: Number(e.target.value) })}
                        />
                        <span>分</span>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label={`上移第 ${index + 1} 题`}
                          disabled={index === 0}
                          onClick={() => move(index, index - 1)}
                        >
                          <ArrowUp />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label={`下移第 ${index + 1} 题`}
                          disabled={index === items.length - 1}
                          onClick={() => move(index, index + 1)}
                        >
                          <ArrowDown />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label={`移除第 ${index + 1} 题`}
                          onClick={() => edit(() => setItems(items.filter((_, n) => n !== index)))}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                      <DocumentQuestionBody
                        question={item.snapshot}
                        index={index}
                        labelPrefix={`第 ${index + 1} 题`}
                        onChange={view === "edit" ? (value) => content(index, value) : undefined}
                      />
                      {view === "answers" && (
                        <div className="p-answers">
                          <StringListEditor
                            label={`第 ${index + 1} 题标准答案`}
                            itemLabel="答案"
                            multiline
                            values={item.snapshot.content.answers}
                            onChange={(answers) => content(index, { answers })}
                          />
                          <Field label="解析">
                            <Textarea
                              value={item.snapshot.content.explanation}
                              onChange={(e) => content(index, { explanation: e.target.value })}
                            />
                          </Field>
                          <Field label="评分标准">
                            <Textarea
                              value={item.snapshot.content.rubric}
                              onChange={(e) => content(index, { rubric: e.target.value })}
                            />
                          </Field>
                          {item.snapshot.content.parts.map((part, n) => (
                            <div key={part.id}>
                              <h3>小问 {n + 1}</h3>
                              <StringListEditor
                                label="小问答案"
                                itemLabel="答案"
                                multiline
                                values={part.answers}
                                onChange={(answers) =>
                                  content(index, {
                                    parts: item.snapshot.content.parts.map((p, j) =>
                                      j === n ? { ...p, answers } : p,
                                    ),
                                  })
                                }
                              />
                              <Field label="小问评分标准">
                                <Textarea
                                  value={part.rubric}
                                  onChange={(e) =>
                                    content(index, {
                                      parts: item.snapshot.content.parts.map((p, j) =>
                                        j === n ? { ...p, rubric: e.target.value } : p,
                                      ),
                                    })
                                  }
                                />
                              </Field>
                            </div>
                          ))}
                        </div>
                      )}
                      <label className="p-check p-pagination-control">
                        <input
                          type="checkbox"
                          checked={
                            layout.questionLayouts?.[item.questionId]?.pageBreakBefore ?? false
                          }
                          onChange={(e) =>
                            edit(() =>
                              setLayout({
                                ...layout,
                                questionLayouts: {
                                  ...layout.questionLayouts,
                                  [item.questionId]: {
                                    ...layout.questionLayouts?.[item.questionId],
                                    pageBreakBefore: e.target.checked,
                                  },
                                },
                              }),
                            )
                          }
                        />
                        从新页开始
                      </label>
                      {homework && view !== "answers" && (
                        <div
                          className="p-workbook-answer-space"
                          aria-label={`第 ${index + 1} 题作答空间`}
                        >
                          作答：
                        </div>
                      )}
                    </article>
                  ),
                }))}
              />
            </div>
          </div>
        </DocumentWorkbench>
      </form>
    </>
  );
}

export function PaperExportPage({ id }: { id: string }) {
  const { state } = useDomain();
  const { root, noun } = usePaperPaths();
  const paper = state.papers.find((p) => p.id === id);
  if (!paper) return <MissingRecord back={root} />;
  return (
    <>
      <PageHeader
        title={`导出${noun}`}
        className="p-document-export-heading"
        description="使用本机字体打印或保存 PDF，也可下载可编辑的 Word 文档。"
        back={{ href: `${root}/${id}`, label: paper.name }}
      />
      <PaperNavigation paper={paper} active={`${root}/${id}/export`} />
      <DocumentWorkbench
        title={paper.name}
        status="打印预览"
        actions={<DocumentExport paperId={id} title={paper.name} />}
        outline={false}
        properties={false}
      >
        <div className="p-document-preview">
          <div>
            <DocumentCanvas
              layout={paper.layout}
              header={
                <>
                  <PaperText
                    readOnly
                    title
                    label="试卷名称"
                    value={paper.name}
                    onChange={() => {}}
                  />
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
                  <article className="p-paper-question">
                    <DocumentQuestionBody question={item.snapshot} index={index} />
                  </article>
                ),
              }))}
            />
          </div>
        </div>
      </DocumentWorkbench>
    </>
  );
}
