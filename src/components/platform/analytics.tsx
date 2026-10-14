"use client";
import Image from "next/image";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/http-client";
import type {
  Analytics as AnalyticsData,
  KnowledgeStat,
  PlatformState,
} from "@/contracts/platform";
import { Empty, Panel } from "./primitives";
import { QuestionBody } from "./questions";
export function KnowledgeTable({ knowledge }: { knowledge: KnowledgeStat[] }) {
  return knowledge.length ? (
    <div className="p-table" role="region" aria-label="知识点掌握情况" tabIndex={0}>
      <table>
        <thead>
          <tr>
            <th>知识点</th>
            <th>得分率</th>
            <th>得分 / 满分</th>
            <th>答题次数</th>
          </tr>
        </thead>
        <tbody>
          {[...knowledge]
            .sort((a, b) => a.accuracy - b.accuracy)
            .map((k) => (
              <tr key={k.tag}>
                <td>{k.tag}</td>
                <td>
                  {(k.accuracy * 100).toFixed(1)}%
                  <span className="p-bar">
                    <span style={{ width: `${k.accuracy * 100}%` }} />
                  </span>
                </td>
                <td>
                  {k.earned} / {k.maximum}
                </td>
                <td>{k.attempts}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty>完成评分后，根据题目知识点自动汇总掌握情况。</Empty>
  );
}
export function Analytics({
  state,
  fixedView,
  initialAssessmentId = "",
  initialClassroomId = "",
  initialStudentId = "",
  kind,
}: {
  state: PlatformState;
  fixedView?: string;
  initialAssessmentId?: string;
  initialClassroomId?: string;
  initialStudentId?: string;
  kind?: "EXAM" | "HOMEWORK";
}) {
  const [assessmentId, setAssessmentId] = useState(initialAssessmentId),
    [classroomId, setClassroomId] = useState(initialClassroomId),
    [studentId, setStudentId] = useState(
      initialStudentId ||
        (state.actor.role === "STUDENT" ? (state.analytics.students[0]?.studentId ?? "") : ""),
    ),
    [view, setView] = useState(fixedView ?? "results");
  const studentMode = state.actor.role === "STUDENT";
  const scope = new URLSearchParams();
  if (assessmentId) scope.set("assessmentId", assessmentId);
  if (classroomId) scope.set("classroomId", classroomId);
  if (studentId) scope.set("studentId", studentId);
  if (kind) scope.set("kind", kind);
  const analyticsQuery = useQuery({
    queryKey: ["platform-analytics", assessmentId, classroomId, studentId, kind, state.analytics],
    queryFn: () => apiRequest<AnalyticsData>(`/api/platform/analytics?${scope}`),
    staleTime: 0,
  });
  const analytics = analyticsQuery.data;
  const results = analytics?.results ?? [];
  const report = analytics?.students.find((s) => s.studentId === studentId);
  const knowledge = report?.knowledge ?? analytics?.knowledge ?? [];
  const availableStudents = state.analytics.students.filter(
    (s) =>
      !classroomId ||
      state.classrooms
        .find((c) => c.id === classroomId)
        ?.students.some((st) => st.id === s.studentId),
  );
  return (
    <>
      <Panel
        title={studentMode ? "我的成绩与学习情况" : "成绩与学情分析"}
        description={
          studentMode
            ? "查看已发布成绩、错题与薄弱知识点，选择相近题目巩固练习。"
            : "联合排名包含考试所有科目；未完成阅卷的学生保留待评分状态。"
        }
      >
        <div className="p-toolbar">
          <select
            aria-label="筛选考试"
            value={assessmentId}
            onChange={(e) => setAssessmentId(e.target.value)}
          >
            <option value="">全部考试 / 作业</option>
            {state.assessments.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          {!studentMode && (
            <select
              aria-label="筛选班级"
              value={classroomId}
              onChange={(e) => {
                setClassroomId(e.target.value);
                setStudentId("");
              }}
            >
              <option value="">全部班级</option>
              {state.classrooms.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          {!fixedView && (
            <div className="p-tabs">
              {[
                ["results", "成绩排名"],
                ["knowledge", "知识点掌握"],
                ["learning", "错题与练习"],
              ].map(([key, label]) => (
                <button key={key} aria-pressed={view === key} onClick={() => setView(key)}>
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        {analyticsQuery.isPending && (
          <p role="status" className="p-empty">
            正在加载所选范围的学情…
          </p>
        )}
        {analyticsQuery.error && (
          <p role="alert" className="p-notice error">
            {analyticsQuery.error.message}
          </p>
        )}
        {view === "results" &&
          !analyticsQuery.isPending &&
          (results.length ? (
            <div className="p-table" role="region" aria-label="成绩与排名" tabIndex={0}>
              <table>
                <thead>
                  <tr>
                    <th>考试 / 作业</th>
                    <th>学生 / 班级</th>
                    <th>各科成绩</th>
                    <th>总分</th>
                    <th>联合排名</th>
                    <th>班级排名</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr key={`${r.assessmentId}-${r.studentId}`}>
                      <td>{state.assessments.find((a) => a.id === r.assessmentId)?.name}</td>
                      <td>
                        <strong>{r.studentName}</strong>
                        <div className="p-muted">
                          {r.classroomName} · {r.studentNumber}
                        </div>
                      </td>
                      <td>
                        {r.subjects.map((s) => (
                          <div key={s.paperId}>
                            {s.subject}：{s.score ?? "待评分"}
                            {s.rawScore !== s.score && s.rawScore !== null
                              ? `（原始分 ${s.rawScore}）`
                              : ""}
                            <span className="p-muted">
                              {" "}
                              / {s.maxScore} · 科目排名 {s.rank ?? "—"}
                            </span>
                          </div>
                        ))}
                      </td>
                      <td className="p-score">{r.total ?? "待评分"}</td>
                      <td>{r.rank ?? "—"}</td>
                      <td>{r.classRank ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>
              {studentMode
                ? "目前没有已发布的成绩。"
                : "尚无考试成绩。完成阅卷后会自动生成成绩与排名。"}
            </Empty>
          ))}
        {view === "knowledge" && !analyticsQuery.isPending && (
          <>
            <KnowledgeTable knowledge={knowledge} />
            {!studentMode && !classroomId && (analytics?.classrooms.length ?? 0) > 0 && (
              <div className="p-table" role="region" aria-label="班级学情汇总" tabIndex={0}>
                <table>
                  <thead>
                    <tr>
                      <th>班级</th>
                      <th>参与学生</th>
                      <th>平均总分</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics?.classrooms.map((c) => (
                      <tr key={c.id}>
                        <td>{c.name}</td>
                        <td>{c.participantCount}</td>
                        <td>{c.average?.toFixed(1) ?? "待评分"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        {view === "learning" && !analyticsQuery.isPending && (
          <>
            <div className="p-toolbar">
              <select
                aria-label="查看学生学情"
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
              >
                <option value="">选择学生</option>
                {availableStudents.map((s) => (
                  <option key={s.studentId} value={s.studentId}>
                    {state.classrooms.flatMap((c) => c.students).find((st) => st.id === s.studentId)
                      ?.name ?? state.actor.name}
                  </option>
                ))}
              </select>
            </div>
            {report ? (
              <>
                <div className="p-table" role="region" aria-label="学生学科表现" tabIndex={0}>
                  <table>
                    <thead>
                      <tr>
                        <th>学科</th>
                        <th>得分 / 满分</th>
                        <th>得分率</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.subjects.map((s) => (
                        <tr key={s.subject}>
                          <td>{s.subject}</td>
                          <td>
                            {s.earned} / {s.maximum}
                          </td>
                          <td>{(s.accuracy * 100).toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="p-panel-content">
                  <h3>错题汇总 · {report.wrongQuestions.length} 题</h3>
                </div>
                {report.wrongQuestions.length ? (
                  report.wrongQuestions.map((w) => (
                    <article key={`${w.assessmentId}-${w.itemId}`} className="p-question">
                      <div className="p-question-head">
                        <span className="p-muted">
                          {w.question.subject} ·{" "}
                          {state.assessments.find((a) => a.id === w.assessmentId)?.name}
                        </span>
                        <strong>
                          {w.score} / {w.maximum} 分
                        </strong>
                      </div>
                      <QuestionBody question={w.question} />
                      {!!w.wrongPartIds?.length && (
                        <p className="p-notice">
                          需巩固的小问：
                          {w.wrongPartIds
                            .map(
                              (id) =>
                                `第 ${w.question.content.parts.findIndex((p) => p.id === id) + 1} 小问`,
                            )
                            .join("、")}
                        </p>
                      )}

                      <p>我的答案：{w.answer.text || "见作答图像"}</p>
                      {w.answer.images.map((url) => (
                        <Image
                          unoptimized
                          width={1000}
                          height={1000}
                          key={url}
                          className="p-scan-image"
                          src={url}
                          alt="错题作答"
                        />
                      ))}
                      <p>参考答案：{w.question.content.answers.join("；")}</p>
                      <p className="p-muted">批改反馈：{w.feedback || "暂无文字反馈"}</p>
                      <div className="p-tags">
                        {w.question.knowledgeTags.map((t) => (
                          <span className="p-tag" key={t}>
                            {t}
                          </span>
                        ))}
                      </div>
                    </article>
                  ))
                ) : (
                  <Empty>当前没有错题记录。</Empty>
                )}
                <div className="p-panel-content">
                  <h3>薄弱知识点巩固练习 · {report.recommendations.length} 题</h3>
                  <p className="p-muted">从现有题库中选择与薄弱知识点相关的其他题目。</p>
                </div>
                {report.recommendations.length ? (
                  report.recommendations.map((q) => (
                    <article key={q.id} className="p-question">
                      <QuestionBody question={q} />
                      <div className="p-tags">
                        {q.knowledgeTags.map((t) => (
                          <span key={t} className="p-tag">
                            {t}
                          </span>
                        ))}
                      </div>
                      <details>
                        <summary>查看参考答案</summary>
                        <p>{q.content.answers.join("；")}</p>
                        <p>{q.content.explanation}</p>
                      </details>
                    </article>
                  ))
                ) : (
                  <Empty>题库中暂无相关练习。老师添加知识点相近的题目后，将在这里推荐。</Empty>
                )}
              </>
            ) : (
              <Empty>选择一位学生查看学情、错题与推荐练习。</Empty>
            )}
          </>
        )}
      </Panel>
    </>
  );
}
