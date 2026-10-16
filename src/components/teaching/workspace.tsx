"use client";
import Link from "next/link";
import { useState } from "react";
import type { TeachingSession, TeachingSessions } from "@/contracts/teaching";
import { PageHeader } from "@/components/platform/page-header";
import { Empty } from "@/components/platform/primitives";
import { TeachingProvider, useTeaching } from "./provider";
import { TeachingPanel } from "./panel";
import { TeachingList } from "./list";
import { PlanEditor, PlanReading } from "./plan";
import { RosterEditor } from "./roster";
import { AttendanceEditor, AttendanceReading } from "./attendance";
import { RecordEditor, ScheduleComparison, sessionLabels, TeachingHistoryView } from "./records";
import { TeachingActionForm } from "./action-form";
import { AiPreparation } from "./ai-preparation";
import styles from "./teaching.module.css";

export function TeachingWorkspace({
  initialList,
  initialSession,
  section,
}: {
  initialList?: TeachingSessions;
  initialSession?: TeachingSession;
  section: "list" | "session";
}) {
  return (
    <TeachingProvider
      key={initialSession?.id ?? "list"}
      initialList={initialList}
      initialSession={initialSession}
    >
      <div className={styles.workspace}>
        {section === "list" ? <TeachingList /> : <SessionWorkspace />}
      </div>
    </TeachingProvider>
  );
}
type Editor = {
  kind:
    | "plan"
    | "roster"
    | "attendance"
    | "attendanceCorrect"
    | "finish"
    | "correct"
    | "interrupt"
    | "resume"
    | "cancel"
    | "rebind";
  session: TeachingSession;
};
function SessionWorkspace() {
  const { session, pending, stale, refresh } = useTeaching();
  const [editor, setEditor] = useState<Editor | null>(null),
    [error, setError] = useState(""),
    [aiOpen, setAiOpen] = useState(false);
  if (!session)
    return (
      <TeachingPanel title="课堂记录">
        <Empty>暂时无法读取课堂记录，请返回教学安排重新选择。</Empty>
        <Link href="/school/teaching">返回教学安排</Link>
      </TeachingPanel>
    );
  const active = session.binding.lessons.filter((lesson) => lesson.status === "SCHEDULED");
  const lesson = active[0] ?? session.binding.lessons[0];
  const disabled = pending || stale || !!editor;
  const close = () => setEditor(null);
  const edit = (kind: Editor["kind"]) => setEditor({ kind, session: structuredClone(session) });
  const date = (value: string | null) =>
    value
      ? new Intl.DateTimeFormat("zh-CN", {
          timeZone: session.binding.timezone,
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(value))
      : "尚未记录";
  return (
    <>
      <PageHeader
        title={lesson ? `${lesson.courseName} · ${lesson.classroomName}` : "课堂教学"}
        description={`稳定课堂记录 · ${sessionLabels[session.status]} · ${session.binding.timezone}`}
        back={{ href: "/school/teaching", label: "全部教学安排" }}
        actions={
          <button
            type="button"
            className="button secondary"
            disabled={pending}
            onClick={async () => {
              if (editor && !window.confirm("重新读取会放弃当前未保存的教学修改。确定重新读取？"))
                return;
              try {
                await refresh();
                setEditor(null);
                setError("");
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : "读取失败，当前草稿已保留。");
              }
            }}
          >
            重新读取本次课堂
          </button>
        }
      />
      {error && (
        <p className="p-notice error" role="alert">
          {error}
        </p>
      )}
      <div className={styles.metadata}>
        <span>记录 v{session.version}</span>
        <span>
          安排绑定 v{session.bindingVersion} / 课表发布 v{session.binding.publicationRevision}
        </span>
        <span>授课教师：{lesson?.teacherName ?? "待核对"}</span>
        {active.map((entry) => (
          <span key={entry.id}>
            {entry.date} {entry.startTime}–{entry.endTime} · {entry.roomName ?? "未指定教室"}
          </span>
        ))}
      </div>
      {!!session.blockReasons.length && (
        <div className="p-notice">
          <strong>当前课堂待办</strong>
          <ul>
            {session.blockReasons.map((reason, index) => (
              <li key={index}>{reason}</li>
            ))}
          </ul>
        </div>
      )}
      <nav className={styles.navigation} aria-label="本次课堂内容">
        <a href="#teaching-plan">备课与教案</a>
        <a href="#teaching-roster">名单与点名</a>
        <a href="#teaching-record">授课记录</a>
        <a href="#teaching-history">版本历史</a>
      </nav>
      {session.scheduleChanged && (
        <TeachingPanel
          title="课程安排发生变化"
          description="当前记录仍关联原发布版本，请核对最新安排。已有授课历史不会被课表修改覆盖。"
        >
          {editor?.kind !== "rebind" && <ScheduleComparison session={session} />}
          {editor?.kind === "rebind" ? (
            <RecordEditor session={editor.session} mode="rebind" close={close} />
          ) : session.canRebind && session.currentSchedule ? (
            <button
              type="button"
              className="button secondary"
              disabled={disabled}
              onClick={() => edit("rebind")}
            >
              核对并接受最新安排
            </button>
          ) : (
            <p>
              当前课堂不能直接更换安排，请联系教务管理人员核对；已开始或完成的记录保留当时安排。
            </p>
          )}
        </TeachingPanel>
      )}
      <section id="teaching-plan">
        <TeachingPanel
          title="备课与教案"
          description="人工编写或由 AI 辅助生成草稿，核对后明确确认。开课使用已确认版本。"
          actions={
            <button
              type="button"
              className="button secondary"
              disabled={disabled || !session.canPrepare}
              onClick={() => edit("plan")}
            >
              {session.plan ? "编辑教案草稿" : "编写教案"}
            </button>
          }
        >
          <p>
            当前草稿 v{session.planVersion} · 已确认{" "}
            {session.confirmedPlanVersion === null ? "无" : `v${session.confirmedPlanVersion}`}
            {session.plan?.source === "AI" ? " · AI 草稿，请人工核对" : ""}
          </p>
          {editor?.kind === "plan" ? (
            <PlanEditor session={editor.session} close={close} />
          ) : session.plan ? (
            <>
              <PlanReading plan={session.plan.plan} />
              {session.canPrepare && session.confirmedPlanVersion !== session.planVersion && (
                <TeachingActionForm
                  allowed={!disabled}
                  submitLabel={`确认教案 v${session.planVersion}`}
                  command={() => ({
                    type: "teaching.plan.confirm",
                    sessionId: session.id,
                    expectedVersion: session.version,
                    planVersion: session.planVersion,
                  })}
                >
                  <p className={styles.help}>
                    请先阅读目标、活动与材料。确认后仍保留历史；继续修改需再次确认新草稿。
                  </p>
                </TeachingActionForm>
              )}
            </>
          ) : (
            <Empty>尚未编写教案。可直接人工备课，无需先使用 AI。</Empty>
          )}
          {(session.canPrepare || aiOpen) && (
            <details
              className={styles.section}
              onToggle={(event) => {
                if (event.currentTarget.open) setAiOpen(true);
              }}
            >
              <summary>AI 辅助备课（选用）</summary>
              {aiOpen && (
                <AiPreparation session={session} disabled={disabled || session.scheduleChanged} />
              )}
            </details>
          )}
        </TeachingPanel>
      </section>
      <section id="teaching-roster">
        <TeachingPanel
          title="课堂名单与点名"
          description="确认本次名单快照后逐人点名。班级变化不会自动改写本次名单。"
          actions={
            <>
              <button
                type="button"
                className="button secondary"
                disabled={disabled || !session.canManageRoster}
                onClick={() => edit("roster")}
              >
                {session.rosterConfirmed ? "调整本次名单" : "核对课堂名单"}
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={disabled || !session.canTakeAttendance || !session.rosterConfirmed}
                onClick={() => edit("attendance")}
              >
                记录课堂点名
              </button>
              {session.canCorrect && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={disabled}
                  onClick={() => edit("attendanceCorrect")}
                >
                  更正已结束课堂出勤
                </button>
              )}
            </>
          }
        >
          {editor?.kind === "roster" ? (
            <RosterEditor session={editor.session} close={close} />
          ) : editor?.kind === "attendance" || editor?.kind === "attendanceCorrect" ? (
            <AttendanceEditor
              session={editor.session}
              close={close}
              correcting={editor.kind === "attendanceCorrect"}
            />
          ) : (
            <AttendanceReading session={session} regionLabel="本次课堂已保存出勤" />
          )}
        </TeachingPanel>
      </section>
      <section id="teaching-record">
        <TeachingPanel
          title="授课与反思"
          description="授课时间、实际完成内容和反思随课堂记录保存；结束后更正须填写原因。"
        >
          <p>课堂状态：{sessionLabels[session.status]}</p>
          <p>
            开始时间：{date(session.startedAt)} · 结束时间：{date(session.finishedAt)}
            {session.interruptedAt && ` · 最近中断：${date(session.interruptedAt)}`}
          </p>
          {session.summary && (
            <section>
              <h3>实际授课进度与总结</h3>
              <p className={styles.readOnlyText}>{session.summary}</p>
            </section>
          )}
          {session.reflection && (
            <section className={styles.section}>
              <h3>课后反思</h3>
              <p className={styles.readOnlyText}>{session.reflection}</p>
            </section>
          )}
          {editor &&
          ["finish", "correct", "interrupt", "resume", "cancel"].includes(editor.kind) ? (
            <RecordEditor
              session={editor.session}
              mode={editor.kind as "finish" | "correct" | "interrupt" | "resume" | "cancel"}
              close={close}
            />
          ) : (
            <div className={styles.stack}>
              {session.status === "NOT_STARTED" && (
                <TeachingActionForm
                  allowed={!disabled && session.canStart}
                  submitLabel="开始本次授课"
                  command={() => ({
                    type: "teaching.session.start",
                    sessionId: session.id,
                    expectedVersion: session.version,
                  })}
                >
                  <p className={styles.help}>
                    开课前须人工确认当前教案、核对课堂名单，并接受有效的已发布安排。
                  </p>
                </TeachingActionForm>
              )}
              <div className="p-actions">
                {session.canFinish && (
                  <button
                    type="button"
                    className="button"
                    disabled={disabled}
                    onClick={() => edit("finish")}
                  >
                    结束课堂并填写反思
                  </button>
                )}
                {session.status === "IN_PROGRESS" && session.canTakeAttendance && (
                  <button
                    type="button"
                    className="button secondary"
                    disabled={disabled}
                    onClick={() => edit("interrupt")}
                  >
                    记录课堂中断
                  </button>
                )}
                {session.status === "INTERRUPTED" && session.canTakeAttendance && (
                  <button
                    type="button"
                    className="button secondary"
                    disabled={disabled}
                    onClick={() => edit("resume")}
                  >
                    恢复本次授课
                  </button>
                )}
                {session.status === "NOT_STARTED" && session.canCancel && (
                  <button
                    type="button"
                    className="button secondary"
                    disabled={disabled}
                    onClick={() => edit("cancel")}
                  >
                    取消本次课堂
                  </button>
                )}
                {session.canCorrect && (
                  <button
                    type="button"
                    className="button secondary"
                    disabled={disabled}
                    onClick={() => edit("correct")}
                  >
                    更正授课记录
                  </button>
                )}
              </div>
            </div>
          )}
        </TeachingPanel>
      </section>
      <section id="teaching-history">
        <TeachingPanel
          title="教学版本历史"
          description="核对教案、名单、点名及授课记录的历史版本和操作者。"
        >
          <TeachingHistoryView session={session} />
        </TeachingPanel>
      </section>
    </>
  );
}
