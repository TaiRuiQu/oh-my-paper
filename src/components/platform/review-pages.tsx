"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useDomain } from "./domain-provider";
import { Panel, Empty } from "./primitives";
import { MissingRecord, PageHeader } from "./page-header";
import { SubmissionReview, type LocalReviewDraft } from "./reviews";
import { useUnsavedChanges } from "./use-unsaved-changes";
import { LocalReviewDrafts } from "./local-review-drafts";
import { ApiRequestError } from "@/lib/http-client";
import type { PlatformState } from "@/contracts/platform";
import { Scans } from "./scans";
import { PlatformAI } from "./ai";
import { SubmissionScanDetails } from "./submission-scan-details";
import { submissionNeedsScanReview } from "@/lib/scan-recognition";
import {
  assessmentReviewBlockReason,
  findAssessmentParticipant,
  participantSubject,
} from "@/lib/assessment-roster";

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
  const participationBlock = (submission: (typeof state.submissions)[number]) => {
    const assessment = state.assessments.find((entry) => entry.id === submission.assessmentId);
    return assessment
      ? assessmentReviewBlockReason(assessment, submission.studentId, submission.paperId)
      : "本次安排不可用";
  };
  // Blind double-review rounds keep their grade status in the projected analytics
  // (only the scores are withheld), so arbitration work is discoverable without
  // revealing any first/second mark.
  const hasArbitration = (submission: (typeof state.submissions)[number]) =>
    state.analytics.results.some(
      (r) =>
        r.assessmentId === submission.assessmentId &&
        r.studentId === submission.studentId &&
        r.subjects.some(
          (p) =>
            p.paperId === submission.paperId && p.grades.some((g) => g.status === "ARBITRATION"),
        ),
    );
  const arbitrationPending = state.analytics.results.some((r) =>
    r.subjects.some((p) => p.grades.some((g) => g.status === "ARBITRATION")),
  );
  const queue = state.submissions.filter(
    (s) =>
      (!filter || s.assessmentId === filter) &&
      (!status ||
        (status === "SCAN_REVIEW"
          ? submissionNeedsScanReview(s)
          : status === "PAUSED"
            ? !!participationBlock(s)
            : !participationBlock(s) && s.status === status)) &&
      (!arbitration || hasArbitration(s)),
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
            <option value="REVIEW">评阅中</option>
            <option value="GRADED">已完成</option>
            <option value="SCAN_REVIEW">扫描需核对</option>
            <option value="PAUSED">暂停评阅的保留记录</option>
          </select>
          {!submissions && !arbitration && arbitrationPending && (
            <Button asChild variant="outline" size="sm">
              <Link href={`${base}/grading/arbitration`}>待仲裁评阅</Link>
            </Button>
          )}
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
                  const assessment = state.assessments.find((a) => a.id === s.assessmentId);
                  const student = assessment
                    ? findAssessmentParticipant(assessment, s.studentId)
                    : undefined;
                  const block = assessment
                    ? assessmentReviewBlockReason(assessment, s.studentId, s.paperId)
                    : "安排不可用";
                  const participation = assessment
                    ? participantSubject(assessment, s.studentId, s.paperId)
                    : undefined;
                  const result = state.analytics.results
                    .find((r) => r.studentId === s.studentId && r.assessmentId === s.assessmentId)
                    ?.subjects.find((p) => p.paperId === s.paperId);
                  return (
                    <tr key={s.id}>
                      <td>
                        <strong>{student?.name ?? "待匹配"}</strong>
                        <small>
                          {student?.classroomName} · {student?.studentNumber}
                        </small>
                      </td>
                      <td>{state.assessments.find((a) => a.id === s.assessmentId)?.name}</td>
                      <td>{state.papers.find((p) => p.id === s.paperId)?.subject}</td>
                      <td>
                        {block ? (
                          "原答卷与评分保留"
                        ) : (
                          <>
                            {result?.grades.filter((g) => g.status === "FINAL").length ?? 0} /{" "}
                            {result?.grades.length ?? 0} 题
                          </>
                        )}
                      </td>
                      <td>
                        <Badge variant="secondary">
                          {block
                            ? participation && participation.status !== "REQUIRED"
                              ? { ABSENT: "缺考", EXEMPT: "免考", WITHDRAWN: "退出" }[
                                  participation.status
                                ]
                              : "名单待核对"
                            : { PENDING: "待评阅", REVIEW: "评阅中", GRADED: "已完成" }[s.status]}
                        </Badge>
                        {hasArbitration(s) && <Badge variant="secondary">待仲裁</Badge>}
                        {submissionNeedsScanReview(s) && (
                          <Badge variant="secondary">扫描需核对</Badge>
                        )}
                      </td>
                      <td>
                        <Button asChild variant="outline" size="sm">
                          <Link href={`${base}/grading/${s.id}`}>
                            {submissions || block ? "查看作答" : "进入评阅"}
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
  return <SubmissionReviewDetail key={id} id={id} />;
}
function SubmissionReviewDetail({ id }: { id: string }) {
  const { state, area, mutate, pending, refresh } = useDomain();
  const historical =
    state.requestedReview?.submission.id === id ? state.requestedReview : undefined;
  const submission = state.submissions.find((s) => s.id === id) ?? historical?.submission;
  const [accessDenied, setAccessDenied] = useState(false);
  const [deniedState, setDeniedState] = useState<PlatformState | null>(null);
  const visibleSubmission = accessDenied ? undefined : submission;
  const [drafts, setDrafts] = useState<Record<string, LocalReviewDraft>>({});
  const [detached, setDetached] = useState<LocalReviewDraft[]>([]);
  const [wasAvailable, setWasAvailable] = useState(!!submission);
  if (wasAvailable !== !!submission) {
    setWasAvailable(!!submission);
    if (!submission) {
      // Preserve only already extracted local deltas in a separate archive. A
      // later clean form must not erase them when permission returns.
      setDetached((previous) => [...previous, ...Object.values(drafts)]);
      setDrafts({});
    }
  }
  // The denial lock may only be lifted by a state produced after the denial:
  // the stale state object the server rejected against must never count as
  // re-authorization, or denied content would revive from cache.
  if (accessDenied && deniedState !== state) {
    setAccessDenied(false);
    setDeniedState(null);
  }
  const [readError, setReadError] = useState(""),
    [reading, setReading] = useState(false);
  const readLock = useRef(false);
  const recordDraft = useCallback((key: string, draft: LocalReviewDraft | null) => {
    setDrafts((previous) => {
      const next = { ...previous };
      if (draft) next[key] = draft;
      else delete next[key];
      return next;
    });
  }, []);
  const { confirmDiscard } = useUnsavedChanges(
    detached.length > 0 || (!visibleSubmission && Object.keys(drafts).length > 0),
    "有未提交的本人评分输入，离开后会丢失。确定离开？",
  );
  const readCurrent = useCallback(async () => {
    try {
      await refresh(id);
      setAccessDenied(false);
      setDeniedState(null);
    } catch (cause) {
      if (cause instanceof ApiRequestError && [401, 403, 404].includes(cause.status)) {
        setDetached((previous) => [...previous, ...Object.values(drafts)]);
        setDrafts({});
        setDeniedState(state);
        setAccessDenied(true);
      }
      throw cause;
    }
  }, [refresh, id, drafts, state]);
  const initialRead = useRef(visibleSubmission ? null : readCurrent);
  // Explicit detail URLs can refer to an authorized older submission absent from
  // the active queue. Read it once; never revive cached server content on denial.
  useEffect(() => {
    if (!initialRead.current) return;
    const controller = new AbortController();
    void initialRead.current().catch((cause) => {
      if (!controller.signal.aborted)
        setReadError(cause instanceof Error ? cause.message : "当前答卷读取失败。");
    });
    return () => controller.abort();
  }, []);
  const homework = area === "homework";
  const base = homework ? "/homework" : "/exams";
  const localInputs = (
    <LocalReviewDrafts
      drafts={detached}
      onDiscard={() => {
        if (confirmDiscard()) setDetached([]);
      }}
    />
  );
  if (!visibleSubmission)
    return (
      <>
        <PageHeader
          title="答卷当前不可评阅"
          description="这份答卷未在当前授权范围内返回；可能已退回、被新提交替代，或当前权限已变化。系统不会从旧缓存恢复题面、作答或服务端评分。"
          back={{ href: `${base}/grading`, label: "返回评阅队列" }}
        />
        {readError && (
          <p role="alert" className="p-notice error">
            {readError}
          </p>
        )}
        <button
          type="button"
          className="button secondary"
          disabled={reading || pending}
          onClick={async () => {
            if (readLock.current) return;
            readLock.current = true;
            setReading(true);
            try {
              await readCurrent();
              setReadError("");
            } catch (cause) {
              setReadError(cause instanceof Error ? cause.message : "读取失败，本人输入仍保留。");
            } finally {
              readLock.current = false;
              setReading(false);
            }
          }}
        >
          重新读取当前答卷权限
        </button>
        {localInputs}
      </>
    );
  const assessment = state.assessments.find((a) => a.id === visibleSubmission.assessmentId);
  const student = assessment
    ? findAssessmentParticipant(assessment, visibleSubmission.studentId)
    : undefined;
  const block = assessment
    ? assessmentReviewBlockReason(
        assessment,
        visibleSubmission.studentId,
        visibleSubmission.paperId,
      )
    : "本次安排不可用";
  const retiredReason = historical ? "这份作答已退回或被新提交替代，旧提交仅供查看。" : undefined;
  const reviewState = historical
    ? {
        ...state,
        reviews: historical.reviews,
        reviewHistory: historical.reviewHistory,
        reviewAssignments: historical.reviewAssignments,
        analytics: { ...state.analytics, results: [] },
      }
    : state;
  return (
    <>
      <PageHeader
        title={`${student?.name ?? "学生"} · ${block ? "作答记录" : homework ? "作业批改" : "答卷评阅"}`}
        description={`${assessment?.name} · ${state.papers.find((p) => p.id === visibleSubmission.paperId)?.subject} · ${student?.studentNumber ?? ""}`}
        back={{ href: `${base}/grading`, label: homework ? "批改队列" : "阅卷队列" }}
        actions={
          <Button asChild variant="outline">
            <Link
              href={`${homework ? "/homework/assignments" : "/exams"}/${visibleSubmission.assessmentId}/reports`}
            >
              查看本次报告
            </Link>
          </Button>
        }
      />
      {localInputs}
      {assessment?.published && (
        <p className="p-notice">成绩已发布。请先在发布页面撤回，再调整评分。</p>
      )}
      {retiredReason && (
        <p className="p-notice" role="status">
          {retiredReason} 本地评分草稿须明确放弃，不会自动用于新提交。
          {homework && (
            <Link href={`/homework/assignments/${visibleSubmission.assessmentId}/collection`}>
              查看收交与提交历史
            </Link>
          )}{" "}
          <Link href={`${base}/grading`}>查看当前评阅队列</Link>
        </p>
      )}
      {block && (
        <p className="p-notice" role="status">
          {block}
          {assessment && (
            <Link href={`${homework ? "/homework/assignments" : "/exams"}/${assessment.id}/roster`}>
              查看本次参与名单
            </Link>
          )}
        </p>
      )}
      <SubmissionScanDetails submission={visibleSubmission} />
      <section id="question-review" aria-label="逐题评阅">
        <Panel
          title="逐题评阅"
          description={
            block
              ? "保留原始作答与评阅记录；当前参与状态不接收新的评分。"
              : "评分保存后会更新进度。双评必须由不同教师完成，分差超阈值后由第三位教师仲裁。"
          }
        >
          <SubmissionReview
            submission={visibleSubmission}
            state={reviewState}
            mutate={mutate}
            pending={pending}
            refresh={readCurrent}
            readOnlyReason={retiredReason}
            onLocalDraft={recordDraft}
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
          <small>识别异常答卷</small>
          <strong>{state.submissions.filter(submissionNeedsScanReview).length} 份</strong>
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
