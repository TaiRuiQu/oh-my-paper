"use client";
import { useEffect, useState } from "react";
import type { TeachingRosterPreview, TeachingSession } from "@/contracts/teaching";
import { Field } from "@/components/platform/primitives";
import { apiRequest } from "@/lib/http-client";
import { useTeaching } from "./provider";
import { TeachingActionForm } from "./action-form";
import styles from "./teaching.module.css";

export function RosterEditor({ session, close }: { session: TeachingSession; close: () => void }) {
  const { pending, stale, session: current } = useTeaching();
  const [preview, setPreview] = useState<TeachingRosterPreview | null>(null),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0);
  const [additions, setAdditions] = useState<string[]>([]),
    [exclusions, setExclusions] = useState<string[]>([]),
    [restorations, setRestorations] = useState<string[]>([]);
  const [reason, setReason] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    apiRequest<TeachingRosterPreview>(
      `/api/platform/teaching/sessions/${session.id}/roster-preview`,
      { signal: controller.signal },
    )
      .then((result) => {
        if (!controller.signal.aborted) setPreview(result);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "课堂名单读取失败，请重试。");
      });
    return () => controller.abort();
  }, [session.id, attempt]);
  const disabled = pending || stale || !current?.canManageRoster;
  const existingRoster = session.participants.length > 0;
  const toggle = (items: string[], id: string, checked: boolean) =>
    checked ? [...items, id] : items.filter((value) => value !== id);
  if (!preview)
    return (
      <>
        {error ? (
          <div className="p-notice error" role="alert">
            <p>{error}</p>
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                setError("");
                setAttempt((value) => value + 1);
              }}
            >
              重新读取候选名单
            </button>
          </div>
        ) : (
          <p role="status">正在读取当前班级成员及名单差异…</p>
        )}
        <button type="button" className="button secondary" onClick={close}>
          关闭名单核对
        </button>
      </>
    );
  return (
    <TeachingActionForm
      allowed={!disabled}
      submitDisabled={!confirmed}
      dirty={
        !!reason || !!additions.length || !!exclusions.length || !!restorations.length || confirmed
      }
      submitLabel={existingRoster ? "保存课堂名单调整" : "确认本次课堂名单"}
      onSaved={close}
      onReload={close}
      onCancel={close}
      command={() =>
        existingRoster
          ? {
              type: "teaching.roster.update",
              sessionId: session.id,
              expectedVersion: session.version,
              fingerprint: preview.fingerprint,
              addStudentIds: additions,
              excludeParticipantIds: exclusions,
              restoreParticipantIds: restorations,
              reason,
            }
          : {
              type: "teaching.roster.confirm",
              sessionId: session.id,
              expectedVersion: session.version,
              fingerprint: preview.fingerprint,
            }
      }
    >
      <p className={styles.help}>
        本次名单按当前班级成员核对后保存快照。后续班级变化不会自动改写课堂记录；提交时会再次检查名单指纹，发生变化则需重新读取。
      </p>
      {(!!preview.addedStudentIds.length || !!preview.removedParticipantIds.length) && (
        <p className="p-notice">
          与已保存名单相比：新增候选 {preview.addedStudentIds.length} 人，已不在当前班级{" "}
          {preview.removedParticipantIds.length} 人。已有成员不会自动退出。
        </p>
      )}
      <div className={styles.tableRegion} role="region" aria-label="课堂名单核对" tabIndex={0}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>学生</th>
              <th>班级 / 学号</th>
              <th>本次处理</th>
            </tr>
          </thead>
          <tbody>
            {!existingRoster ? (
              preview.candidates.map((student) => (
                <tr key={student.studentId}>
                  <td>{student.name}</td>
                  <td>
                    {student.classroomName}
                    <small>{student.studentNumber}</small>
                  </td>
                  <td>确认后加入本次课堂</td>
                </tr>
              ))
            ) : (
              <>
                {session.participants.map((participant) => (
                  <tr key={participant.id}>
                    <td>{participant.name}</td>
                    <td>
                      {participant.classroomName}
                      <small>{participant.studentNumber}</small>
                    </td>
                    <td>
                      {participant.rosterStatus === "EXPECTED" ? (
                        <label>
                          <input
                            type="checkbox"
                            checked={exclusions.includes(participant.id)}
                            onChange={(event) =>
                              setExclusions(
                                toggle(exclusions, participant.id, event.target.checked),
                              )
                            }
                          />{" "}
                          本次退出
                          {preview.removedParticipantIds.includes(participant.id) && (
                            <small>已不在当前班级，需明确决定是否退出</small>
                          )}
                        </label>
                      ) : (
                        <label>
                          <input
                            type="checkbox"
                            checked={restorations.includes(participant.id)}
                            onChange={(event) =>
                              setRestorations(
                                toggle(restorations, participant.id, event.target.checked),
                              )
                            }
                          />{" "}
                          恢复参与<small>原退出原因：{participant.rosterReason}</small>
                        </label>
                      )}
                    </td>
                  </tr>
                ))}
                {preview.candidates
                  .filter(
                    (student) =>
                      !session.participants.some(
                        (participant) => participant.studentId === student.studentId,
                      ),
                  )
                  .map((student) => (
                    <tr key={student.studentId}>
                      <td>{student.name}</td>
                      <td>
                        {student.classroomName}
                        <small>{student.studentNumber}</small>
                      </td>
                      <td>
                        <label>
                          <input
                            type="checkbox"
                            checked={additions.includes(student.studentId)}
                            onChange={(event) =>
                              setAdditions(
                                toggle(additions, student.studentId, event.target.checked),
                              )
                            }
                          />{" "}
                          明确增补到本次课堂
                        </label>
                      </td>
                    </tr>
                  ))}
              </>
            )}
          </tbody>
        </table>
      </div>
      {!preview.candidates.length && !session.participants.length && (
        <p className="p-notice">当前班级没有候选学生，请先核对班级名单。</p>
      )}
      {existingRoster && (
        <Field label="课堂名单调整原因">
          <textarea
            required
            maxLength={2000}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
      )}
      <label>
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />{" "}
        我已核对以上名单及调整，确认保存本次课堂快照
      </label>
    </TeachingActionForm>
  );
}
