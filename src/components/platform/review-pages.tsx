"use client";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useDomain } from "./domain-provider";
import { Panel, Empty } from "./primitives";
import { MissingRecord, PageHeader } from "./page-header";
import { SubmissionReview } from "./reviews";
import { Scans } from "./scans";
import { PlatformAI } from "./ai";
import { SubmissionScanDetails } from "./submission-scan-details";

export function ReviewQueuePage({
  assessmentId,
  submissions = false,
  arbitration = false,
}: {
  assessmentId?: string;
  submissions?: boolean;
  arbitration?: boolean;
}) {
  const { state, area } = useDomain();
  const homework = area === "homework";
  const base = homework ? "/homework" : "/exams";
  const [filter, setFilter] = useState(assessmentId ?? "");
  const [status, setStatus] = useState("");
  const selected = state.assessments.find((a) => a.id === assessmentId);
  if (assessmentId && !selected) return <MissingRecord back={base} />;
  const queue = state.submissions.filter(
    (s) =>
      (!filter || s.assessmentId === filter) &&
      (!status || s.status === status) &&
      (!arbitration ||
        state.analytics.results.some(
          (r) =>
            r.assessmentId === s.assessmentId &&
            r.studentId === s.studentId &&
            r.subjects.some(
              (p) => p.paperId === s.paperId && p.grades.some((g) => g.status === "ARBITRATION"),
            ),
        )),
  );
  return (
    <>
      <PageHeader
        title={
          submissions ? "学生作答" : arbitration ? "仲裁评阅" : homework ? "作业批改" : "阅卷中心"
        }
        description={
          submissions
            ? "核对已录入的学生作答，并进入对应答卷查看原图与评分。"
            : arbitration
              ? "处理双评分差超出阈值的题目，由独立第三位教师完成仲裁。"
              : "年级联考按任教学科跨班阅卷；班级考试与作业由本班任课老师评阅。所有阅卷老师均可参与双评。"
        }
        back={
          selected
            ? {
                href: `${homework ? "/homework/assignments" : "/exams"}/${assessmentId}`,
                label: selected.name,
              }
            : undefined
        }
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={`${base}/grading/ai`}>AI 辅助{homework ? "批改" : "阅卷"}</Link>
            </Button>
            <Button asChild>
              <Link
                href={`${homework ? "/homework/submissions/new" : "/exams/scanning/upload"}${assessmentId ? `?assessmentId=${assessmentId}` : ""}`}
              >
                录入学生作答
              </Link>
            </Button>
          </>
        }
      />
      <Panel title={submissions ? "作答记录" : "评阅队列"}>
        <div className="p-toolbar">
          <select
            aria-label="筛选考试或作业"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="">全部{homework ? "作业" : "考试"}</option>
            {state.assessments.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <select
            aria-label="筛选评阅状态"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">全部状态</option>
            <option value="PENDING">待评阅</option>
            <option value="REVIEW">待复核</option>
            <option value="GRADED">已完成</option>
          </select>
        </div>
        {queue.length ? (
          <div className="p-table" role="region" aria-label="评阅答卷列表" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th>学生 / 班级</th>
                  <th>{homework ? "作业" : "考试"}</th>
                  <th>学科</th>
                  <th>评阅进度</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {queue.map((s) => {
                  const student = state.classrooms
                    .flatMap((c) => c.students)
                    .find((st) => st.id === s.studentId);
                  const result = state.analytics.results
                    .find((r) => r.studentId === s.studentId && r.assessmentId === s.assessmentId)
                    ?.subjects.find((p) => p.paperId === s.paperId);
                  return (
                    <tr key={s.id}>
                      <td>
                        <strong>{student?.name ?? "待匹配"}</strong>
                        <small>
                          {state.classrooms.find((c) => c.id === student?.classroomId)?.name} ·{" "}
                          {student?.studentNumber}
                        </small>
                      </td>
                      <td>{state.assessments.find((a) => a.id === s.assessmentId)?.name}</td>
                      <td>{state.papers.find((p) => p.id === s.paperId)?.subject}</td>
                      <td>
                        {result?.grades.filter((g) => g.status === "FINAL").length ?? 0} /{" "}
                        {result?.grades.length ?? 0} 题
                      </td>
                      <td>
                        <Badge variant="secondary">
                          {{ PENDING: "待评阅", REVIEW: "待复核", GRADED: "已完成" }[s.status]}
                        </Badge>
                      </td>
                      <td>
                        <Button asChild variant="outline" size="sm">
                          <Link href={`${base}/grading/${s.id}`}>
                            {submissions ? "查看作答" : "进入评阅"}
                          </Link>
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>
            {arbitration
              ? "当前没有需要第三评仲裁的题目。"
              : "没有符合条件的学生作答。完成录入后即可开始评阅。"}
          </Empty>
        )}
      </Panel>
    </>
  );
}

export function SubmissionReviewPage({ id }: { id: string }) {
  const { state, area, mutate, pending } = useDomain();
  const submission = state.submissions.find((s) => s.id === id);
  const homework = area === "homework";
  const base = homework ? "/homework" : "/exams";
  if (!submission) return <MissingRecord back={`${base}/grading`} />;
  const student = state.classrooms
    .flatMap((c) => c.students)
    .find((s) => s.id === submission.studentId);
  const assessment = state.assessments.find((a) => a.id === submission.assessmentId);
  return (
    <>
      <PageHeader
        title={`${student?.name ?? "学生"} · ${homework ? "作业批改" : "答卷评阅"}`}
        description={`${assessment?.name} · ${state.papers.find((p) => p.id === submission.paperId)?.subject} · ${student?.studentNumber ?? ""}`}
        back={{ href: `${base}/grading`, label: homework ? "批改队列" : "阅卷队列" }}
        actions={
          <Button asChild variant="outline">
            <Link
              href={`${homework ? "/homework/assignments" : "/exams"}/${submission.assessmentId}/reports`}
            >
              查看本次报告
            </Link>
          </Button>
        }
      />
      {assessment?.published && (
        <p className="p-notice">成绩已发布。请先在发布页面撤回，再调整评分。</p>
      )}
      <SubmissionScanDetails submission={submission} />
      <section id="question-review" aria-label="逐题评阅">
        <Panel
          title="逐题评阅"
          description="评分保存后会更新进度。双评必须由不同教师完成，分差超阈值后由第三位教师仲裁。"
        >
          <SubmissionReview
            submission={submission}
            state={state}
            mutate={mutate}
            pending={pending}
          />
        </Panel>
      </section>
    </>
  );
}

export function ScanPage({
  section = "upload",
  assessmentId,
}: {
  section?: "upload" | "device" | "history";
  assessmentId?: string;
}) {
  const { state, area, refresh, notify } = useDomain();
  const homework = area === "homework";
  return (
    <>
      <PageHeader
        title={
          section === "device"
            ? "扫描仪连接"
            : section === "history"
              ? "扫描记录"
              : homework
                ? "录入练习册作答"
                : "扫描答题卡"
        }
        description={
          section === "device"
            ? "连接本机扫描仪并采集图像，完成后可在录入页面上传。"
            : homework
              ? "选择学生与练习册，在原图中框选每题作答范围，保存为可批改的记录。"
              : "选择考试和保存的同版式答题卡，批量上传并按学生与题目识别作答。"
        }
        back={{
          href: homework ? "/homework/submissions" : "/exams/scanning",
          label: homework ? "作业作答记录" : "扫描中心",
        }}
      />
      <Scans
        key={`${area}/${assessmentId ?? ""}/${section}`}
        state={state}
        refresh={refresh}
        notify={notify}
        fixedKind={homework ? "WORKBOOK" : "CARD"}
        initialAssessmentId={assessmentId}
        section={section}
      />
    </>
  );
}

export function ScanningOverviewPage() {
  const { state } = useDomain();
  return (
    <>
      <PageHeader
        title="答题卡扫描中心"
        description="按考试录入纸质答题卡，完成卡号识别与逐题切图，再进入阅卷。"
        actions={
          <Button asChild>
            <Link href="/exams/scanning/upload">上传答题卡</Link>
          </Button>
        }
      />
      <div className="p-summary-strip">
        <div>
          <small>已录入答卷</small>
          <strong>{state.submissions.length} 份</strong>
        </div>
        <div>
          <small>需复核扫描</small>
          <strong>{state.submissions.filter((s) => s.status === "REVIEW").length} 份</strong>
        </div>
        <div>
          <small>可用答题卡</small>
          <strong>{state.templates.filter((t) => !t.preset).length} 份</strong>
        </div>
      </div>
      <Panel title="扫描操作">
        <div className="p-task-links">
          <Link href="/exams/scanning/upload">
            <div>
              上传扫描图像<small>识别卡号并逐题切图</small>
            </div>
            <span>进入</span>
          </Link>
          <Link href="/exams/scanning/device">
            <div>
              连接扫描仪<small>设置采集设备、分辨率与进纸方式</small>
            </div>
            <span>进入</span>
          </Link>
          <Link href="/exams/scanning/history">
            <div>
              查看扫描记录<small>核对学生、试卷和扫描状态</small>
            </div>
            <span>进入</span>
          </Link>
          <Link href="/exams/cards">
            <div>
              管理答题卡版式<small>使用与纸质答题卡一致的模板</small>
            </div>
            <span>进入</span>
          </Link>
        </div>
      </Panel>
    </>
  );
}

export function AIPage({ mode }: { mode: "papers" | "reviews" | "overview" | "analytics" }) {
  const { state, area, refresh, notify } = useDomain();
  return (
    <>
      <PageHeader
        title={
          mode === "papers"
            ? "AI 辅助组卷"
            : mode === "reviews"
              ? area === "homework"
                ? "AI 作业批改"
                : "AI 辅助阅卷"
              : mode === "analytics"
                ? "巩固练习推荐"
                : "AI 任务记录"
        }
        description="提交任务后可离开页面，任务会在后台继续。完成后核对结果，再进行下一步教学操作。"
      />
      <PlatformAI
        state={state}
        tab={mode}
        fixedKind={area === "homework" ? "HOMEWORK" : "EXAM"}
        refresh={refresh}
        notify={notify}
      />
    </>
  );
}
