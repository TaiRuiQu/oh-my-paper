"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { SchoolLesson, SchoolSchedule, SchoolState } from "@/contracts/school";
import type { TeachingSessions } from "@/contracts/teaching";
import { PageHeader } from "@/components/platform/page-header";
import { Field } from "@/components/platform/primitives";
import { schoolToday } from "@/components/school/schedule";
import { apiRequest } from "@/lib/http-client";
import { TeachingPanel } from "./panel";
import { useTeaching } from "./provider";
import { sessionLabels } from "./records";
import styles from "./teaching.module.css";

export function TeachingList() {
  const { list, pending, stale, execute, refresh } = useTeaching();
  const router = useRouter();
  const [school, setSchool] = useState<SchoolState | null>(null),
    [schoolError, setSchoolError] = useState(""),
    [schoolAttempt, setSchoolAttempt] = useState(0);
  const [termId, setTermId] = useState(""),
    [date, setDate] = useState("");
  const [schedule, setSchedule] = useState<{
      key: string;
      data?: SchoolSchedule;
      error?: string;
    } | null>(null),
    [attempt, setAttempt] = useState(0);
  const [error, setError] = useState(""),
    [older, setOlder] = useState<TeachingSessions | null>(null),
    [olderSource, setOlderSource] = useState(list),
    [loadingOlderFor, setLoadingOlderFor] = useState<TeachingSessions | null>(null);
  const prepareLock = useRef(false);
  const olderController = useRef<AbortController | null>(null),
    olderGeneration = useRef(0);
  const loadingOlder = !!list && loadingOlderFor === list;
  const term =
    school?.terms.find((entry) => entry.id === termId) ??
    school?.terms.find((entry) => {
      const today = schoolToday(entry.timezone);
      return !entry.archived && entry.startDate <= today && entry.endDate >= today;
    }) ??
    school?.terms.find((entry) => !entry.archived) ??
    school?.terms[0];
  const actualDate = date || (term ? schoolToday(term.timezone) : "");
  const key = `${term?.id}/${actualDate}/${attempt}`;
  if (olderSource !== list) {
    setOlderSource(list);
    setOlder(null);
  }
  useEffect(
    () => () => {
      olderGeneration.current++;
      olderController.current?.abort();
      olderController.current = null;
    },
    [list],
  );
  useEffect(() => {
    const controller = new AbortController();
    apiRequest<SchoolState>("/api/platform/school/state", { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) {
          setSchool(result);
          setSchoolError("");
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setSchoolError(cause instanceof Error ? cause.message : "已发布学期读取失败。");
      });
    return () => controller.abort();
  }, [schoolAttempt]);
  useEffect(() => {
    if (!term || !actualDate) return;
    const controller = new AbortController();
    apiRequest<SchoolSchedule>(
      `/api/platform/school/schedule?${new URLSearchParams({ termId: term.id, startDate: actualDate, endDate: actualDate })}`,
      { signal: controller.signal },
    )
      .then((data) => {
        if (!controller.signal.aborted) setSchedule({ key, data });
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setSchedule({
            key,
            error: cause instanceof Error ? cause.message : "已发布课程读取失败。",
          });
      });
    return () => controller.abort();
  }, [term, actualDate, key]);
  const current = schedule?.key === key ? schedule : null;
  const groups = new Map<string, SchoolLesson[]>();
  for (const lesson of current?.data?.lessons ?? []) {
    const groupKey = `${lesson.slotId}/${lesson.originalDate}`;
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), lesson]);
  }
  const saved = [...(list?.sessions ?? []), ...(older?.sessions ?? [])];
  return (
    <>
      <PageHeader
        title="备课与授课"
        description="从已发布课程开始备课，确认名单、点名并记录真实授课过程。人工备课可独立完成。"
        back={{ href: "/school", label: "教学安排" }}
        actions={
          <button
            type="button"
            className="button secondary"
            disabled={pending}
            onClick={async () => {
              olderGeneration.current++;
              olderController.current?.abort();
              olderController.current = null;
              setLoadingOlderFor(null);
              try {
                await refresh();
                setError("");
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : "教学记录读取失败。");
              }
            }}
          >
            重新读取教学记录
          </button>
        }
      />
      {error && (
        <p className="p-notice error" role="alert">
          {error}
        </p>
      )}
      <TeachingPanel
        title="从已发布课程开始"
        description="连堂的多个节次共用一次备课和点名；调课仍保留原课堂标识。"
      >
        {schoolError ? (
          <div className="p-notice error" role="alert">
            <p>{schoolError}</p>
            <button
              type="button"
              className="button secondary"
              onClick={() => setSchoolAttempt((value) => value + 1)}
            >
              重试读取已发布学期
            </button>
          </div>
        ) : !school ? (
          <p role="status">正在读取已发布学期…</p>
        ) : !term ? (
          <p className="p-empty">暂无可查看的已发布课程，请联系教务管理人员。</p>
        ) : (
          <>
            <div className={styles.toolbar}>
              <Field label="授课所属学期">
                <select
                  disabled={pending}
                  value={term.id}
                  onChange={(event) => {
                    setTermId(event.target.value);
                    setDate("");
                  }}
                >
                  {school.terms.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="查看授课日期">
                <input
                  type="date"
                  required
                  value={actualDate}
                  disabled={pending}
                  onChange={(event) => {
                    if (event.target.value) setDate(event.target.value);
                  }}
                />
              </Field>
              <button
                type="button"
                className="button secondary"
                disabled={pending}
                onClick={() => {
                  setDate(schoolToday(term.timezone));
                  setAttempt((value) => value + 1);
                }}
              >
                学校时区今天
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={pending}
                onClick={() => setAttempt((value) => value + 1)}
              >
                重新读取课程
              </button>
            </div>
            <p className={styles.help}>
              {term.timezone} · {actualDate}
            </p>
            {term.archived && (
              <p className="p-notice">
                本学期已归档，可查看已发布课程和已有课堂记录，不能建立新课堂。
              </p>
            )}
            {!current ? (
              <p role="status">正在读取当天已发布课程…</p>
            ) : current.error ? (
              <p role="alert" className="p-notice error">
                {current.error}。请重新读取课程。
              </p>
            ) : current.data?.status === "UNPUBLISHED" ? (
              <p className="p-empty">本学期课表尚未发布。</p>
            ) : !groups.size ? (
              <p className="p-empty">当天没有可查看的已发布课程。可切换日期查看其他课程。</p>
            ) : (
              [...groups.entries()].map(([groupKey, lessons]) => {
                const active = lessons.filter((lesson) => lesson.status === "SCHEDULED"),
                  first = active[0] ?? lessons[0];
                const existing = saved.find(
                  (session) =>
                    session.termId === first.termId &&
                    session.slotId === first.slotId &&
                    session.originalDate === first.originalDate,
                );
                return (
                  <div className={styles.row} key={groupKey}>
                    <div>
                      <strong>
                        {first.courseName} · {first.classroomName}
                      </strong>
                      <p>
                        {first.teacherName} ·{" "}
                        {(active.length ? active : lessons)
                          .map((lesson) => `${lesson.startTime}–${lesson.endTime}`)
                          .join("、")}{" "}
                        · 发布 v{current.data?.revision}
                      </p>
                      {!active.length && <p>本次安排已取消{first.reason && `：${first.reason}`}</p>}
                    </div>
                    {existing ? (
                      <Link className="button secondary" href={`/school/teaching/${existing.id}`}>
                        进入课堂记录
                      </Link>
                    ) : (
                      <button
                        type="button"
                        className="button"
                        disabled={
                          pending ||
                          stale ||
                          term.archived ||
                          !active.length ||
                          !current.data?.publicationId
                        }
                        onClick={async () => {
                          if (prepareLock.current || !current.data?.publicationId) return;
                          prepareLock.current = true;
                          try {
                            const result = await execute({
                              type: "teaching.session.prepare",
                              termId: first.termId,
                              slotId: first.slotId,
                              originalDate: first.originalDate,
                              publicationId: current.data.publicationId,
                            });
                            if (result.ok) router.push(`/school/teaching/${result.result.id}`);
                            else setError(result.error);
                          } finally {
                            prepareLock.current = false;
                          }
                        }}
                      >
                        建立本次课堂并备课
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </>
        )}
      </TeachingPanel>
      <TeachingPanel
        title="已建立的课堂记录"
        description="包含备课中、授课中和已结束课堂；历史记录不因课表重新发布而消失。"
      >
        {!list ? (
          <p className="p-empty">教学记录暂未读取，请重新读取教学记录。</p>
        ) : !saved.length ? (
          <p className="p-empty">尚未建立课堂。先从上方已发布课程建立本次课堂。</p>
        ) : (
          saved.map((session) => {
            const lesson =
              session.binding.lessons.find((entry) => entry.status === "SCHEDULED") ??
              session.binding.lessons[0];
            return (
              <div className={styles.row} key={session.id}>
                <div>
                  <strong>
                    {lesson?.courseName ?? "课堂"} · {lesson?.classroomName}
                  </strong>
                  <p>
                    {lesson?.date ?? session.originalDate} · {sessionLabels[session.status]} · 教案{" "}
                    {session.confirmedPlanVersion === null
                      ? "待确认"
                      : `已确认 v${session.confirmedPlanVersion}`}{" "}
                    · 名单{session.rosterConfirmed ? "已确认" : "待核对"}
                  </p>
                  {session.scheduleChanged && <p>课程安排已变化，需核对</p>}
                </div>
                <Link className="button secondary" href={`/school/teaching/${session.id}`}>
                  查看备课与授课
                </Link>
              </div>
            );
          })
        )}
        {(older ? older.nextBeforeId : list?.nextBeforeId) && (
          <button
            type="button"
            className="button secondary"
            disabled={loadingOlder || pending}
            onClick={async () => {
              if (!list || olderController.current || pending) return;
              const source = list;
              const controller = new AbortController();
              olderController.current = controller;
              const generation = ++olderGeneration.current;
              setLoadingOlderFor(source);
              try {
                const next = await apiRequest<TeachingSessions>(
                  `/api/platform/teaching/sessions?${new URLSearchParams({ beforeId: (older ? older.nextBeforeId : list?.nextBeforeId)!, limit: "50" })}`,
                  { signal: controller.signal },
                );
                if (controller.signal.aborted || generation !== olderGeneration.current) return;
                setOlder((previous) => {
                  const previousRows = previous?.sessions ?? [];
                  const ids = new Set(
                    [...source.sessions, ...previousRows].map((session) => session.id),
                  );
                  return {
                    ...next,
                    sessions: [
                      ...previousRows,
                      ...next.sessions.filter((session) => {
                        if (ids.has(session.id)) return false;
                        ids.add(session.id);
                        return true;
                      }),
                    ],
                  };
                });
                setError("");
              } catch (cause) {
                if (!controller.signal.aborted && generation === olderGeneration.current)
                  setError(cause instanceof Error ? cause.message : "读取更早课堂失败。");
              } finally {
                if (olderController.current === controller) {
                  olderController.current = null;
                  setLoadingOlderFor(null);
                }
              }
            }}
          >
            读取更早课堂
          </button>
        )}
      </TeachingPanel>
    </>
  );
}
