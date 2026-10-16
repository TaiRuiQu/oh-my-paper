"use client";
import Link from "next/link";
import { useState } from "react";
import type {
  HomeworkAssignment,
  HomeworkAssignmentDetail,
  HomeworkWork,
} from "@/contracts/homework";
import { Field } from "@/components/platform/primitives";
import { HomeworkForm, HomeworkPanel, collectionLabel, participationLabel } from "./primitives";
import { HomeworkHistoryView } from "./history";
import { useHomework } from "./provider";
import styles from "./homework.module.css";
type TeacherDetail = Extract<HomeworkAssignmentDetail, { view: "TEACHER" }>;
type Editor =
  | { kind: "settings" | "close" | "reopen" | "cancel" | "sync"; assignment: HomeworkAssignment }
  | { kind: "return" | "extend"; assignment: HomeworkAssignment; work: HomeworkWork };
export function TeacherCollection({ detail }: { detail: TeacherDetail }) {
  const { pending, stale, refresh } = useHomework();
  const a = detail.assignment;
  const [editor, setEditor] = useState<Editor | null>(null),
    [error, setError] = useState(""),
    [filter, setFilter] = useState("");
  const disabled = pending || stale || !!editor;
  const close = () => setEditor(null);
  return (
    <>
      <HomeworkPanel
        title="作业发放与收交"
        description="学生提交与成绩发布分别管理。收交进度按本次名单计算，教师无法读取学生未提交草稿。"
        actions={
          <button
            type="button"
            className="button secondary"
            disabled={pending}
            onClick={async () => {
              if (editor && !window.confirm("重新读取会放弃当前未保存调整。确定重新读取？")) return;
              try {
                await refresh();
                setEditor(null);
                setError("");
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : "重读失败，输入仍保留。");
              }
            }}
          >
            重新读取收交记录
          </button>
        }
      >
        {error && (
          <p className="p-notice error" role="alert">
            {error}
          </p>
        )}
        <p>
          {a.name} · {{ ISSUED: "开放提交", CLOSED: "已关闭提交", CANCELLED: "已撤回" }[a.status]} ·
          设置版本 v{a.version}
        </p>
        <p>
          截止：{a.dueLocal.replace("T", " ")} · {a.timezone} ·{" "}
          {a.allowLate ? "允许迟交并标记" : "截止后禁止提交"}
        </p>
        <p className={styles.answer}>{a.instructions || "未填写额外作业说明"}</p>
        <p>
          本次应交 {detail.counts.required} 人科 · 已提交 {detail.counts.submitted} · 未提交{" "}
          {detail.counts.notSubmitted} · 退回待修改 {detail.counts.returned} · 迟交{" "}
          {detail.counts.late}
        </p>
        <p className={styles.help}>
          免交 {detail.counts.exempt} · 本次缺席 {detail.counts.absent} · 退出{" "}
          {detail.counts.withdrawn}。已提交与迟交可能重叠。
        </p>
        {a.rosterNeedsSync && (
          <p className="p-notice">
            参试名单已变化：本次收交名单 v{a.rosterRevision}，当前 v{a.currentRosterRevision}
            。新增应交成员须明确同步后才能领取；原科目退出立即暂停作答，历史提交仍保留。
          </p>
        )}
        {!!a.capabilities.blockReasons.length && (
          <div className="p-notice">
            <ul>
              {a.capabilities.blockReasons.map((reason, index) => (
                <li key={index}>{reason}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="p-actions">
          {a.capabilities.canManage && (
            <button
              type="button"
              className="button secondary"
              disabled={disabled}
              onClick={() => setEditor({ kind: "settings", assignment: structuredClone(a) })}
            >
              调整收交设置
            </button>
          )}
          {(
            [
              ["close", a.capabilities.canClose, "关闭提交"],
              ["reopen", a.capabilities.canReopen, "重新开放提交"],
              ["cancel", a.capabilities.canCancel, "撤回作业"],
              ["sync", a.capabilities.canSyncRoster && a.rosterNeedsSync, "核对并同步名单"],
            ] as const
          ).map(
            ([kind, visible, label]) =>
              visible && (
                <button
                  type="button"
                  className="button secondary"
                  key={kind}
                  disabled={disabled}
                  onClick={() => setEditor({ kind, assignment: structuredClone(a) })}
                >
                  {label}
                </button>
              ),
          )}
          <Link
            className="button secondary"
            href={`/homework/assignments/${a.assessmentId}/grading`}
          >
            进入作业批改
          </Link>
          {a.capabilities.canManage && (
            <Link
              className="button secondary"
              href={`/homework/assignments/${a.assessmentId}/publish`}
            >
              管理反馈发布
            </Link>
          )}
        </div>
        {editor && (
          <section className={styles.section}>
            <TeacherAction
              key={`${editor.kind}/${"work" in editor ? editor.work.id : "assignment"}`}
              editor={editor}
              close={close}
            />
          </section>
        )}
      </HomeworkPanel>
      <HomeworkPanel
        title="学生收交记录"
        description="退回须说明需要补充或修改的内容；个人延期沿用学校时区。"
      >
        <Field label="筛选收交状态">
          <select value={filter} onChange={(event) => setFilter(event.target.value)}>
            <option value="">全部记录</option>
            <option value="NOT_SUBMITTED">未提交</option>
            <option value="SUBMITTED">已提交</option>
            <option value="RETURNED">退回待修改</option>
            <option value="EXCLUDED">无需提交</option>
          </select>
        </Field>
        <div
          className={styles.tableRegion}
          role="region"
          aria-label="学生作业收交记录"
          tabIndex={0}
        >
          <table className={styles.table}>
            <thead>
              <tr>
                <th>学生 / 班级</th>
                <th>作业科目</th>
                <th>状态</th>
                <th>个人截止</th>
                <th>当前提交</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {detail.works
                .filter(
                  (work) =>
                    !filter ||
                    (filter === "EXCLUDED"
                      ? work.participationStatus !== "REQUIRED"
                      : work.collectionStatus === filter &&
                        work.participationStatus === "REQUIRED"),
                )
                .map((work, rowIndex) => (
                  <tr key={work.id}>
                    <td>
                      {work.name}
                      <small>
                        {work.classroomName} · {work.studentNumber}
                      </small>
                    </td>
                    <td>{a.papers.find((paper) => paper.id === work.paperId)?.name ?? "作业"}</td>
                    <td>
                      {work.participationStatus === "REQUIRED"
                        ? collectionLabel[work.collectionStatus]
                        : participationLabel[work.participationStatus]}
                      {work.overdue && <small>已过截止时间</small>}
                      {work.participationReason && <small>{work.participationReason}</small>}
                    </td>
                    <td>
                      {work.dueLocal.replace("T", " ")}
                      <small>
                        {a.timezone}
                        {work.deadlineOverride && ` · 延期：${work.deadlineOverride.reason}`}
                      </small>
                    </td>
                    <td>
                      {work.currentAttempt ? (
                        <>
                          第 {work.currentAttempt.sequence} 次 ·{" "}
                          {work.currentAttempt.late ? "迟交" : "按时"}
                          <small>{work.currentAttempt.returnReason}</small>
                        </>
                      ) : (
                        "暂无提交"
                      )}
                    </td>
                    <td>
                      <div className="p-actions">
                        {work.capabilities.canReturn && (
                          <button
                            type="button"
                            className="button secondary"
                            disabled={disabled}
                            onClick={() =>
                              setEditor({
                                kind: "return",
                                assignment: structuredClone(a),
                                work: structuredClone(work),
                              })
                            }
                          >
                            退回修改
                          </button>
                        )}
                        {work.capabilities.canExtend && (
                          <button
                            type="button"
                            className="button secondary"
                            disabled={disabled}
                            onClick={() =>
                              setEditor({
                                kind: "extend",
                                assignment: structuredClone(a),
                                work: structuredClone(work),
                              })
                            }
                          >
                            个人延期
                          </button>
                        )}
                      </div>
                      {work.capabilities.canViewAttemptHistory && (
                        <details>
                          <summary>查看该生提交历史</summary>
                          <HomeworkHistoryView
                            assignmentId={a.id}
                            workId={work.id}
                            timezone={a.timezone}
                            context={`收交记录第 ${rowIndex + 1} 条${work.classroomName}${work.name}（${work.studentNumber}）${a.papers.find((paper) => paper.id === work.paperId)?.name ?? "作业"}个人历史`}
                          />
                        </details>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </HomeworkPanel>
      {a.capabilities.canViewHistory && (
        <HomeworkPanel title="作业操作历史">
          <HomeworkHistoryView assignmentId={a.id} timezone={a.timezone} context="全部收交历史" />
        </HomeworkPanel>
      )}
    </>
  );
}
function TeacherAction({ editor, close }: { editor: Editor; close: () => void }) {
  const a = editor.assignment;
  const [reason, setReason] = useState(""),
    [instructions, setInstructions] = useState(a.instructions),
    [dueLocal, setDueLocal] = useState("work" in editor ? editor.work.dueLocal : a.dueLocal),
    [allowLate, setAllowLate] = useState(a.allowLate);
  const labels = {
    settings: "保存收交设置",
    close: "确认关闭提交",
    reopen: "确认重新开放",
    cancel: "确认撤回作业",
    sync: "确认同步本次名单",
    return: "确认退回修改",
    extend: "保存个人延期",
  };
  return (
    <HomeworkForm
      label={labels[editor.kind]}
      dirty={!!reason}
      close={close}
      command={() => {
        if (editor.kind === "return")
          return {
            type: "homework.return",
            workId: editor.work.id,
            expectedVersion: editor.work.version,
            expectedAttemptId: editor.work.currentAttempt!.id,
            reason,
          };
        if (editor.kind === "extend")
          return {
            type: "homework.deadline.extend",
            workId: editor.work.id,
            expectedVersion: editor.work.version,
            dueLocal,
            reason,
          };
        if (editor.kind === "settings")
          return {
            type: "homework.settings",
            assignmentId: a.id,
            expectedVersion: a.version,
            instructions,
            dueLocal,
            allowLate,
            reason,
          };
        if (editor.kind === "sync")
          return {
            type: "homework.roster.sync",
            assignmentId: a.id,
            expectedVersion: a.version,
            expectedRosterRevision: a.currentRosterRevision,
            reason,
          };
        return {
          type:
            editor.kind === "close"
              ? "homework.close"
              : editor.kind === "reopen"
                ? "homework.reopen"
                : "homework.cancel",
          assignmentId: a.id,
          expectedVersion: a.version,
          reason,
        };
      }}
    >
      {"work" in editor && (
        <p>
          {editor.work.name} · {editor.work.classroomName}
        </p>
      )}
      {editor.kind === "settings" && (
        <Field label="学生作业说明">
          <textarea
            maxLength={10000}
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
          />
        </Field>
      )}
      {(editor.kind === "settings" || editor.kind === "extend") && (
        <Field
          label={editor.kind === "extend" ? "个人延期截止时间" : "作业截止日期与时间"}
          hint={`按 ${a.timezone} 解释。`}
        >
          <input
            type="datetime-local"
            required
            value={dueLocal}
            onChange={(event) => setDueLocal(event.target.value)}
          />
        </Field>
      )}
      {editor.kind === "settings" && (
        <label>
          <input
            type="checkbox"
            checked={allowLate}
            onChange={(event) => setAllowLate(event.target.checked)}
          />{" "}
          截止后允许迟交并标记
        </label>
      )}
      {editor.kind === "sync" && (
        <p className="p-notice">
          确认使用当前参试名单 v{a.currentRosterRevision}{" "}
          同步本次收交状态。历史提交与退回记录继续保留。
        </p>
      )}
      <Field label={editor.kind === "return" ? "退回修改原因" : "本次操作原因"}>
        <textarea
          required
          maxLength={2000}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
    </HomeworkForm>
  );
}
