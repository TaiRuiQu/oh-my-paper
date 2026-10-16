"use client";
import { useState } from "react";
import type { AttendanceStatus, TeachingSession } from "@/contracts/teaching";
import { Field } from "@/components/platform/primitives";
import { useTeaching } from "./provider";
import { TeachingActionForm } from "./action-form";
import styles from "./teaching.module.css";

export const attendanceLabels: Record<AttendanceStatus, string> = {
  UNMARKED: "未标记",
  PRESENT: "到场",
  LATE: "迟到",
  ABSENT: "缺勤",
  EXCUSED: "请假",
  LEFT_EARLY: "早退",
};
export function AttendanceEditor({
  session,
  close,
  correcting = false,
}: {
  session: TeachingSession;
  close: () => void;
  correcting?: boolean;
}) {
  const { pending, stale, session: current } = useTeaching();
  const active = session.participants.filter(
    (participant) => participant.rosterStatus === "EXPECTED",
  );
  const [marks, setMarks] = useState(
    active.map((participant) => ({
      participantId: participant.id,
      status: participant.attendance,
      reason: participant.attendanceReason,
    })),
  );
  const [dirty, setDirty] = useState(false),
    [reason, setReason] = useState("");
  const disabled =
    pending || stale || !(correcting ? current?.canCorrect : current?.canTakeAttendance);
  const unmarked = marks.filter((mark) => mark.status === "UNMARKED").length;
  return (
    <TeachingActionForm
      allowed={!disabled && !!marks.length}
      dirty={dirty || !!reason}
      submitLabel={correcting ? "保存出勤更正" : "保存课堂点名"}
      onSaved={close}
      onReload={close}
      onCancel={close}
      command={() =>
        correcting
          ? {
              type: "teaching.session.correct",
              sessionId: session.id,
              expectedVersion: session.version,
              marks,
              reason,
            }
          : {
              type: "teaching.attendance.save",
              sessionId: session.id,
              expectedVersion: session.version,
              marks,
            }
      }
    >
      <div className={styles.entryHeader}>
        <p>
          本次应到 {marks.length} 人 · 未标记 {unmarked} 人
        </p>
        <button
          type="button"
          className="button secondary"
          disabled={disabled || !unmarked}
          onClick={() => {
            if (
              window.confirm(`将 ${unmarked} 名未标记成员明确设为到场？已登记的异常出勤将保留。`)
            ) {
              setMarks((values) =>
                values.map((mark) =>
                  mark.status === "UNMARKED" ? { ...mark, status: "PRESENT", reason: "" } : mark,
                ),
              );
              setDirty(true);
            }
          }}
        >
          将未标记成员设为到场
        </button>
      </div>
      <p className={styles.help}>
        请逐人核对。迟到、缺勤、请假和早退须填写说明；未标记不会自动视为到场。
      </p>
      <div className={styles.attendanceRows} role="group" aria-label="本次课堂点名名单">
        {active.map((participant) => {
          const mark = marks.find((entry) => entry.participantId === participant.id)!;
          return (
            <div className={styles.attendanceRow} key={participant.id}>
              <div>
                <strong>{participant.name}</strong>
                <small>
                  {participant.studentNumber} · {participant.classroomName}
                </small>
              </div>
              <Field label={`${participant.name}的出勤状态`}>
                <select
                  disabled={disabled}
                  value={mark.status}
                  onChange={(event) => {
                    setMarks((values) =>
                      values.map((entry) =>
                        entry.participantId === participant.id
                          ? { ...entry, status: event.target.value as AttendanceStatus }
                          : entry,
                      ),
                    );
                    setDirty(true);
                  }}
                >
                  {Object.entries(attendanceLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={`${participant.name}的出勤说明`}>
                <input
                  disabled={disabled}
                  maxLength={2000}
                  required={!["UNMARKED", "PRESENT"].includes(mark.status)}
                  value={mark.reason}
                  onChange={(event) => {
                    setMarks((values) =>
                      values.map((entry) =>
                        entry.participantId === participant.id
                          ? { ...entry, reason: event.target.value }
                          : entry,
                      ),
                    );
                    setDirty(true);
                  }}
                />
              </Field>
            </div>
          );
        })}
      </div>
      {correcting && (
        <Field label="出勤更正原因">
          <textarea
            required
            maxLength={2000}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
      )}
    </TeachingActionForm>
  );
}

export function AttendanceReading({
  session,
  regionLabel,
}: {
  session: TeachingSession;
  regionLabel: string;
}) {
  if (!session.rosterConfirmed)
    return <p className="p-empty">课堂名单尚未核对确认。确认后才能点名。</p>;
  return (
    <div className={styles.tableRegion} role="region" aria-label={regionLabel} tabIndex={0}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>学生</th>
            <th>班级 / 学号</th>
            <th>名单状态</th>
            <th>出勤 / 说明</th>
          </tr>
        </thead>
        <tbody>
          {session.participants.map((participant) => (
            <tr key={participant.id}>
              <td>{participant.name}</td>
              <td>
                {participant.classroomName}
                <small>{participant.studentNumber}</small>
              </td>
              <td>
                {participant.rosterStatus === "EXCLUDED" ? "本次退出" : "本次参与"}
                {participant.rosterReason && <small>{participant.rosterReason}</small>}
              </td>
              <td>
                {participant.rosterStatus === "EXCLUDED"
                  ? "不计本次出勤"
                  : attendanceLabels[participant.attendance]}
                {participant.rosterStatus === "EXPECTED" && participant.attendanceReason && (
                  <small>{participant.attendanceReason}</small>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
