"use client";
import type {
  PracticeSessionDetail,
  PracticeSetDetail,
  PracticeAttemptDetail,
  PracticeHistory,
} from "@/contracts/practice";
import { PracticeProvider, usePractice } from "./provider";
import { PracticeFrame as Frame } from "./frame";
import { StudentPractice } from "./student";
import { TeacherPracticeReview, TeacherPracticeSet } from "./teacher";
import { PracticeSessionList } from "./session-list";
import { SourceResource } from "./sources";
import { ReviewQueueResource } from "./review-list";
import { PracticeAttemptReading } from "./feedback";
import { PracticePanel } from "./primitives";
export { PracticeEvidenceWorkspace } from "./evidence";
export function PracticeWorkspace({
  sessionId,
  source,
}: {
  sessionId?: string;
  source?: { attemptId: string; evaluationId?: string };
}) {
  return (
    <Frame
      title={source ? "练习证据来源" : sessionId ? "练习作答与反馈" : "自主练习"}
      description={
        source
          ? "查看该条证据对应的原始提交与评价记录，保留当时的参考情况和反馈来源。"
          : "独立尝试、保留作答，再核对反馈；参考曝光与评价来源清楚记录。"
      }
      back={
        sessionId
          ? source
            ? { href: `/learning/practice/${sessionId}`, label: "返回当前练习" }
            : { href: "/learning/practice", label: "返回自主练习" }
          : { href: "/learning/practice/evidence", label: "查看练习证据" }
      }
    >
      {sessionId && source ? (
        <PracticeProvider
          key={`${sessionId}/${source.attemptId}/${source.evaluationId ?? "all"}`}
          path={`/api/platform/practice/sessions/${sessionId}/history?${new URLSearchParams({ attemptId: source.attemptId, ...(source.evaluationId ? { evaluationId: source.evaluationId } : {}) })}`}
        >
          <SourceAttemptResource />
        </PracticeProvider>
      ) : sessionId ? (
        <PracticeProvider key={sessionId} path={`/api/platform/practice/sessions/${sessionId}`}>
          <SessionResource />
        </PracticeProvider>
      ) : (
        <>
          <PracticeProvider path="/api/platform/practice/sessions">
            <PracticeSessionList />
          </PracticeProvider>
          <PracticeProvider path="/api/platform/practice/sources">
            <SourceResource teacher={false} />
          </PracticeProvider>
        </>
      )}
    </Frame>
  );
}
function SourceAttemptResource() {
  const { data } = usePractice<PracticeHistory>();
  const detail = data.attempts[0];
  if (!detail)
    return (
      <p role="alert" className="p-notice error">
        未读取到该证据的来源提交，请从练习证据重新选择记录。
      </p>
    );
  return (
    <PracticePanel
      title={`证据来源 · 第 ${detail.attempt.sequence} 次提交`}
      description="这是所选证据的原始记录；当前再练草稿和其他轮次不会替代此处内容。"
    >
      <PracticeAttemptReading
        detail={detail}
        context={`证据来源第 ${detail.attempt.sequence} 次提交`}
      />
    </PracticePanel>
  );
}
function SessionResource() {
  const { data, generation } = usePractice<PracticeSessionDetail>();
  return (
    <StudentPractice
      key={`${generation}/${data.session.version}/${data.draft?.version ?? "readonly"}/${data.currentAttempt?.evaluationVersion ?? 0}`}
      detail={data}
    />
  );
}
export function PracticeTeachingWorkspace({ setId }: { setId?: string }) {
  return (
    <Frame
      title={setId ? "练习发布管理" : "自主练习发布与核验"}
      description="教师发布安全题面，核验学生明确提交的内容；练习证据与正式成绩分开。"
      back={setId ? { href: "/homework/practice", label: "返回发布与核验" } : undefined}
    >
      {setId ? (
        <PracticeProvider key={setId} path={`/api/platform/practice/sets/${setId}`}>
          <SetResource />
        </PracticeProvider>
      ) : (
        <>
          <PracticeProvider path="/api/platform/practice/sources">
            <SourceResource teacher />
          </PracticeProvider>
          <PracticeProvider path="/api/platform/practice/reviews">
            <ReviewQueueResource />
          </PracticeProvider>
        </>
      )}
    </Frame>
  );
}
function SetResource() {
  const { data, generation } = usePractice<PracticeSetDetail>();
  return <TeacherPracticeSet key={`${generation}/${data.set.version}`} detail={data} />;
}
export function PracticeReviewWorkspace({ attemptId }: { attemptId: string }) {
  return (
    <Frame
      title="练习提交核验"
      description="核对不可变作答、完整参考与反馈候选，保留人工确认及更正历史。"
      back={{ href: "/homework/practice", label: "返回核验队列" }}
    >
      <PracticeProvider key={attemptId} path={`/api/platform/practice/reviews/${attemptId}`}>
        <ReviewResource />
      </PracticeProvider>
    </Frame>
  );
}
function ReviewResource() {
  const { data, generation } = usePractice<PracticeAttemptDetail>();
  return (
    <TeacherPracticeReview
      key={`${generation}/${data.attempt.id}/${data.attempt.evaluationVersion}`}
      detail={data}
    />
  );
}
