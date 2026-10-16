"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import type {
  SchoolCalendarDay,
  SchoolLessonOverride,
  SchoolPeriod,
  SchoolSlot,
  SchoolTerm,
  SchoolTimetable,
  SchoolTimetableCheck,
} from "@/contracts/school";
import { Empty, Field } from "@/components/platform/primitives";
import { SchoolPanel as Panel } from "./school-panel";
import { useUnsavedChanges } from "@/components/platform/use-unsaved-changes";
import { apiRequest } from "@/lib/http-client";
import { schoolWeekdayNames as weekdays } from "@/lib/school-calendar";
import { useSchool } from "./school-provider";
import styles from "./school.module.css";

const emptyTimetable = (): SchoolTimetable => ({
  periods: [],
  slots: [],
  calendar: [],
  overrides: [],
});
const uid = () => crypto.randomUUID();

export type TimetableLeaveGuard = { confirmLeave: () => boolean };
export function TimetableEditor({
  term,
  leaveGuard,
}: {
  term: SchoolTerm;
  leaveGuard?: Ref<TimetableLeaveGuard>;
}) {
  const { state, execute, pending, stale, refresh } = useSchool();
  const [draft, setDraft] = useState<SchoolTimetable>(() =>
    structuredClone(term.timetable ?? emptyTimetable()),
  );
  const [revision, setRevision] = useState(term.revision);
  const [sourceTerm, setSourceTerm] = useState(term);
  const [dirty, setDirty] = useState(false);
  const [reason, setReason] = useState("");
  const [publishReason, setPublishReason] = useState("");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [check, setCheck] = useState<SchoolTimetableCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const lock = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const { markSaved, confirmDiscard } = useUnsavedChanges(
    dirty || !!reason || !!publishReason,
    "有未保存的排课修改或发布理由，离开后会丢失。确定离开？",
  );
  useImperativeHandle(leaveGuard, () => ({ confirmLeave: confirmDiscard }), [confirmDiscard]);
  if (sourceTerm !== term && !dirty) {
    setSourceTerm(term);
    setDraft(structuredClone(term.timetable ?? emptyTimetable()));
    setRevision(term.revision);
  }
  const changedElsewhere = revision !== term.revision;
  const busy = pending || checking;
  const disabled = busy || stale || !state.canManage || term.archived;
  const offeringName = (offeringId: string) => {
    const item = state.offerings.find((offering) => offering.id === offeringId);
    return item
      ? `${state.classrooms.find((c) => c.id === item.classroomId)?.name ?? "未知班级"} · ${state.courses.find((c) => c.id === item.courseId)?.name ?? "未知课程"} · ${state.teachers.find((t) => t.id === item.teacherId)?.name ?? "未知教师"}`
      : "请选择开课任务";
  };
  function update<K extends keyof SchoolTimetable>(key: K, entries: SchoolTimetable[K]) {
    setDraft((current) => ({ ...current, [key]: entries }));
    setDirty(true);
    setCheck(null);
  }
  async function reload() {
    if (lock.current || busy) return;
    if (
      (dirty || reason || publishReason) &&
      !window.confirm("重新读取会放弃本次未保存的排课修改与理由。确定重新读取？")
    )
      return;
    lock.current = true;
    try {
      await refresh();
      markSaved();
      setDirty(false);
      setReason("");
      setPublishReason("");
      setConflict(false);
      setError("");
      setCheck(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "读取失败，草稿已保留。");
    } finally {
      lock.current = false;
    }
  }
  async function runCheck() {
    if (lock.current || disabled || dirty || changedElsewhere || conflict) return;
    lock.current = true;
    setChecking(true);
    setError("");
    setCheck(null);
    try {
      const result = await apiRequest<SchoolTimetableCheck>(
        `/api/platform/school/timetable/check?${new URLSearchParams({ termId: term.id })}`,
      );
      if (alive.current) {
        if (result.revision !== revision) {
          setConflict(true);
          setError("检查版本已变化，请重新读取后核对。");
        } else setCheck(result);
      }
    } catch (cause) {
      if (alive.current)
        setError(cause instanceof Error ? cause.message : "冲突检查失败，请重试。");
    } finally {
      lock.current = false;
      if (alive.current) setChecking(false);
    }
  }
  return (
    <div className={styles.stack}>
      <Panel
        title="学期排课"
        description="编辑节次与周课表，保存草稿后检查冲突。发布才会更新师生可见课表；未发布的修改不影响已发布版本。"
      >
        <p className={styles.version}>
          {term.name} · {term.timezone} · 当前草稿 v{term.revision} · 已发布{" "}
          {term.publishedRevision === null ? "无" : `v${term.publishedRevision}`}
        </p>
        {term.publishedRevision !== null && term.publishedRevision !== term.revision && (
          <p className="p-notice">
            草稿存在未发布修改。师生仍查看已发布 v{term.publishedRevision}。
          </p>
        )}
        {term.archived && (
          <p className="p-notice">本学期已归档，排课只读。需在教务设置取消归档后修改。</p>
        )}
        {(error || changedElsewhere || conflict) && (
          <div role="alert" className="p-notice error">
            <p>{error || "教务资料版本已变化，当前草稿仍保留。请重新读取并核对后再保存。"}</p>
            <button type="button" className="button secondary" disabled={busy} onClick={reload}>
              重新读取排课
            </button>
          </div>
        )}
        {busy && <p role="status">正在处理，请稍候。编辑已暂停。</p>}
        <form
          className="p-form"
          inert={disabled}
          onSubmit={async (event) => {
            event.preventDefault();
            if (lock.current || disabled || changedElsewhere || conflict) return;
            lock.current = true;
            setError("");
            try {
              const dangling = draft.overrides
                .map((entry, index) => ({ entry, index }))
                .filter(
                  ({ entry }) =>
                    !!entry.slotId && !draft.slots.some((slot) => slot.id === entry.slotId),
                );
              if (dangling.length) {
                setError(
                  `${dangling.map(({ index }) => `调代课 ${index + 1}`).join("、")} 的原周课表已失效，请重新选择或删除后再保存。`,
                );
                return;
              }
              const result = await execute({
                type: "school.timetable.save",
                termId: term.id,
                expectedRevision: revision,
                reason,
                timetable: draft,
              });
              if (result.ok) {
                markSaved();
                setDirty(false);
                setReason("");
                setCheck(null);
              } else {
                setError(result.error);
                setConflict(result.conflict);
              }
            } finally {
              lock.current = false;
            }
          }}
        >
          <TimetableSection
            title="每日节次"
            description="先设置上课与下课时间；连堂在周课表里选择多个节次。"
            addLabel="添加节次"
            disabled={disabled}
            add={() =>
              update("periods", [
                ...draft.periods,
                { id: uid(), name: "", startTime: "08:00", endTime: "08:45" },
              ])
            }
          >
            {!draft.periods.length && <Empty>尚无节次。请添加学校使用的上课节次。</Empty>}
            {draft.periods.map((period, index) => (
              <Entry
                key={period.id}
                title={`节次 ${index + 1}`}
                disabled={disabled}
                remove={() => {
                  if (
                    window.confirm(`删除${period.name || "此节次"}？请同时检查引用它的课表与调课。`)
                  )
                    update(
                      "periods",
                      draft.periods.filter((p) => p.id !== period.id),
                    );
                }}
              >
                <Field label={`节次 ${index + 1} 名称`}>
                  <input
                    required
                    maxLength={120}
                    value={period.name}
                    onChange={(event) =>
                      update(
                        "periods",
                        draft.periods.map((p) =>
                          p.id === period.id ? { ...p, name: event.target.value } : p,
                        ),
                      )
                    }
                  />
                </Field>
                <Field label={`节次 ${index + 1} 开始时间`}>
                  <input
                    type="time"
                    required
                    value={period.startTime}
                    onChange={(event) =>
                      update(
                        "periods",
                        draft.periods.map((p) =>
                          p.id === period.id ? { ...p, startTime: event.target.value } : p,
                        ),
                      )
                    }
                  />
                </Field>
                <Field label={`节次 ${index + 1} 结束时间`}>
                  <input
                    type="time"
                    required
                    value={period.endTime}
                    onChange={(event) =>
                      update(
                        "periods",
                        draft.periods.map((p) =>
                          p.id === period.id ? { ...p, endTime: event.target.value } : p,
                        ),
                      )
                    }
                  />
                </Field>
              </Entry>
            ))}
          </TimetableSection>
          <TimetableSection
            title="每周课程"
            description="按开课任务选择星期、连堂节次、教学周和单双周。每周课时不足或超出会在检查结果中提示。"
            addLabel="添加周课表"
            disabled={
              disabled ||
              !draft.periods.length ||
              !state.offerings.some((o) => o.termId === term.id && o.active)
            }
            add={() =>
              update("slots", [
                ...draft.slots,
                {
                  id: uid(),
                  offeringId: "",
                  weekday: 1,
                  periodIds: [],
                  roomId: null,
                  fromWeek: 1,
                  toWeek: 20,
                  parity: "ALL",
                },
              ])
            }
          >
            {!state.offerings.some((o) => o.termId === term.id && o.active) && (
              <Empty>先在教务设置创建本学期开课任务。</Empty>
            )}
            {draft.slots.map((slot, index) => (
              <SlotEntry
                key={slot.id}
                slot={slot}
                index={index}
                draft={draft}
                offeringName={offeringName}
                termId={term.id}
                disabled={disabled}
                change={(next) =>
                  update(
                    "slots",
                    draft.slots.map((s) => (s.id === slot.id ? next : s)),
                  )
                }
                remove={() => {
                  const references = draft.overrides
                    .map((entry, i) => (entry.slotId === slot.id ? `调代课 ${i + 1}` : null))
                    .filter((label): label is string => label !== null);
                  if (
                    window.confirm(
                      references.length
                        ? `删除周课表 ${index + 1}？${references.join("、")} 引用了它，删除后需重新选择或删除这些调代课。`
                        : `删除周课表 ${index + 1}？`,
                    )
                  )
                    update(
                      "slots",
                      draft.slots.filter((s) => s.id !== slot.id),
                    );
                }}
              />
            ))}
          </TimetableSection>
          <TimetableSection
            title="校历调整"
            description="停课会取消该日课程；换日采用来源日期的常规周课表，不递归套用其他校历调整。"
            addLabel="添加校历调整"
            disabled={disabled}
            add={() =>
              update("calendar", [
                ...draft.calendar,
                { date: "", kind: "CLOSED", sourceDate: null, reason: "" },
              ])
            }
          >
            {draft.calendar.map((day, index) => (
              <CalendarEntry
                key={index}
                day={day}
                index={index}
                disabled={disabled}
                change={(next) =>
                  update(
                    "calendar",
                    draft.calendar.map((d, i) => (i === index ? next : d)),
                  )
                }
                remove={() =>
                  update(
                    "calendar",
                    draft.calendar.filter((_, i) => i !== index),
                  )
                }
              />
            ))}
            {!draft.calendar.length && <Empty>未设置停课或换日，按正常周课表上课。</Empty>}
          </TimetableSection>
          <TimetableSection
            title="单次调课与代课"
            description="选择周课表及原定上课日期。调课可更换日期、节次、教师和教室；同日期调课可用于安排代课。"
            addLabel="添加调代课"
            disabled={disabled || !draft.slots.length}
            add={() =>
              update("overrides", [
                ...draft.overrides,
                {
                  id: uid(),
                  slotId: "",
                  originalDate: "",
                  action: "CANCEL",
                  date: null,
                  periodIds: [],
                  teacherId: null,
                  roomId: null,
                  reason: "",
                },
              ])
            }
          >
            {draft.overrides.map((entry, index) => (
              <OverrideEntry
                key={entry.id}
                entry={entry}
                index={index}
                draft={draft}
                offeringName={offeringName}
                disabled={disabled}
                change={(next) =>
                  update(
                    "overrides",
                    draft.overrides.map((o) => (o.id === entry.id ? next : o)),
                  )
                }
                remove={() =>
                  update(
                    "overrides",
                    draft.overrides.filter((o) => o.id !== entry.id),
                  )
                }
              />
            ))}
            {!draft.overrides.length && <Empty>未设置单次调代课。</Empty>}
          </TimetableSection>
          <Field label="本次排课修改理由">
            <textarea
              required
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="说明新增或调整的原因"
            />
          </Field>
          <div className="p-actions">
            <button
              className="button"
              type="submit"
              disabled={disabled || changedElsewhere || conflict}
            >
              保存排课草稿
            </button>
            <button className="button secondary" type="button" disabled={busy} onClick={reload}>
              重新读取排课
            </button>
          </div>
        </form>
      </Panel>
      <Panel
        title="检查与发布"
        description="检查已保存的整个学期，解决教师、班级和教室冲突后，再发布给师生。"
      >
        {dirty && <p className="p-notice">有未保存的修改，请先保存草稿再检查。</p>}
        <button
          type="button"
          className="button secondary"
          disabled={disabled || dirty || changedElsewhere || conflict}
          onClick={runCheck}
        >
          {checking ? "正在检查…" : "检查已保存课表"}
        </button>
        {check && (
          <>
            <p role="status">
              已检查草稿 v{check.revision}：{check.lessons.length} 次课程，{check.conflicts.length}{" "}
              个冲突。
            </p>
            {!!check.conflicts.length && (
              <div className={styles.tableRegion} role="region" aria-label="排课冲突" tabIndex={0}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>类型</th>
                      <th>日期</th>
                      <th>需要处理的问题</th>
                    </tr>
                  </thead>
                  <tbody>
                    {check.conflicts.map((issue, i) => (
                      <tr key={i}>
                        <td>
                          {
                            {
                              TEACHER: "教师冲突",
                              CLASSROOM: "班级冲突",
                              ROOM: "教室冲突",
                              CONFIGURATION: "配置问题",
                            }[issue.kind]
                          }
                        </td>
                        <td>{issue.date ?? "学期配置"}</td>
                        <td>
                          {issue.message}
                          {issue.lessonIds
                            .map((id) => check.lessons.find((lesson) => lesson.id === id))
                            .filter((lesson) => !!lesson)
                            .map((lesson) => (
                              <p key={lesson.id}>
                                {lesson.courseName} · {lesson.classroomName} · {lesson.teacherName}{" "}
                                · {lesson.roomName ?? "未指定教室"} · {lesson.startTime}–
                                {lesson.endTime}
                              </p>
                            ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!!check.warnings.length && (
              <div className="p-notice">
                <strong>发布前请核对</strong>
                {!!check.warnings.some((warning) => warning.kind === "SHORTFALL") && (
                  <ul>
                    {check.warnings
                      .filter((warning) => warning.kind === "SHORTFALL")
                      .map((warning, i) => (
                        <li key={i}>{warning.message}</li>
                      ))}
                  </ul>
                )}
                {/* Fully closed weeks are expected calendar gaps: one muted line per
                    week, never mixed into the per-item list above. */}
                {check.warnings.some((warning) => warning.kind === "WEEK_CLOSED") && (
                  <ul className={styles.help}>
                    {check.warnings
                      .filter((warning) => warning.kind === "WEEK_CLOSED")
                      .map((warning, i) => (
                        <li key={i}>{warning.message}</li>
                      ))}
                  </ul>
                )}
              </div>
            )}
            {!!check.lessons.length && (
              <details className={styles.preview}>
                <summary>
                  查看生成课程预览（前 {Math.min(50, check.lessons.length)} / {check.lessons.length}{" "}
                  次）
                </summary>
                <div
                  className={styles.tableRegion}
                  role="region"
                  aria-label="草稿课程预览"
                  tabIndex={0}
                >
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>日期 / 时间</th>
                        <th>课程 / 班级</th>
                        <th>教师 / 教室</th>
                        <th>状态 / 原因</th>
                      </tr>
                    </thead>
                    <tbody>
                      {check.lessons.slice(0, 50).map((lesson) => (
                        <tr key={lesson.id}>
                          <td>
                            {lesson.date}
                            <br />
                            {lesson.startTime}–{lesson.endTime}
                          </td>
                          <td>
                            {lesson.courseName}
                            <br />
                            {lesson.classroomName}
                          </td>
                          <td>
                            {lesson.teacherName}
                            <br />
                            {lesson.roomName ?? "未指定教室"}
                          </td>
                          <td>
                            {lesson.status === "CANCELLED" ? "已取消" : "正常上课"}
                            <p>{lesson.reason}</p>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
            {term.publishedRevision === check.revision && (
              <p className="p-notice">当前草稿版本已发布。修改并保存后可发布新版本。</p>
            )}
            {!check.conflicts.length && term.publishedRevision !== check.revision && (
              <form
                className="p-form"
                inert={disabled}
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (lock.current || disabled || dirty || check.revision !== term.revision) return;
                  lock.current = true;
                  setError("");
                  try {
                    const result = await execute({
                      type: "school.timetable.publish",
                      termId: term.id,
                      expectedRevision: check.revision,
                      reason: publishReason,
                    });
                    if (result.ok) {
                      markSaved();
                      setPublishReason("");
                      setCheck(null);
                    } else {
                      setError(result.error);
                      setConflict(result.conflict);
                    }
                  } finally {
                    lock.current = false;
                  }
                }}
              >
                <Field label="课表发布理由">
                  <textarea
                    required
                    maxLength={500}
                    value={publishReason}
                    onChange={(event) => setPublishReason(event.target.value)}
                  />
                </Field>
                <button
                  type="submit"
                  className="button"
                  disabled={disabled || dirty || check.revision !== term.revision}
                >
                  发布草稿 v{check.revision}
                </button>
              </form>
            )}
          </>
        )}
        <div className={styles.list}>
          {state.publications
            .filter((p) => p.termId === term.id)
            .map((publication) => (
              <div className={styles.row} key={publication.id}>
                <div>
                  <strong>
                    发布 v{publication.revision} · {publication.lessonCount} 次课程
                  </strong>
                  <p>
                    {publication.actorName} ·{" "}
                    {new Intl.DateTimeFormat("zh-CN", {
                      timeZone: term.timezone,
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(publication.createdAt))}
                  </p>
                  <p>{publication.reason}</p>
                </div>
              </div>
            ))}
        </div>
      </Panel>
    </div>
  );
}

function TimetableSection({
  title,
  description,
  addLabel,
  add,
  disabled,
  children,
}: {
  title: string;
  description: string;
  addLabel: string;
  add: () => void;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={styles.section}>
      <div className={styles.row}>
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <button type="button" className="button secondary" disabled={disabled} onClick={add}>
          {addLabel}
        </button>
      </div>
      {children}
    </section>
  );
}
function Entry({
  title,
  children,
  remove,
  disabled,
}: {
  title: string;
  children: React.ReactNode;
  remove: () => void;
  disabled: boolean;
}) {
  return (
    <div className={styles.entry}>
      <div className={styles.row}>
        <strong>{title}</strong>
        <button type="button" className="button secondary" disabled={disabled} onClick={remove}>
          移除{title}
        </button>
      </div>
      <div className="p-form-grid">{children}</div>
    </div>
  );
}
function PeriodSelect({
  periods,
  selected,
  change,
  label,
}: {
  periods: SchoolPeriod[];
  selected: string[];
  change: (value: string[]) => void;
  label: string;
}) {
  return (
    <fieldset className={styles.periods}>
      <legend>{label}（可选连堂）</legend>
      {periods.map((period) => (
        <label key={period.id}>
          <input
            type="checkbox"
            checked={selected.includes(period.id)}
            onChange={(event) =>
              change(
                event.target.checked
                  ? [...selected, period.id]
                  : selected.filter((id) => id !== period.id),
              )
            }
          />{" "}
          {period.name || "未命名节次"} {period.startTime}–{period.endTime}
        </label>
      ))}
      {!periods.length && <p>请先添加节次。</p>}
    </fieldset>
  );
}
function SlotEntry({
  slot,
  index,
  draft,
  change,
  remove,
  offeringName,
  termId,
  disabled,
}: {
  slot: SchoolSlot;
  index: number;
  draft: SchoolTimetable;
  change: (value: SchoolSlot) => void;
  remove: () => void;
  offeringName: (id: string) => string;
  termId: string;
  disabled: boolean;
}) {
  const { state } = useSchool();
  const label = `周课表 ${index + 1}`;
  return (
    <Entry title={label} disabled={disabled} remove={remove}>
      <Field label={`${label} 开课任务`}>
        <select
          required
          value={slot.offeringId}
          onChange={(e) => change({ ...slot, offeringId: e.target.value })}
        >
          <option value="">选择班级课程与教师</option>
          {state.offerings
            .filter((o) => o.termId === termId && (o.active || o.id === slot.offeringId))
            .map((o) => (
              <option key={o.id} value={o.id}>
                {offeringName(o.id)}
                {o.active ? "" : "（已停用）"}
              </option>
            ))}
        </select>
      </Field>
      <Field label={`${label} 星期`}>
        <select
          value={slot.weekday}
          onChange={(e) => change({ ...slot, weekday: Number(e.target.value) })}
        >
          {weekdays.map((day, i) => (
            <option key={day} value={i + 1}>
              {day}
            </option>
          ))}
        </select>
      </Field>
      <RoomSelect
        label={`${label} 教室`}
        roomId={slot.roomId}
        change={(roomId) => change({ ...slot, roomId })}
      />
      <Field label={`${label} 起始教学周`}>
        <input
          type="number"
          required
          min={1}
          max={54}
          step={1}
          value={slot.fromWeek}
          onChange={(e) => change({ ...slot, fromWeek: Number(e.target.value) })}
        />
      </Field>
      <Field label={`${label} 结束教学周`}>
        <input
          type="number"
          required
          min={1}
          max={54}
          step={1}
          value={slot.toWeek}
          onChange={(e) => change({ ...slot, toWeek: Number(e.target.value) })}
        />
      </Field>
      <Field label={`${label} 单双周`}>
        <select
          value={slot.parity}
          onChange={(e) => change({ ...slot, parity: e.target.value as SchoolSlot["parity"] })}
        >
          <option value="ALL">每周</option>
          <option value="ODD">单周</option>
          <option value="EVEN">双周</option>
        </select>
      </Field>
      <PeriodSelect
        label={`${label} 上课节次`}
        periods={draft.periods}
        selected={slot.periodIds}
        change={(periodIds) => change({ ...slot, periodIds })}
      />
    </Entry>
  );
}
function RoomSelect({
  label,
  roomId,
  change,
}: {
  label: string;
  roomId: string | null;
  change: (roomId: string | null) => void;
}) {
  const { state } = useSchool();
  return (
    <Field label={label}>
      <select value={roomId ?? ""} onChange={(e) => change(e.target.value || null)}>
        <option value="">不指定 / 沿用原教室</option>
        {state.rooms
          .filter((room) => room.active || room.id === roomId)
          .map((room) => (
            <option key={room.id} value={room.id}>
              {room.name}
              {room.active ? "" : "（已停用）"}
            </option>
          ))}
      </select>
    </Field>
  );
}
function CalendarEntry({
  day,
  index,
  change,
  remove,
  disabled,
}: {
  day: SchoolCalendarDay;
  index: number;
  change: (day: SchoolCalendarDay) => void;
  remove: () => void;
  disabled: boolean;
}) {
  const label = `校历调整 ${index + 1}`;
  return (
    <Entry title={label} disabled={disabled} remove={remove}>
      <Field label={`${label} 日期`}>
        <input
          type="date"
          required
          value={day.date}
          onChange={(e) => change({ ...day, date: e.target.value })}
        />
      </Field>
      <Field label={`${label} 类型`}>
        <select
          value={day.kind}
          onChange={(e) =>
            change({ ...day, kind: e.target.value as SchoolCalendarDay["kind"], sourceDate: null })
          }
        >
          <option value="CLOSED">全天停课</option>
          <option value="REPLACE">换日补课</option>
        </select>
      </Field>
      {day.kind === "REPLACE" && (
        <Field label={`${label} 采用哪一天的常规课表`}>
          <input
            type="date"
            required
            value={day.sourceDate ?? ""}
            onChange={(e) => change({ ...day, sourceDate: e.target.value })}
          />
        </Field>
      )}
      <Field label={`${label} 原因`}>
        <input
          required
          maxLength={500}
          value={day.reason}
          onChange={(e) => change({ ...day, reason: e.target.value })}
        />
      </Field>
    </Entry>
  );
}
function OverrideEntry({
  entry,
  index,
  draft,
  offeringName,
  change,
  remove,
  disabled,
}: {
  entry: SchoolLessonOverride;
  index: number;
  draft: SchoolTimetable;
  offeringName: (id: string) => string;
  change: (entry: SchoolLessonOverride) => void;
  remove: () => void;
  disabled: boolean;
}) {
  const { state } = useSchool();
  const label = `调代课 ${index + 1}`;
  // A removed source slot leaves the stored value outside the option set, which the
  // native required check would accept because it is non-empty.
  const dangling = !!entry.slotId && !draft.slots.some((slot) => slot.id === entry.slotId);
  return (
    <Entry title={label} disabled={disabled} remove={remove}>
      <Field label={`${label} 原周课表`}>
        <select
          // While dangling the value cannot become natively valid, so hand validity
          // to the submit guard, which names the entry instead of the browser.
          required={!dangling}
          aria-invalid={dangling || undefined}
          value={entry.slotId}
          onChange={(e) => change({ ...entry, slotId: e.target.value })}
        >
          <option value="">选择原周课表</option>
          {draft.slots.map((slot, i) => (
            <option key={slot.id} value={slot.id}>
              周课表 {i + 1} · {offeringName(slot.offeringId)} · {weekdays[slot.weekday - 1]}
            </option>
          ))}
        </select>
      </Field>
      {dangling && (
        <p className="p-notice error" role="alert">
          {label} 的原周课表已失效，请重选。
        </p>
      )}
      <Field label={`${label} 原定上课日期`}>
        <input
          type="date"
          required
          value={entry.originalDate}
          onChange={(e) => change({ ...entry, originalDate: e.target.value })}
        />
      </Field>
      <Field label={`${label} 操作`}>
        <select
          value={entry.action}
          onChange={(e) =>
            change({
              ...entry,
              action: e.target.value as SchoolLessonOverride["action"],
              date: null,
              periodIds: [],
              teacherId: null,
              roomId: null,
            })
          }
        >
          <option value="CANCEL">取消此次课程</option>
          <option value="MOVE">调课 / 代课</option>
        </select>
      </Field>
      {entry.action === "MOVE" && (
        <>
          <Field label={`${label} 调整后日期`}>
            <input
              type="date"
              required
              value={entry.date ?? ""}
              onChange={(e) => change({ ...entry, date: e.target.value })}
            />
          </Field>
          <Field label={`${label} 代课教师`}>
            <select
              value={entry.teacherId ?? ""}
              onChange={(e) => change({ ...entry, teacherId: e.target.value || null })}
            >
              <option value="">沿用原任课教师</option>
              {state.teachers.map((teacher) => (
                <option key={teacher.id} value={teacher.id}>
                  {teacher.name}
                </option>
              ))}
            </select>
          </Field>
          <RoomSelect
            label={`${label} 调整后教室`}
            roomId={entry.roomId}
            change={(roomId) => change({ ...entry, roomId })}
          />
          <PeriodSelect
            label={`${label} 调整后节次`}
            periods={draft.periods}
            selected={entry.periodIds}
            change={(periodIds) => change({ ...entry, periodIds })}
          />
        </>
      )}
      <Field label={`${label} 原因`}>
        <input
          required
          maxLength={500}
          value={entry.reason}
          onChange={(e) => change({ ...entry, reason: e.target.value })}
        />
      </Field>
    </Entry>
  );
}
