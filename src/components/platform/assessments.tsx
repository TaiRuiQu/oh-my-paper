"use client";
import { reviewRule } from "@/lib/document-layout";
import { useState } from "react";
import type { Assessment, AssessmentPaper, PlatformState } from "@/contracts/platform";
import { Field, Panel, Submit, readForm, stringField } from "./primitives";
import type { Mutate } from "./questions";
const bands = [
  { upperPercent: 15, min: 86, max: 100 },
  { upperPercent: 50, min: 71, max: 85 },
  { upperPercent: 85, min: 56, max: 70 },
  { upperPercent: 98, min: 41, max: 55 },
  { upperPercent: 100, min: 30, max: 40 },
];
export function AssessmentEditor({
  assessment,
  state,
  mutate,
  pending,
  close,
  fixedKind,
  initialPaperId,
}: {
  fixedKind?: Assessment["kind"];
  initialPaperId?: string;
  assessment: Assessment | null;
  state: PlatformState;
  mutate: Mutate;
  pending: boolean;
  close: () => void;
}) {
  const [papers, setPapers] = useState<AssessmentPaper[]>(
    assessment?.papers ??
      (initialPaperId && state.papers.some((p) => p.id === initialPaperId)
        ? [
            {
              paperId: initialPaperId,
              subject: state.papers.find((p) => p.id === initialPaperId)!.subject,
              gradingMode: "SINGLE",
              arbitrationThreshold: 2,
              conversion: { enabled: false, bands },
            },
          ]
        : []),
  );
  const patch = (index: number, value: Partial<AssessmentPaper>) =>
    setPapers(papers.map((p, i) => (i === index ? { ...p, ...value } : p)));
  return (
    <Panel
      title={assessment ? "编辑考试 / 作业" : "安排考试 / 作业"}
      actions={
        <button className="button secondary" onClick={close}>
          关闭编辑
        </button>
      }
    >
      <form
        className="p-form"
        onSubmit={async (e) => {
          const d = readForm(e);
          const result = await mutate({
            type: "assessment.save",
            assessment: {
              id: assessment?.id,
              name: stringField(d, "name"),
              kind: fixedKind ?? (stringField(d, "kind") as Assessment["kind"]),
              classroomIds: d.getAll("classroomIds").map(String),
              papers,
            },
          });
          if (result.error) return;
          close();
        }}
      >
        <div className="p-form-grid">
          <Field label="名称">
            <input required name="name" defaultValue={assessment?.name} />
          </Field>
          {!fixedKind && (
            <Field label="用途">
              <select name="kind" defaultValue={assessment?.kind ?? "EXAM"}>
                <option value="EXAM">考试</option>
                <option value="HOMEWORK">作业</option>
              </select>
            </Field>
          )}
        </div>
        <div>
          <h3>参与班级</h3>
          <div className="p-actions">
            {state.classrooms.map((c) => (
              <label className="p-check" key={c.id}>
                <input
                  type="checkbox"
                  name="classroomIds"
                  value={c.id}
                  defaultChecked={assessment?.classroomIds.includes(c.id)}
                />
                {c.name}
              </label>
            ))}
          </div>
          {!state.classrooms.length && <p className="p-muted">请先在「班级与学生」中创建班级。</p>}
        </div>
        <Field label="添加学科试卷">
          <select
            defaultValue=""
            onChange={(e) => {
              const paper = state.papers.find((p) => p.id === e.target.value);
              if (paper && !papers.some((p) => p.paperId === paper.id))
                setPapers([
                  ...papers,
                  {
                    paperId: paper.id,
                    subject: paper.subject,
                    gradingMode: "SINGLE",
                    arbitrationThreshold: 2,
                    conversion: { enabled: false, bands },
                  },
                ]);
              e.target.value = "";
            }}
          >
            <option value="">选择试卷</option>
            {state.papers
              .filter(
                (p) =>
                  (!fixedKind || p.kind === fixedKind) && !papers.some((i) => i.paperId === p.id),
              )
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.subject}
                </option>
              ))}
          </select>
        </Field>
        {papers.map((p, i) => (
          <section key={p.paperId} className="p-part">
            <div className="p-question-head">
              <h3>{state.papers.find((t) => t.id === p.paperId)?.name}</h3>
              <button
                type="button"
                className="link-button"
                onClick={() => setPapers(papers.filter((_, n) => n !== i))}
              >
                移除
              </button>
            </div>
            <p className="p-muted">
              逐题选择双评。两位老师独立评分，默认取平均分；启用仲裁后，分差严格大于最大分差才进入三评。
            </p>
            <div className="p-table">
              <table>
                <thead>
                  <tr>
                    <th>题目</th>
                    <th>双评</th>
                    <th>仲裁</th>
                    <th>最大分差</th>
                  </tr>
                </thead>
                <tbody>
                  {state.papers
                    .find((t) => t.id === p.paperId)
                    ?.items.map((item, n) => {
                      const rule = reviewRule(p, item.id);
                      const change = (value: Partial<typeof rule>) =>
                        patch(i, {
                          questionRules: {
                            ...Object.fromEntries(
                              (state.papers.find((t) => t.id === p.paperId)?.items ?? []).map(
                                (it) => [it.id, reviewRule(p, it.id)],
                              ),
                            ),
                            [item.id]: { ...rule, ...value },
                          },
                        });
                      return (
                        <tr key={item.id}>
                          <td>
                            第 {n + 1} 题 · {item.score} 分<br />
                            <small>{item.snapshot.content.stem.slice(0, 55)}</small>
                          </td>
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`第 ${n + 1} 题双评`}
                              checked={rule.doubleReview}
                              onChange={(e) => change({ doubleReview: e.target.checked })}
                            />
                          </td>
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`第 ${n + 1} 题仲裁`}
                              disabled={!rule.doubleReview}
                              checked={rule.arbitrationEnabled}
                              onChange={(e) => change({ arbitrationEnabled: e.target.checked })}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              aria-label={`第 ${n + 1} 题最大分差`}
                              min={0}
                              max={item.score}
                              step={0.5}
                              disabled={!rule.doubleReview || !rule.arbitrationEnabled}
                              value={rule.maxDifference}
                              onChange={(e) => change({ maxDifference: Number(e.target.value) })}
                            />
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
            <p className="p-muted">
              仲裁成绩取仲裁员与较接近的一位老师的平均分；两位老师与仲裁员等距时，采用两位老师的均分与仲裁分的平均。所有提交与修改均记录。
            </p>
            <label className="p-check">
              <input
                type="checkbox"
                checked={p.conversion.enabled}
                onChange={(e) =>
                  patch(i, { conversion: { ...p.conversion, enabled: e.target.checked } })
                }
              />
              按排名赋分（适用于化学、生物等科目）
            </label>
            {p.conversion.enabled && (
              <>
                <p className="p-muted">按累计排名百分比划分等级，分数区间可按当地赋分方案调整。</p>
                <div
                  className="p-table"
                  role="region"
                  aria-label={`${p.subject}排名赋分区间`}
                  tabIndex={0}
                >
                  <table>
                    <thead>
                      <tr>
                        <th>累计排名百分比</th>
                        <th>最低赋分</th>
                        <th>最高赋分</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.conversion.bands.map((b, n) => (
                        <tr key={n}>
                          {(["upperPercent", "min", "max"] as const).map((k) => (
                            <td key={k}>
                              <input
                                aria-label={`第 ${n + 1} 档 ${k}`}
                                type="number"
                                min={0}
                                max={100}
                                value={b[k]}
                                onChange={(e) =>
                                  patch(i, {
                                    conversion: {
                                      ...p.conversion,
                                      bands: p.conversion.bands.map((band, j) =>
                                        j === n ? { ...band, [k]: Number(e.target.value) } : band,
                                      ),
                                    },
                                  })
                                }
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        ))}
        <div className="p-actions">
          <Submit pending={pending} disabled={!papers.length || !state.classrooms.length}>
            保存安排
          </Submit>
          <button type="button" className="button secondary" onClick={close}>
            取消
          </button>
        </div>
      </form>
    </Panel>
  );
}
