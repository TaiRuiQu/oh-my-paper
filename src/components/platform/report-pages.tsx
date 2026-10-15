"use client";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDomain } from "./domain-provider";
import { Empty, Panel } from "./primitives";
import { MissingRecord, PageHeader, PageTabs } from "./page-header";
import { Analytics, KnowledgeTable } from "./analytics";
import { QuestionBody } from "./questions";
import { AssessmentNavigation } from "./assessment-pages";
import { MarkdownText } from "@/components/markdown-text";
import { RevisionPaperLink } from "./revision-paper-pages";

export function ReportListPage() {
  const { state, area } = useDomain();
  const homework = area === "homework";
  const root = homework ? "/homework/assignments" : "/exams";
  const [query, setQuery] = useState("");
  const items = state.assessments.filter((a) => a.name.includes(query));
  return (
    <>
      <PageHeader
        title={homework ? "作业成绩分析" : "考试报告"}
        description="先选择一次教学安排，再查看对应成绩、排名与知识点表现。"
      />
      <Panel title="选择报告">
        <div className="p-toolbar">
          <Input
            aria-label="搜索报告"
            value={query}
            placeholder="考试或作业名称"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {items.length ? (
          <div className="p-table" role="region" aria-label="报告列表" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th>名称</th>
                  <th>学科</th>
                  <th>完成学生</th>
                  <th>平均分</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((a) => {
                  const results = state.analytics.results.filter(
                    (r) => r.assessmentId === a.id && r.total !== null,
                  );
                  return (
                    <tr key={a.id}>
                      <td>
                        <strong>{a.name}</strong>
                        <small>{a.published ? "正式成绩" : "评阅中，数据持续更新"}</small>
                      </td>
                      <td>{a.papers.map((p) => p.subject).join("、")}</td>
                      <td>
                        {results.length} /{" "}
                        {state.classrooms
                          .filter((c) => a.classroomIds.includes(c.id))
                          .reduce((n, c) => n + c.students.length, 0)}{" "}
                        人
                      </td>
                      <td>
                        {results.length
                          ? (results.reduce((n, r) => n + r.total!, 0) / results.length).toFixed(1)
                          : "待评分"}
                      </td>
                      <td>
                        <Button asChild variant="outline" size="sm">
                          <Link href={`${root}/${a.id}/reports`}>查看报告</Link>
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>完成教学安排与评阅后，在这里查看对应报告。</Empty>
        )}
      </Panel>
    </>
  );
}

export function AssessmentReportPage({
  id,
  knowledge = false,
}: {
  id: string;
  knowledge?: boolean;
}) {
  const { state, area } = useDomain();
  const root = area === "homework" ? "/homework/assignments" : "/exams";
  const a = state.assessments.find((a) => a.id === id);
  if (!a) return <MissingRecord back={root} />;
  return (
    <>
      <PageHeader
        title={knowledge ? "知识点表现" : "成绩报告"}
        description={`${a.name} · ${a.published ? "正式发布成绩" : "尚未发布，评阅中的成绩仅供教学核对"}`}
        back={{ href: `${root}/${id}`, label: a.name }}
        actions={
          <Button asChild variant="outline">
            <Link href={`${root}/${id}/${knowledge ? "reports" : "knowledge"}`}>
              {knowledge ? "成绩排名" : "知识点表现"}
            </Link>
          </Button>
        }
      />
      <AssessmentNavigation id={id} active={`${root}/${id}/reports`} />
      <Analytics
        state={state}
        fixedView={knowledge ? "knowledge" : "results"}
        initialAssessmentId={id}
        kind={area === "homework" ? "HOMEWORK" : "EXAM"}
      />
    </>
  );
}

export function ClassReportPage({ id }: { id: string }) {
  const { state } = useDomain();
  const c = state.classrooms.find((c) => c.id === id);
  if (!c) return <MissingRecord back="/workspace/classes" />;
  return (
    <>
      <PageHeader
        title={`${c.name} · 班级学情`}
        description="查看本班学生在各次考试与作业中的成绩，按教学安排继续筛选。"
        back={{ href: `/workspace/classes/${id}`, label: c.name }}
      />
      <PageTabs
        active={`/workspace/classes/${id}/reports`}
        links={[
          { href: `/workspace/classes/${id}`, label: "班级概览" },
          { href: `/workspace/classes/${id}/students`, label: "学生名单" },
          { href: `/workspace/classes/${id}/reports`, label: "班级学情" },
          { href: `/workspace/classes/${id}/settings`, label: "班级设置" },
        ]}
      />
      <Analytics state={state} fixedView="results" initialClassroomId={id} />
    </>
  );
}

export function LearningResultsPage({ id }: { id?: string }) {
  const { state } = useDomain();
  if (id && !state.assessments.some((a) => a.id === id))
    return <MissingRecord back="/learning/results" />;
  return (
    <>
      <PageHeader
        title={id ? state.assessments.find((a) => a.id === id)!.name : "我的考试成绩"}
        description="查看老师已发布的本人原始分、赋分与正式排名。"
        back={id ? { href: "/learning/results", label: "全部成绩" } : undefined}
      />
      <Analytics state={state} fixedView="results" initialAssessmentId={id} />
      {!id && state.assessments.length > 0 && (
        <Panel title="按考试查看">
          {state.assessments.map((a) => (
            <div key={a.id} className="p-list-row">
              <Link href={`/learning/results/${a.id}`}>{a.name}</Link>
              <Button asChild variant="ghost" size="sm">
                <Link href={`/learning/results/${a.id}`}>查看详情</Link>
              </Button>
            </div>
          ))}
        </Panel>
      )}
    </>
  );
}

export function LearningReportPage({
  view = "reports",
}: {
  view?: "reports" | "knowledge" | "wrong" | "practice";
}) {
  const { state } = useDomain();
  const report = state.analytics.students[0];
  const [subject, setSubject] = useState("");
  const title = {
    reports: "我的学习报告",
    knowledge: "知识点掌握",
    wrong: "我的错题",
    practice: "巩固练习",
  }[view];
  const descriptions = {
    reports: "从已发布成绩中了解各科表现，找到下一阶段的学习重点。",
    knowledge: "按知识点查看得分率，优先练习掌握较弱的内容。",
    wrong: "回顾原题、实际作答与老师反馈，理解每一次失分。",
    practice: "选择与薄弱知识点相关的题目，自主练习后核对答案。",
  };
  return (
    <>
      <PageHeader title={title} description={descriptions[view]} />
      {!report ? (
        <Panel title="等待学习数据">
          <Empty>老师发布成绩后生成学习报告。你也可以先检查账号是否已绑定班级学生。</Empty>
        </Panel>
      ) : view === "knowledge" ? (
        <Panel title="知识点掌握情况" description="按得分率从低到高排列。">
          <KnowledgeTable knowledge={report.knowledge} />
        </Panel>
      ) : view === "reports" ? (
        <>
          <Panel title="各科表现">
            <div className="p-table" role="region" aria-label="各科学习情况" tabIndex={0}>
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
                      <td>{Math.round(s.accuracy * 100)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          <Panel title="接下来的学习重点">
            <KnowledgeTable
              knowledge={[...report.knowledge].sort((a, b) => a.accuracy - b.accuracy).slice(0, 8)}
            />
            <div className="p-panel-content p-actions">
              <Button asChild variant="outline">
                <Link href="/learning/wrong-questions">
                  复习 {report.wrongQuestions.length} 道错题
                </Link>
              </Button>
              <Button asChild>
                <Link href="/learning/practice">开始巩固练习</Link>
              </Button>
            </div>
          </Panel>
        </>
      ) : view === "wrong" ? (
        <Panel title="错题记录" description={`${report.wrongQuestions.length} 道错题`}>
          {report.wrongQuestions.length > 0 && (
            <div className="p-panel-content">
              <RevisionPaperLink studentId={report.studentId} subject={subject} />
            </div>
          )}
          <div className="p-toolbar">
            <select
              aria-label="筛选错题学科"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            >
              <option value="">全部学科</option>
              {[...new Set(report.wrongQuestions.map((w) => w.question.subject))].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
          {report.wrongQuestions
            .filter((w) => !subject || w.question.subject === subject)
            .map((w) => (
              <article className="p-question" key={`${w.assessmentId}/${w.itemId}`}>
                <div className="p-question-head">
                  <span>{state.assessments.find((a) => a.id === w.assessmentId)?.name}</span>
                  <strong>
                    {w.score} / {w.maximum} 分
                  </strong>
                </div>
                <QuestionBody question={w.question} />
                <div className="p-answers">
                  <p>我的作答：{w.answer.text || "见作答图片"}</p>
                  {w.answer.images.map((url) => (
                    <a key={url} href={url} target="_blank" rel="noreferrer">
                      查看作答原图
                    </a>
                  ))}
                  <p>参考答案：{w.question.content.answers.join("；") || "见小问答案"}</p>
                  <MarkdownText text={w.feedback || "暂无文字反馈"} />
                </div>
              </article>
            ))}
          {!report.wrongQuestions.length && <Empty>当前没有错题记录，继续保持。</Empty>}
        </Panel>
      ) : (
        <Panel title="推荐练习" description="从题库中选择与薄弱知识点相关的题目。">
          {report.recommendations.length ? (
            report.recommendations.map((q) => (
              <article className="p-question" key={q.id}>
                <QuestionBody question={q} />
                <details>
                  <summary>完成练习后核对答案</summary>
                  <div className="p-answers">
                    <MarkdownText text={q.content.answers.join("；")} />
                    <MarkdownText text={q.content.explanation} />
                    {q.content.parts.map((p, i) => (
                      <p key={p.id}>
                        小问 {i + 1}：{p.answers.join("；")}
                      </p>
                    ))}
                  </div>
                </details>
              </article>
            ))
          ) : (
            <Empty>当前题库中没有匹配的巩固练习，可先回顾错题解析与老师反馈。</Empty>
          )}
        </Panel>
      )}
    </>
  );
}
