"use client";
import Link from "next/link";
import { ArrowRight, Plus, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useDomain } from "./domain-provider";
import { Panel, Empty } from "./primitives";
import { PageHeader } from "./page-header";
import { assessmentPublicationLabel, assessmentReviewBlockReason } from "@/lib/assessment-roster";

export function HomeOverviewPage() {
  const { state } = useDomain();
  if (state.actor.role === "STUDENT") return <StudentHome />;
  const admin = state.actor.role === "ADMIN";
  const assessments = new Map(state.assessments.map((assessment) => [assessment.id, assessment]));
  const paused = state.submissions.filter((submission) => {
    const assessment = assessments.get(submission.assessmentId);
    return (
      !assessment ||
      !!assessmentReviewBlockReason(assessment, submission.studentId, submission.paperId)
    );
  });
  const pausedIds = new Set(paused.map((submission) => submission.id));
  const pending = state.submissions.filter(
    (submission) =>
      submission.status !== "GRADED" &&
      !pausedIds.has(submission.id) &&
      !assessments.get(submission.assessmentId)?.published &&
      state.reviewAssignments?.some(
        (assignment) =>
          assignment.submissionId === submission.id &&
          assignment.availableRounds.some((round) => round.reason === null),
      ),
  );
  const unconfirmed = state.assessments.filter(
    (assessment) => assessment.rosterStatus !== "CONFIRMED",
  );
  const pendingCount = (kind: "EXAM" | "HOMEWORK") =>
    pending.filter((submission) => assessments.get(submission.assessmentId)?.kind === kind).length;
  return (
    <>
      <PageHeader
        title={admin ? "系统概览" : "教学概览"}
        description={
          admin
            ? "查看平台资源、教学活动与账号情况，跟进当前系统工作。"
            : "跟进班级学习情况与最近考试，从这里开始今天的教学工作。"
        }
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/homework/new">
                <Plus />
                创建作业
              </Link>
            </Button>
            <Button asChild>
              <Link href="/exams/papers/new">
                <Plus />
                创建试卷
              </Link>
            </Button>
          </>
        }
      />
      <div className="p-summary-strip">
        <div>
          <small>{admin ? "平台账号" : "班级学生"}</small>
          <strong>
            {admin
              ? (state.usersTotal ?? state.users.length)
              : state.classrooms.reduce((n, c) => n + c.students.length, 0)}
          </strong>
        </div>
        <div>
          <small>正在进行</small>
          <strong>
            {state.assessments.filter((a) => !a.published && a.rosterStatus === "CONFIRMED").length}{" "}
            场
          </strong>
          {unconfirmed.length > 0 && <small>另有 {unconfirmed.length} 场名单待确认</small>}
        </div>
        <div>
          <small>待完成评阅</small>
          <strong>{pending.length} 份</strong>
          {paused.length > 0 && <small>{paused.length} 份暂停评阅记录保留</small>}
        </div>
        <div>
          <small>题库资源</small>
          <strong>{state.questionCount ?? state.questions.length} 题</strong>
        </div>
      </div>
      <div className="p-detail-grid">
        <div>
          <Panel
            title="最近考试与作业"
            actions={
              <Button asChild variant="ghost" size="sm">
                <Link href="/workspace/activity">
                  全部记录
                  <ArrowRight />
                </Link>
              </Button>
            }
          >
            {state.assessments.length ? (
              state.assessments.slice(0, 6).map((a) => (
                <div className="p-list-row" key={a.id}>
                  <div>
                    <Link
                      href={`${a.kind === "EXAM" ? "/exams" : "/homework/assignments"}/${a.id}`}
                    >
                      <strong>{a.name}</strong>
                    </Link>
                    <small>
                      {a.kind === "EXAM" ? "考试" : "作业"} ·{" "}
                      {a.papers.map((p) => p.subject).join("、")} · {a.classroomIds.length} 个班级
                    </small>
                  </div>
                  <Badge variant="secondary">{assessmentPublicationLabel(a)}</Badge>
                </div>
              ))
            ) : (
              <Empty>创建试卷或作业并布置给班级后，在这里跟进进度。</Empty>
            )}
          </Panel>
          <Panel
            title="班级学习情况"
            description="统计已完成评分的成绩，未完成的答卷不会记作零分。"
          >
            {state.analytics.classrooms.length ? (
              <div className="p-table" role="region" aria-label="班级学情" tabIndex={0}>
                <table>
                  <thead>
                    <tr>
                      <th>班级</th>
                      <th>完成学生</th>
                      <th>平均分</th>
                      <th>下一步</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.analytics.classrooms.map((c) => (
                      <tr key={c.id}>
                        <td>{state.classrooms.find((x) => x.id === c.id)?.name}</td>
                        <td>{c.participantCount} 人</td>
                        <td>{c.average ?? "待统计"}</td>
                        <td>
                          <Link href={`/workspace/classes/${c.id}/reports`}>查看班级报告</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>完成一次考试或作业评分后生成班级学习情况。</Empty>
            )}
          </Panel>
        </div>
        <div>
          <Panel title="快捷动作">
            <div className="p-task-links">
              <Link href="/questions/import">
                <div>
                  导入试题<small>从试卷图片建立题库</small>
                </div>
                <ArrowRight size={16} />
              </Link>
              <Link href="/exams/scanning">
                <div>
                  扫描答题卡<small>录入学生作答</small>
                </div>
                <ScanLine size={16} />
              </Link>
              <Link href="/exams/grading">
                <div>
                  继续阅卷
                  <small>{pendingCount("EXAM")} 份考试答卷待处理</small>
                </div>
                <ArrowRight size={16} />
              </Link>
              <Link href="/homework/grading">
                <div>
                  批改作业<small>{pendingCount("HOMEWORK")} 份作业答卷待处理</small>
                </div>
                <ArrowRight size={16} />
              </Link>
              <Link href="/workspace/classes">
                <div>
                  管理班级<small>维护届别与学生名单</small>
                </div>
                <ArrowRight size={16} />
              </Link>
            </div>
          </Panel>
          {admin && (
            <Panel title="账号角色分布">
              {(["ADMIN", "TEACHER", "STUDENT"] as const).map((role) => (
                <div key={role} className="p-list-row">
                  <span>{{ ADMIN: "管理员", TEACHER: "教师", STUDENT: "学生" }[role]}</span>
                  <strong>
                    {role === "STUDENT"
                      ? // Student accounts load on demand; derive their count from the total.
                        (state.usersTotal ?? state.users.length) -
                        state.users.filter((u) => u.role !== "STUDENT").length
                      : state.users.filter((u) => u.role === role).length}{" "}
                    人
                  </strong>
                </div>
              ))}
              <div className="p-panel-content">
                <Button asChild variant="outline">
                  <Link href="/admin/users">管理账号权限</Link>
                </Button>
              </div>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}

function StudentHome() {
  const { state } = useDomain();
  const results = state.analytics.results.filter((r) =>
    state.assessments.some(
      (a) => a.id === r.assessmentId && a.published && a.rosterStatus === "CONFIRMED",
    ),
  );
  const report = state.analytics.students[0];
  return (
    <>
      <PageHeader
        title="学习概览"
        description={`${state.actor.name}，从最近成绩和学习报告中找到下一步练习的方向。`}
        actions={
          <Button asChild>
            <Link href="/learning/reports">
              查看学习报告
              <ArrowRight />
            </Link>
          </Button>
        }
      />
      <Panel title="最近成绩" description="这里只显示已发布的本人考试与作业成绩。">
        {results.length ? (
          results.slice(0, 5).map((r) => (
            <div className="p-list-row" key={`${r.assessmentId}/${r.studentId}`}>
              <div>
                <Link href={`/learning/results/${r.assessmentId}`}>
                  {state.assessments.find((a) => a.id === r.assessmentId)?.name}
                </Link>
                <small>
                  {r.subjects
                    .map(
                      (s) =>
                        `${s.subject} ${s.participationStatus === "REQUIRED" ? (s.score ?? "待评分") : { ABSENT: "缺考", EXEMPT: "免考", WITHDRAWN: "退出" }[s.participationStatus]}`,
                    )
                    .join(" · ")}
                </small>
              </div>
              <strong>
                {r.total !== null
                  ? `${r.total} 分`
                  : r.subjects.some((s) => s.participationStatus !== "REQUIRED")
                    ? "不计总分"
                    : "总分暂不可用"}
              </strong>
            </div>
          ))
        ) : (
          <Empty>老师发布成绩后，你可以在这里查看成绩和学习反馈。</Empty>
        )}
      </Panel>
      <div className="p-detail-grid">
        <Panel title="需要巩固的知识点">
          {report?.knowledge.length ? (
            [...report.knowledge]
              .sort((a, b) => a.accuracy - b.accuracy)
              .slice(0, 6)
              .map((k) => (
                <div className="p-chart-row" key={k.tag}>
                  <span>{k.tag}</span>
                  <div className="p-chart-track">
                    <span style={{ width: `${k.accuracy * 100}%` }} />
                  </div>
                  <span>{Math.round(k.accuracy * 100)}%</span>
                </div>
              ))
          ) : (
            <Empty>完成考试后生成知识点掌握情况。</Empty>
          )}
        </Panel>
        <Panel title="练习与反馈">
          <div className="p-task-links">
            <Link href="/learning/wrong-questions">
              <div>
                回顾错题<small>{report?.wrongQuestions.length ?? 0} 道题可复习</small>
              </div>
              <ArrowRight size={16} />
            </Link>
            <Link href="/learning/practice">
              <div>
                巩固练习<small>根据学习情况选择相近题目</small>
              </div>
              <ArrowRight size={16} />
            </Link>
          </div>
        </Panel>
      </div>
    </>
  );
}

export function ActivityPage() {
  const { state } = useDomain();
  return (
    <>
      <PageHeader
        title="最近工作"
        description="查看最近更新的教学内容和考试安排，继续尚未完成的工作。"
      />
      <Panel title="最近更新的试卷与作业">
        {state.papers.length ? (
          state.papers.slice(0, 20).map((p) => (
            <div className="p-list-row" key={p.id}>
              <div>
                <Link href={`${p.kind === "EXAM" ? "/exams/papers" : "/homework"}/${p.id}`}>
                  {p.name}
                </Link>
                <small>
                  {p.subject} · {p.items.length} 道题 ·{" "}
                  {new Date(p.updatedAt).toLocaleString("zh-CN")}
                </small>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href={`${p.kind === "EXAM" ? "/exams/papers" : "/homework"}/${p.id}/edit`}>
                  继续编辑
                </Link>
              </Button>
            </div>
          ))
        ) : (
          <Empty>创建试卷或作业后，在这里查看最近的工作。</Empty>
        )}
      </Panel>
    </>
  );
}
