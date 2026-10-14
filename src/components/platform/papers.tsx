"use client";
import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Printer, X } from "lucide-react";
import { SUBJECTS, type BankQuestion, type Paper } from "@/contracts/platform";
import { Empty, Field, Panel, Submit } from "./primitives";
import { QUESTION_LABELS, type Mutate } from "./questions";
type DraftItem = { questionId: string; score: number; section: string };
export function Papers({
  papers,
  questions,
  mutate,
  pending,
}: {
  papers: Paper[];
  questions: BankQuestion[];
  mutate: Mutate;
  pending: boolean;
}) {
  const [editing, setEditing] = useState<Paper | null | undefined>();
  return (
    <>
      {editing !== undefined && (
        <PaperEditor
          key={editing?.id ?? "new"}
          paper={editing}
          questions={questions}
          mutate={mutate}
          pending={pending}
          close={() => setEditing(undefined)}
        />
      )}
      <Panel
        title="试卷与作业"
        description="同一题库自由选题，分别组织正式考试和日常作业。"
        actions={
          <button className="button" onClick={() => setEditing(null)}>
            <Plus size={16} />
            新建试卷 / 作业
          </button>
        }
      >
        {!papers.length ? (
          <Empty>先在题库创建试题，再为试卷选择题目和分值。</Empty>
        ) : (
          <div className="p-table" role="region" aria-label="试卷与作业列表" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th>名称</th>
                  <th>用途</th>
                  <th>学科 / 年级</th>
                  <th>题数 / 总分</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {papers.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.name}</strong>
                    </td>
                    <td>
                      <span className="p-status">
                        {p.kind === "EXAM" ? "考试试卷" : "日常作业"}
                      </span>
                    </td>
                    <td>
                      {p.subject} · {p.grade}
                    </td>
                    <td>
                      {p.items.length} 题 / {p.items.reduce((a, i) => a + i.score, 0)} 分
                    </td>
                    <td>
                      <div className="p-actions">
                        <button className="button secondary" onClick={() => setEditing(p)}>
                          编辑组卷
                        </button>
                        <a
                          className="button secondary"
                          target="_blank"
                          rel="noreferrer"
                          href={`/api/platform/print?paperId=${p.id}`}
                        >
                          <Printer size={14} />
                          打印
                        </a>
                        <button
                          className="link-button"
                          disabled={pending}
                          onClick={() => {
                            if (window.confirm(`删除「${p.name}」？`))
                              void mutate({ type: "paper.delete", id: p.id });
                          }}
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
function PaperEditor({
  paper,
  questions,
  mutate,
  pending,
  close,
}: {
  paper: Paper | null;
  questions: BankQuestion[];
  mutate: Mutate;
  pending: boolean;
  close: () => void;
}) {
  const [items, setItems] = useState<DraftItem[]>(
      paper?.items.map((i) => ({ questionId: i.questionId, score: i.score, section: i.section })) ??
        [],
    ),
    [subject, setSubject] = useState(paper?.subject ?? "数学"),
    [query, setQuery] = useState("");
  const available = questions.filter(
    (q) =>
      q.subject === subject && `${q.content.stem} ${q.knowledgeTags.join(" ")}`.includes(query),
  );
  const move = (index: number, direction: number) =>
    setItems((old) => {
      const next = [...old];
      const target = index + direction;
      if (target < 0 || target >= next.length) return old;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  return (
    <Panel
      title={paper ? `编辑「${paper.name}」` : "新建试卷 / 作业"}
      description="题目按列表顺序排版。每道题的分值与大题栏目可单独调整。"
      actions={
        <button className="button secondary" onClick={close}>
          关闭编辑
        </button>
      }
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          const saveCopy =
            (e.nativeEvent as SubmitEvent).submitter?.getAttribute("name") === "saveCopy";
          const result = await mutate({
            type: "paper.save",
            paper: {
              id: saveCopy ? undefined : paper?.id,
              name: String(d.get("name")),
              kind: String(d.get("kind")) as Paper["kind"],
              subject,
              grade: String(d.get("grade")),
              instructions: String(d.get("instructions")),
              layout: {
                paperSize: String(d.get("size")) as "A4" | "A3",
                columns: Number(d.get("columns")),
              },
              items,
            },
          });
          if (result.error) return;
          close();
        }}
      >
        <div className="p-form">
          <div className="p-form-grid">
            <Field label="名称">
              <input
                required
                name="name"
                defaultValue={paper?.name}
                placeholder="例如：高一数学期中考试"
              />
            </Field>
            <Field label="用途">
              <select name="kind" defaultValue={paper?.kind ?? "EXAM"}>
                <option value="EXAM">考试试卷</option>
                <option value="HOMEWORK">日常作业</option>
              </select>
            </Field>
            <Field label="学科">
              <select value={subject} onChange={(e) => setSubject(e.target.value)}>
                {SUBJECTS.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
            <Field label="年级">
              <input name="grade" required defaultValue={paper?.grade ?? "高一"} />
            </Field>
            <Field label="纸张">
              <select name="size" defaultValue={paper?.layout.paperSize ?? "A4"}>
                <option>A4</option>
                <option>A3</option>
              </select>
            </Field>
            <Field label="排版栏数">
              <select name="columns" defaultValue={paper?.layout.columns ?? 1}>
                <option value={1}>单栏</option>
                <option value={2}>双栏</option>
                <option value={3}>三栏</option>
              </select>
            </Field>
          </div>
          <Field label="考试说明 / 作业要求">
            <textarea name="instructions" defaultValue={paper?.instructions} />
          </Field>
        </div>
        <div className="p-split p-panel-content">
          <div>
            <h3>题库选题</h3>
            <input
              aria-label="按题目或知识点查找"
              placeholder="按题目或知识点查找"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {available.length ? (
              available.map((q) => (
                <div className="p-list-row" key={q.id}>
                  <div>
                    <span className="p-status">{QUESTION_LABELS[q.type]}</span>
                    <p>{q.content.stem.slice(0, 100)}</p>
                    <small>{q.knowledgeTags.join(" · ")}</small>
                  </div>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={items.some((i) => i.questionId === q.id)}
                    onClick={() =>
                      setItems([
                        ...items,
                        {
                          questionId: q.id,
                          score:
                            q.type === "MIXED"
                              ? q.content.parts.reduce((s, p) => s + p.score, 0)
                              : 5,
                          section: QUESTION_LABELS[q.type],
                        },
                      ])
                    }
                  >
                    选入
                  </button>
                </div>
              ))
            ) : (
              <Empty>该学科暂无符合条件的试题。</Empty>
            )}
          </div>
          <div>
            <div className="p-question-head">
              <h3>已选 {items.length} 题</h3>
              <strong>总分 {items.reduce((s, i) => s + i.score, 0)}</strong>
            </div>
            {items.length ? (
              items.map((item, index) => (
                <div key={item.questionId} className="p-paper-item">
                  <span className="p-index">{index + 1}</span>
                  <div>
                    <p>
                      {questions.find((q) => q.id === item.questionId)?.content.stem.slice(0, 70) ??
                        "题目快照"}
                    </p>
                    <input
                      aria-label={`第 ${index + 1} 题栏目`}
                      value={item.section}
                      onChange={(e) =>
                        setItems(
                          items.map((i, n) =>
                            n === index ? { ...i, section: e.target.value } : i,
                          ),
                        )
                      }
                    />
                  </div>
                  <Field label="分值">
                    <input
                      aria-label={`第 ${index + 1} 题分值`}
                      type="number"
                      min={0}
                      step={0.5}
                      value={item.score}
                      onChange={(e) =>
                        setItems(
                          items.map((i, n) =>
                            n === index ? { ...i, score: Number(e.target.value) } : i,
                          ),
                        )
                      }
                    />
                  </Field>
                  <div className="p-actions">
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="上移"
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp size={16} />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="下移"
                      disabled={index === items.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown size={16} />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="移除题目"
                      onClick={() => setItems(items.filter((_, i) => i !== index))}
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <Empty>从左侧选入题目。</Empty>
            )}
          </div>
        </div>
        <div className="p-form">
          <div className="p-actions">
            <Submit pending={pending}>保存组卷</Submit>
            {paper && (
              <button type="submit" className="button secondary" name="saveCopy" disabled={pending}>
                另存为新试卷 / 作业
              </button>
            )}
            <button type="button" className="button secondary" onClick={close}>
              取消
            </button>
          </div>
        </div>
      </form>
    </Panel>
  );
}
