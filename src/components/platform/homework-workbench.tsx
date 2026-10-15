"use client";
import { DocumentWorkbench } from "./document-workbench";
import { DocumentExport } from "./document-export";
import { DOCUMENT_DEFAULTS, documentAnswerSpaceMm } from "@/lib/document-layout";
import { WorkbookAnswerSpace } from "./workbook-answer-space";
import { GradeSelect, normalizeGrade } from "./grade-select";
import { DocumentFormatControls, DocumentInsertTools } from "./document-controls";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowDown, ArrowUp, ArrowRight, Plus, Printer, Save, Trash2 } from "lucide-react";
import { SUBJECTS, type BankQuestion, type DocumentLayout, type Paper } from "@/contracts/platform";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useDomain } from "./domain-provider";
import { useUnsavedChanges } from "./use-unsaved-changes";
import { DocumentQuestionBody } from "./document-question";
import { StudentIdentity } from "./student-identity";
import { DocumentCanvas, PaperText } from "./document-canvas";
import { Field, Panel, Empty } from "./primitives";
import { MissingRecord, PageHeader, PageTabs } from "./page-header";
import { RecordNameEditor } from "./record-name-editor";
import { QUESTION_LABELS } from "./questions";
import { StringListEditor } from "./editable-list";

export function HomeworkNavigation({ id, active }: { id: string; active: string }) {
  const base = `/homework/${id}`;
  return (
    <PageTabs
      active={active}
      links={[
        { href: base, label: "作业工作台" },
        { href: `${base}/edit`, label: "练习册排版" },
        { href: `${base}/answers`, label: "答案与批改依据" },
        { href: `${base}/export`, label: "导出练习册" },
      ]}
    />
  );
}

