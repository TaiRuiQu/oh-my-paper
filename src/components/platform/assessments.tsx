"use client";
import { useState } from "react";
import type { Assessment, AssessmentPaper, PlatformState } from "@/contracts/platform";
import { Empty, Field, Panel, Submit, readForm, stringField } from "./primitives";
import type { Mutate } from "./questions";
const bands = [
  { upperPercent: 15, min: 86, max: 100 },
  { upperPercent: 50, min: 71, max: 85 },
  { upperPercent: 85, min: 56, max: 70 },
  { upperPercent: 98, min: 41, max: 55 },
  { upperPercent: 100, min: 30, max: 40 },
];
export function Assessments({
  state,
  mutate,
  pending,
}: {
  state: PlatformState;
  mutate: Mutate;
  pending: boolean;
}) {
  const [editing, setEditing] = useState<Assessment | null | undefined>();
  return (
    <>
      {editing !== undefined && (
        <AssessmentEditor
          key={editing?.id ?? "new"}
          assessment={editing}
          state={state}
          mutate={mutate}
          pending={pending}
          close={() => setEditing(undefined)}
        />
      )}
      <Panel
        title="考试与作业安排"
        description="一场考试可以包含多个科目。批改完成后按班级与全体学生联合排名。"
        actions={
          <button className="button" onClick={() => setEditing(null)}>
            安排考试 / 作业
          </button>
        }
      >
        {state.assessments.length ? (
          <div className="p-table" role="region" aria-label="考试与作业安排列表" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th>名称</th>
                  <th>用途</th>
                  <th>参与班级</th>
                  <th>科目 / 阅卷</th>
                  <th>发布状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {state.assessments.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <strong>{a.name}</strong>
                    </td>
                    <td>{a.kind === "EXAM" ? "考试" : "作业"}</td>
                    <td>
                      {a.classroomIds
                        .map((id) => state.classrooms.find((c) => c.id === id)?.name)
                        .join("、")}
                    </td>
                    <td>
                      {a.papers.map((p) => (
                        <div key={p.paperId}>
                          {p.subject} · {p.gradingMode === "DOUBLE" ? "双评" : "单评"}
                          {p.conversion.enabled ? " · 排名赋分" : ""}
                        </div>
                      ))}
                    </td>
                    <td>
                      <span className={`p-status${a.published ? " success" : ""}`}>
                        {a.published ? "成绩已发布" : "未发布成绩"}
                      </span>
                    </td>
                    <td>
                      <div className="p-actions">
                        <button className="button secondary" onClick={() => setEditing(a)}>
                          编辑安排
                        </button>
                        <button
                          className="button secondary"
                          disabled={pending}
                          onClick={() =>
                            void mutate({
                              type: "assessment.publish",
                              id: a.id,
                              published: !a.published,
                            })
                          }
                        >
                          {a.published ? "撤回成绩" : "发布成绩"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>选择参与班级与试卷，安排第一场考试或作业。</Empty>
        )}
      </Panel>
    </>
  );
}
function AssessmentEditor({
  assessment,
  state,
  mutate,
  pending,
  close,
}: {
  assessment: Assessment | null;
  state: PlatformState;
  mutate: Mutate;
  pending: boolean;
  close: () => void;
}) {
  const [papers, setPapers] = useState<AssessmentPaper[]>(assessment?.papers ?? []);
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
              kind: stringField(d, "kind") as Assessment["kind"],
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
          <Field label="用途">
            <select name="kind" defaultValue={assessment?.kind ?? "EXAM"}>
              <option value="EXAM">考试</option>
              <option value="HOMEWORK">作业</option>
            </select>
          </Field>
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
              .filter((p) => !papers.some((i) => i.paperId === p.id))
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
            <div className="p-form-grid">
              <Field label="阅卷方式">
                <select
                  value={p.gradingMode}
                  onChange={(e) =>
                    patch(i, { gradingMode: e.target.value as AssessmentPaper["gradingMode"] })
                  }
                >
                  <option value="SINGLE">单评</option>
                  <option value="DOUBLE">双评，分差超阈值进入仲裁</option>
                </select>
              </Field>
              <Field label="仲裁分差阈值">
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={p.arbitrationThreshold}
                  onChange={(e) => patch(i, { arbitrationThreshold: Number(e.target.value) })}
                />
              </Field>
            </div>
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
          <Submit pending={pending}>保存安排</Submit>
          <button type="button" className="button secondary" onClick={close}>
            取消
          </button>
        </div>
      </form>
    </Panel>
  );
}