export function HomeworkListPage({ exporting = false }: { exporting?: boolean }) {
  const { state } = useDomain();
  const [query, setQuery] = useState("");
  const papers = state.papers.filter((p) => `${p.name} ${p.subject} ${p.grade}`.includes(query));
  return (
    <>
      <PageHeader
        title={exporting ? "导出作业" : "作业管理"}
        description={
          exporting
            ? "选择练习册并检查题目和作答空间，导出可直接下发的纸质作业。"
            : "组织日常练习，将题目与学生作答放在同一份练习册里。"
        }
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/homework/import">图片识别作业</Link>
            </Button>
            <Button asChild>
              <Link href="/homework/new">
                <Plus />
                创建作业
              </Link>
            </Button>
          </>
        }
      />
      <Panel
        title={exporting ? "选择练习册" : "全部作业"}
        description={`${state.papers.length} 份练习册`}
      >
        <div className="p-toolbar">
          <Input
            aria-label="搜索作业"
            placeholder="搜索作业名称、学科或年级"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {papers.length ? (
          <div className="p-table" role="region" aria-label="作业列表" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th>作业</th>
                  <th>学科 / 年级</th>
                  <th>题目 / 分值</th>
                  <th>布置班次</th>
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
                        noun="作业"
                        href={`/homework/${p.id}`}
                      />
                      <small>{new Date(p.updatedAt).toLocaleDateString("zh-CN")} 更新</small>
                    </td>
                    <td>
                      {p.subject} · {p.grade}
                    </td>
                    <td>
                      {p.items.length} 题 / {p.items.reduce((n, i) => n + i.score, 0)} 分
                    </td>
                    <td>
                      {
                        state.assessments.filter((a) => a.papers.some((i) => i.paperId === p.id))
                          .length
                      }{" "}
                      次
                    </td>
                    <td>
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/homework/${p.id}/${exporting ? "export" : "edit"}`}>
                          {exporting ? "导出" : "进入作业工作台"}
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
            <h3>{query ? "没有匹配的作业" : "建立第一份日常练习"}</h3>
            <p>从题库选题，设置每题的作答空间，保存后布置给班级。</p>
            <Button asChild variant="outline">
              <Link href="/homework/new">创建作业</Link>
            </Button>
          </div>
        )}
      </Panel>
    </>
  );
}

export function HomeworkOverviewPage({ id }: { id: string }) {
  const { state } = useDomain();
  const paper = state.papers.find((p) => p.id === id);
  if (!paper) return <MissingRecord back="/homework" />;
  const assignments = state.assessments.filter((a) => a.papers.some((p) => p.paperId === id));
  const submissions = state.submissions.filter((s) => s.paperId === id);
  return (
    <>
      <PageHeader
        title={paper.name}
        titleEditor={<RecordNameEditor record={paper} kind="paper" noun="作业" heading />}
        description={`${paper.subject} · ${paper.grade} · 日常练习册工作台`}
        back={{ href: "/homework", label: "全部作业" }}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={`/homework/${id}/edit`}>编辑练习册</Link>
            </Button>
            <Button asChild>
              <Link href={`/homework/assignments/new?paperId=${id}`}>布置给班级</Link>
            </Button>
          </>
        }
      />
      <HomeworkNavigation id={id} active={`/homework/${id}`} />
      <div className="p-summary-strip">
        <div>
          <small>题目与总分</small>
          <strong>
            {paper.items.length} 题 / {paper.items.reduce((n, i) => n + i.score, 0)} 分
          </strong>
        </div>
        <div>
          <small>布置记录</small>
          <strong>{assignments.length} 次</strong>
        </div>
        <div>
          <small>已收作业</small>
          <strong>{submissions.length} 份</strong>
        </div>
        <div>
          <small>已批改</small>
          <strong>{submissions.filter((s) => s.status === "GRADED").length} 份</strong>
        </div>
      </div>
      <div className="p-detail-grid">
        <Panel title="班级布置与批改进度">
          {assignments.length ? (
            assignments.map((a) => (
              <div className="p-list-row" key={a.id}>
                <div>
                  <Link href={`/homework/assignments/${a.id}`}>{a.name}</Link>
                  <small>
                    {a.classroomIds
                      .map((c) => state.classrooms.find((x) => x.id === c)?.name)
                      .join("、")}
                  </small>
                </div>
                <Badge variant="secondary">{a.published ? "反馈已发布" : "批改中"}</Badge>
              </div>
            ))
          ) : (
            <Empty>练习册保存后，选择班级即可布置；每次布置保留独立批改记录。</Empty>
          )}
        </Panel>
        <Panel title="作业操作">
          <div className="p-task-links">
            <Link href={`/homework/${id}/export`}>
              <div>
                导出练习册<small>题目与作答区域一起打印</small>
              </div>
              <Printer size={16} />
            </Link>
            <Link href="/homework/submissions">
              <div>
                录入练习册作答<small>按学生框选每题的作答范围</small>
              </div>
              <ArrowRight size={16} />
            </Link>
            <Link href="/homework/grading">
              <div>
                批改与反馈<small>逐题评分并记录学习建议</small>
              </div>
              <ArrowRight size={16} />
            </Link>
          </div>
        </Panel>
      </div>
    </>
  );
}

export function HomeworkEditorPage({ id, answers = false }: { id?: string; answers?: boolean }) {
  const { state } = useDomain();
  const paper = state.papers.find((p) => p.id === id);
  if (id && !paper) return <MissingRecord back="/homework" />;
  return <WorkbookWorkbench key={`${id ?? "new"}/${answers}`} paper={paper} answers={answers} />;
}

type Exercise = { question: BankQuestion; score: number; section: string };
function WorkbookWorkbench({ paper, answers }: { paper?: Paper; answers: boolean }) {
  const { state, mutate, pending } = useDomain();
  const router = useRouter();
  const [name, setName] = useState(paper?.name ?? "");
  const [instructions, setInstructions] = useState(paper?.instructions ?? "");
  const [subject, setSubject] = useState(paper?.subject ?? "数学");
  const [grade, setGrade] = useState(normalizeGrade(paper?.grade));
  const [dirty, setDirty] = useState(false);
  useUnsavedChanges(dirty);
  const [layout, setLayout] = useState<DocumentLayout>(
    paper?.layout ?? { ...DOCUMENT_DEFAULTS, questionLayouts: {} },
  );
  const [exercises, setExercises] = useState<Exercise[]>(
    paper?.items.map((i) => ({
      question: structuredClone(i.snapshot),
      score: i.score,
      section: i.section,
    })) ?? [],
  );
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedExerciseIndex = Math.max(0, Math.min(selectedIndex, exercises.length - 1));
  const selectedExercise = exercises[selectedExerciseIndex];
  const used =
    !!paper && state.assessments.some((a) => a.papers.some((p) => p.paperId === paper.id));
  const change = (fn: () => void) => {
    fn();
    setDirty(true);
  };
  const update = (index: number, value: Partial<Exercise>) =>
    change(() => setExercises(exercises.map((i, n) => (n === index ? { ...i, ...value } : i))));
  const questionContent = (
    index: number,
    field: "stem" | "rubric" | "explanation",
    value: string,
  ) =>
    update(index, {
      question: {
        ...exercises[index].question,
        content: {
          ...exercises[index].question.content,
          [field]: value,
        },
      },
    });
  const move = (index: number, direction: number) => {
    const next = index + direction;
    if (next < 0 || next >= exercises.length) return;
    const all = [...exercises];
    [all[index], all[next]] = [all[next], all[index]];
    change(() => setExercises(all));
  };

  async function save() {
    const result = await mutate({
      type: "paper.save",
      paper: {
        id: used ? undefined : paper?.id,
        name: used ? `${name}（新版）` : name,
        kind: "HOMEWORK",
        subject,
        grade,
        instructions,
        layout,
        items: exercises.map((i) => ({
          questionId: i.question.id,
          score: i.score,
          section: i.section,
          content: i.question.content,
          question: i.question,
        })),
      },
    });
    if (result.error || !result.id) return;
    setDirty(false);
    router.push(`/homework/${result.id}`);
  }
  return (
    <>
      <PageHeader
        title={answers ? "答案与批改依据" : paper ? "练习册排版工作台" : "创建作业"}
        description={
          answers
            ? "把答案、解析和批改依据记录在每一道题旁，作为本份作业的参考。"
            : "在纸面上组织练习，调整题目和作答空间。学生在同一份练习册中完成作答。"
        }
        back={{
          href: paper ? `/homework/${paper.id}` : "/homework",
          label: paper?.name ?? "全部作业",
        }}
        actions={
          !paper ? (
            <Button asChild variant="outline">
              <Link href="/homework/import">图片识别作业</Link>
            </Button>
          ) : undefined
        }
      />
      {paper && (
        <HomeworkNavigation
          id={paper.id}
          active={`/homework/${paper.id}/${answers ? "answers" : "edit"}`}
        />
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <DocumentWorkbench
          outline={false}
          propertiesPanel={
            <>
              <aside className="p-paper-bank">
                {selectedExercise && (
                  <div className="p-mobile-document-tools">
                    <h3>练习设置</h3>
                    <div className="p-form-grid">
                      <Field label="当前练习">
                        <select
                          value={selectedExerciseIndex}
                          onChange={(e) => setSelectedIndex(Number(e.target.value))}
                        >
                          {exercises.map((exercise, n) => (
                            <option key={exercise.question.id} value={n}>
                              第 {n + 1} 题
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="分值">
                        <Input
                          type="number"
                          min={0}
                          step={0.5}
                          value={selectedExercise.score}
                          onChange={(e) =>
                            update(selectedExerciseIndex, { score: Number(e.target.value) })
                          }
                        />
                      </Field>
                      <Field label="作答区域高度（mm）">
                        <Input
                          type="number"
                          min={0}
                          max={200}
                          value={documentAnswerSpaceMm(layout, selectedExercise.question)}
                          onChange={(e) =>
                            change(() =>
                              setLayout({
                                ...layout,
                                questionLayouts: {
                                  ...layout.questionLayouts,
                                  [selectedExercise.question.id]: {
                                    ...layout.questionLayouts?.[selectedExercise.question.id],
                                    answerSpaceMm: Number(e.target.value),
                                  },
                                },
                              }),
                            )
                          }
                        />
                      </Field>
                    </div>
                    <div className="p-actions">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={selectedExerciseIndex === 0}
                        onClick={() => {
                          move(selectedExerciseIndex, -1);
                          setSelectedIndex(selectedExerciseIndex - 1);
                        }}
                      >
                        上移练习
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={selectedExerciseIndex === exercises.length - 1}
                        onClick={() => {
                          move(selectedExerciseIndex, 1);
                          setSelectedIndex(selectedExerciseIndex + 1);
                        }}
                      >
                        下移练习
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                          change(() =>
                            setExercises(exercises.filter((_, n) => n !== selectedExerciseIndex)),
                          )
                        }
                      >
                        <Trash2 />
                        移除练习
                      </Button>
                      <label className="p-check">
                        <input
                          type="checkbox"
                          checked={
                            layout.questionLayouts?.[selectedExercise.question.id]
                              ?.pageBreakBefore ?? false
                          }
                          onChange={(e) =>
                            change(() =>
                              setLayout({
                                ...layout,
                                questionLayouts: {
                                  ...layout.questionLayouts,
                                  [selectedExercise.question.id]: {
                                    ...layout.questionLayouts?.[selectedExercise.question.id],
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
                    <p className="p-muted">点击「100% 编辑」放大纸面，再直接编辑练习内容。</p>
                  </div>
                )}
                <h2>添加练习题</h2>
                <div className="p-paper-settings">
                  <Field label="学科">
                    <select
                      value={subject}
                      disabled={exercises.length > 0}
                      onChange={(e) => setSubject(e.target.value)}
                    >
                      {SUBJECTS.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="年级">
                    <GradeSelect
                      value={grade}
                      onChange={(e) => change(() => setGrade(e.target.value))}
                    />
                  </Field>
                </div>
                <DocumentInsertTools
                  subject={subject}
                  grade={grade}
                  usedIds={exercises.map((i) => i.question.id)}
                  onText={() =>
                    change(() =>
                      setLayout({
                        ...layout,
                        textBlocks: [
                          ...(layout.textBlocks ?? []),
                          {
                            id: crypto.randomUUID(),
                            text: "",
                            beforeQuestionId: selectedExercise?.question.id,
                          },
                        ],
                      }),
                    )
                  }
                  onAdd={(q) =>
                    change(() =>
                      setExercises([
                        ...exercises,
                        {
                          question: structuredClone(q),
                          score:
                            q.type === "MIXED"
                              ? q.content.parts.reduce((n, p) => n + p.score, 0)
                              : 5,
                          section: QUESTION_LABELS[q.type],
                        },
                      ]),
                    )
                  }
                />
              </aside>
            </>
          }
          title={name.trim() || "作业练习册"}
          status={
            <>
              <Badge variant="secondary">{exercises.length} 道练习</Badge>
              <span className={dirty ? "p-dirty" : "p-muted"}>
                {dirty ? "有未保存的修改" : "练习册草稿"}
              </span>
            </>
          }
          actions={
            <Button disabled={pending || !name.trim()}>
              <Save />
              {pending ? "正在保存…" : used ? "保存为新版作业" : "保存作业"}
            </Button>
          }
          ribbon={
            <div className="p-document-ribbon">
              <DocumentFormatControls
                layout={layout}
                onChange={(value) => change(() => setLayout(value))}
              />
              <Field label="分栏">
                <select
                  value={layout.columns}
                  onChange={(e) =>
                    change(() => setLayout({ ...layout, columns: Number(e.target.value) }))
                  }
                >
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>
                      {n} 栏
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="纸张">
                <select
                  value={layout.paperSize}
                  onChange={(e) =>
                    change(() => setLayout({ ...layout, paperSize: e.target.value as "A4" | "A3" }))
                  }
                >
                  <option>A4</option>
                  <option>A3</option>
                </select>
              </Field>
              <Field label="页边距 mm">
                <Input
                  type="number"
                  min={8}
                  max={40}
                  value={layout.marginMm ?? DOCUMENT_DEFAULTS.marginMm}
                  onChange={(e) =>
                    change(() => setLayout({ ...layout, marginMm: Number(e.target.value) }))
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
                    change(() => setLayout({ ...layout, fontSizePt: Number(e.target.value) }))
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
                    change(() => setLayout({ ...layout, lineHeight: Number(e.target.value) }))
                  }
                />
              </Field>
            </div>
          }
          notice={used && <p className="p-notice">这份作业已经布置，修改将保存为新版本。</p>}
        >
          <div className="p-workbook-workbench">
            <div>
              <DocumentCanvas
                layout={layout}
                onTextBlocksChange={(textBlocks) =>
                  change(() => setLayout({ ...layout, textBlocks }))
                }
                header={
                  <>
                    <StudentIdentity />
                    <PaperText
                      title
                      label="作业名称"
                      value={name}
                      onChange={(v) => change(() => setName(v))}
                    />
                    <PaperText
                      label="作业说明"
                      value={instructions}
                      onChange={(v) => change(() => setInstructions(v))}
                    />
                  </>
                }
                empty={
                  <div className="p-empty-action">
                    <h3>选择练习题开始排版</h3>
                    <p>书写题默认预留空白作答区，可在练习设置中调整高度或分页。</p>
                  </div>
                }
                blocks={exercises.map((exercise, index) => {
                  const key = exercise.question.id;
                  const settings = layout.questionLayouts?.[key];
                  const answerSpaceMm = documentAnswerSpaceMm(layout, exercise.question);
                  return {
                    key,
                    pageBreakBefore: settings?.pageBreakBefore,
                    content: (
                      <article
                        className="p-workbook-exercise"
                        data-selected={selectedExerciseIndex === index}
                        onFocus={() => setSelectedIndex(index)}
                        onClick={() => setSelectedIndex(index)}
                        style={{ paddingBottom: `${settings?.spaceAfterMm ?? 2}mm` }}
                      >
                        <div className="p-question-meta p-document-edit-tools">
                          <strong>{index + 1}.</strong>
                          <Badge variant="secondary">
                            {QUESTION_LABELS[exercise.question.type]}
                          </Badge>
                          <Input
                            type="number"
                            min={0}
                            step={0.5}
                            className="p-score-input"
                            aria-label={`练习 ${index + 1} 分值`}
                            value={exercise.score}
                            onChange={(e) => update(index, { score: Number(e.target.value) })}
                          />
                          <span>分</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={`上移练习 ${index + 1}`}
                            disabled={!index}
                            onClick={() => move(index, -1)}
                          >
                            <ArrowUp />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={`下移练习 ${index + 1}`}
                            disabled={index === exercises.length - 1}
                            onClick={() => move(index, 1)}
                          >
                            <ArrowDown />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={`移除练习 ${index + 1}`}
                            onClick={() =>
                              change(() => setExercises(exercises.filter((_, n) => n !== index)))
                            }
                          >
                            <Trash2 />
                          </Button>
                        </div>
                        <DocumentQuestionBody
                          question={exercise.question}
                          index={index}
                          labelPrefix={`练习 ${index + 1} `}
                          onChange={(value) =>
                            update(index, {
                              question: {
                                ...exercise.question,
                                content: { ...exercise.question.content, ...value },
                              },
                            })
                          }
                        />
                        {answers ? (
                          <div className="p-answers">
                            <StringListEditor
                              label={`练习 ${index + 1} 标准答案`}
                              itemLabel="答案"
                              multiline
                              values={exercise.question.content.answers}
                              onChange={(answers) =>
                                update(index, {
                                  question: {
                                    ...exercise.question,
                                    content: { ...exercise.question.content, answers },
                                  },
                                })
                              }
                            />
                            <Field label="解析">
                              <PaperText
                                label={`练习 ${index + 1} 解析`}
                                value={exercise.question.content.explanation}
                                onChange={(v) => questionContent(index, "explanation", v)}
                              />
                            </Field>
                            <Field label="批改依据">
                              <PaperText
                                label={`练习 ${index + 1} 批改依据`}
                                value={exercise.question.content.rubric}
                                onChange={(v) => questionContent(index, "rubric", v)}
                              />
                            </Field>
                            {exercise.question.content.parts.map((part, n) => (
                              <StringListEditor
                                key={part.id}
                                label={`小问 ${n + 1} 标准答案`}
                                itemLabel="答案"
                                multiline
                                values={part.answers}
                                onChange={(answers) =>
                                  update(index, {
                                    question: {
                                      ...exercise.question,
                                      content: {
                                        ...exercise.question.content,
                                        parts: exercise.question.content.parts.map((p, j) =>
                                          j === n ? { ...p, answers } : p,
                                        ),
                                      },
                                    },
                                  })
                                }
                              />
                            ))}
                          </div>
                        ) : (
                          <WorkbookAnswerSpace
                            heightMm={answerSpaceMm}
                            label={`练习 ${index + 1} 作答区域`}
                          />
                        )}
                      </article>
                    ),
                  };
                })}
              />
            </div>
          </div>
        </DocumentWorkbench>
      </form>
    </>
  );
}

export function HomeworkExportPage({ id }: { id: string }) {
  const { state } = useDomain();
  const paper = state.papers.find((p) => p.id === id);
  if (!paper) return <MissingRecord back="/homework" />;
  return (
    <>
      <PageHeader
        title="导出练习册"
        className="p-document-export-heading"
        description="使用本机字体打印或保存 PDF，或下载保留题目与作答区域的 Word 文档。"
        back={{ href: `/homework/${id}`, label: paper.name }}
      />
      <HomeworkNavigation id={id} active={`/homework/${id}/export`} />
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
                  <StudentIdentity />
                  <PaperText
                    readOnly
                    title
                    label="作业名称"
                    value={paper.name}
                    onChange={() => {}}
                  />
                  <PaperText
                    readOnly
                    label="作业说明"
                    value={paper.instructions}
                    onChange={() => {}}
                  />
                </>
              }
              blocks={paper.items.map((i, n) => ({
                key: i.questionId,
                pageBreakBefore: paper.layout.questionLayouts?.[i.questionId]?.pageBreakBefore,
                content: (
                  <article
                    className="p-workbook-exercise"
                    style={{
                      paddingBottom: `${paper.layout.questionLayouts?.[i.questionId]?.spaceAfterMm ?? 2}mm`,
                    }}
                  >
                    <DocumentQuestionBody question={i.snapshot} index={n} />
                    <WorkbookAnswerSpace
                      heightMm={documentAnswerSpaceMm(paper.layout, i.snapshot)}
                    />
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
