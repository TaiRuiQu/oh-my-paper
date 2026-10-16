"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { apiRequest } from "@/lib/http-client";
import { PracticePanel } from "./primitives";
import { PracticeProvider, usePractice } from "./provider";
import styles from "./practice.module.css";
import type { PracticeSources, PracticeSetPreview, PracticeCommand } from "@/contracts/practice";
import { Field } from "@/components/platform/primitives";
import { PublishPractice } from "./teacher";
export function SourceResource({ teacher }: { teacher: boolean }) {
  const { generation } = usePractice<PracticeSources>();
  return <PracticeSourceList key={generation} teacher={teacher} />;
}
function PracticeSourceList({ teacher }: { teacher: boolean }) {
  const { data, pending, stale, refresh, write } = usePractice<PracticeSources>();
  const [studentId, setStudentId] = useState(data.ownStudents[0]?.studentId ?? ""),
    [selectedPaper, setSelectedPaper] = useState(""),
    [error, setError] = useState(""),
    // Per claim target (set/replay paper + student identity), so one successful start
    // never locks the other claimable entries on the page.
    [startedSessions, setStartedSessions] = useState<Record<string, string>>({}),
    [lastStarted, setLastStarted] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [sets, setSets] = useState(data.sets),
    [cursor, setCursor] = useState(data.nextBeforeId),
    [loadingMore, setLoadingMore] = useState(false);
  const [publishPapers, setPublishPapers] = useState(data.publishPapers),
    [replayPapers, setReplayPapers] = useState(data.replayPapers),
    [paperCursor, setPaperCursor] = useState(data.nextPaperBeforeId),
    [loadingPapers, setLoadingPapers] = useState(false);
  const requestIds = useRef(new Map<string, string>()),
    lock = useRef(false),
    paperLock = useRef(false);
  async function start(
    key: string,
    source: Extract<PracticeCommand, { type: "practice.start" }>["source"],
  ) {
    if (lock.current || pending || stale || !studentId) return;
    lock.current = true;
    let requestId = requestIds.current.get(key);
    if (!requestId) {
      requestId = crypto.randomUUID();
      requestIds.current.set(key, requestId);
    }
    try {
      const result = await write({ type: "practice.start", source, requestId });
      if (result.ok) {
        const sessionId = result.result.sessionId ?? result.result.id;
        setStartedSessions((previous) => ({ ...previous, [key]: sessionId }));
        setLastStarted(sessionId);
        setError("");
      } else setError(result.error);
    } finally {
      lock.current = false;
    }
  }
  return (
    <>
      <PracticePanel
        title={teacher ? "发布练习与题本目录" : "可领取的练习"}
        description={
          teacher
            ? "选择自有题本，逐张确认学生可见图片后发布到当前授权班级。"
            : "领取不会自动提交；开始后进入本人私人草稿。原题复习和新题参考记录会明确区分。"
        }
        actions={
          <button
            type="button"
            className="button secondary"
            disabled={pending || publishing || loadingMore || loadingPapers}
            onClick={async () => {
              if (selectedPaper && !window.confirm("重新读取会关闭当前题本选择。确定重新读取？"))
                return;
              try {
                await refresh();
                setSelectedPaper("");
                setError("");
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : "读取失败");
              }
            }}
          >
            重新读取可用练习
          </button>
        }
      >
        {error && (
          <p className="p-notice error" role="alert">
            {error}
          </p>
        )}
        {lastStarted && (
          <p role="status" className="p-notice">
            练习已建立，<Link href={`/learning/practice/${lastStarted}`}>打开本人练习继续作答</Link>
            ；同一份无需重复领取，可直接继续领取其他练习或复习卷。
          </p>
        )}
        {!teacher && (
          <>
            {data.ownStudents.length > 1 && (
              <Field label="本次练习学生身份">
                <select
                  value={studentId}
                  disabled={pending}
                  onChange={(event) => setStudentId(event.target.value)}
                >
                  {data.ownStudents.map((student) => (
                    <option key={student.studentId} value={student.studentId}>
                      {student.classroomName} · {student.name} · {student.studentNumber}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {!data.ownStudents.length && (
              <p className="p-notice">
                当前账号尚无本人学生身份，请联系教师或管理员绑定；不显示全校学生目录。
              </p>
            )}
          </>
        )}
        {teacher && data.canPublish && (
          <Field label="选择自有题本发布">
            <select
              value={selectedPaper}
              disabled={pending || publishing}
              onChange={(event) => {
                if (
                  selectedPaper &&
                  !window.confirm("切换题本会关闭当前发布表单；未保存内容将丢失。确定切换？")
                )
                  return;
                setSelectedPaper(event.target.value);
              }}
            >
              <option value="">请选择题本</option>
              {publishPapers.map((paper) => (
                <option value={paper.id} key={paper.id}>
                  {paper.name} · {paper.subject} · {paper.itemCount}题
                </option>
              ))}
            </select>
          </Field>
        )}
        {teacher && !data.canPublish && (
          <p className="p-notice">当前账号无练习发布权限；仍可按当前班级学科授权核验提交。</p>
        )}
        {sets.map((set) => {
          const startKey = `set/${set.id}/${studentId}`;
          return (
            <article className={styles.row} key={set.id}>
              <div>
                <h3>{set.name}</h3>
                <p>
                  {set.classroomName} · {set.subject} · {set.itemCount}题 ·{" "}
                  {set.status === "OPEN" ? "开放领取" : "已关闭新领取"}
                </p>
                {set.blockReasons.map((reason, index) => (
                  <p className={styles.help} key={index}>
                    {reason}
                  </p>
                ))}
              </div>
              {teacher ? (
                <Link className="button secondary" href={`/homework/practice/${set.id}`}>
                  查看发布状态
                </Link>
              ) : (
                <button
                  className="button"
                  type="button"
                  disabled={
                    pending || stale || !set.canStart || !studentId || !!startedSessions[startKey]
                  }
                  onClick={() =>
                    void start(startKey, {
                      kind: "SET",
                      setId: set.id,
                      expectedVersion: set.version,
                      studentId,
                    })
                  }
                >
                  领取并开始{set.name}
                </button>
              )}
            </article>
          );
        })}
        {!sets.length && <p className="p-empty">暂无可用的已发布练习。</p>}
        {!teacher && (replayPapers.length > 0 || paperCursor) && (
          <section className={styles.section}>
            <h3>本人保存的复习卷</h3>
            <p className={styles.help}>
              这类题本可能已经提供参考答案，按复现或历史未知情况记录，不冒充独立新题。
            </p>
            {replayPapers.map((paper) => {
              const startKey = `replay/${paper.id}/${studentId}`;
              return (
                <article className={styles.row} key={paper.id}>
                  <div>
                    <h4>{paper.name}</h4>
                    <p>
                      {paper.subject} · {paper.itemCount}题
                    </p>
                  </div>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={pending || stale || !studentId || !!startedSessions[startKey]}
                    onClick={() =>
                      void start(startKey, {
                        kind: "REPLAY",
                        paperId: paper.id,
                        expectedPaperUpdatedAt: paper.updatedAt,
                        studentId,
                      })
                    }
                  >
                    开始复现{paper.name}
                  </button>
                </article>
              );
            })}
          </section>
        )}
        {paperCursor && (
          <button
            type="button"
            className="button secondary"
            disabled={pending || publishing || loadingPapers}
            onClick={async () => {
              if (paperLock.current) return;
              paperLock.current = true;
              setLoadingPapers(true);
              try {
                const next = await apiRequest<PracticeSources>(
                  `/api/platform/practice/sources?${new URLSearchParams({ paperBeforeId: paperCursor })}`,
                );
                setPublishPapers((previous) => [
                  ...new Map(
                    [...previous, ...next.publishPapers].map((paper) => [paper.id, paper]),
                  ).values(),
                ]);
                setReplayPapers((previous) => [
                  ...new Map(
                    [...previous, ...next.replayPapers].map((paper) => [paper.id, paper]),
                  ).values(),
                ]);
                setPaperCursor(next.nextPaperBeforeId);
                setError("");
              } catch (cause) {
                setError(
                  cause instanceof Error ? cause.message : "读取失败，原题本目录与草稿仍保留。",
                );
              } finally {
                paperLock.current = false;
                setLoadingPapers(false);
              }
            }}
          >
            {teacher ? "读取更多自有题本" : "读取更多本人复习卷"}
          </button>
        )}
      </PracticePanel>
      {teacher && selectedPaper && (
        <PracticeProvider
          key={selectedPaper}
          onPendingChange={setPublishing}
          path={`/api/platform/practice/sets/${selectedPaper}/preview`}
        >
          <PublishResource />
        </PracticeProvider>
      )}
      {cursor && (
        <button
          type="button"
          className="button secondary"
          disabled={pending || loadingMore}
          onClick={async () => {
            if (lock.current) return;
            lock.current = true;
            setLoadingMore(true);
            try {
              const next = await apiRequest<{
                sets: PracticeSources["sets"];
                nextBeforeId: string | null;
              }>(`/api/platform/practice/sets?${new URLSearchParams({ beforeId: cursor })}`);
              setSets((previous) => [
                ...new Map([...previous, ...next.sets].map((set) => [set.id, set])).values(),
              ]);
              setCursor(next.nextBeforeId);
              setError("");
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "读取失败，原目录仍保留。");
            } finally {
              lock.current = false;
              setLoadingMore(false);
            }
          }}
        >
          读取更多已发布练习
        </button>
      )}
    </>
  );
}
function PublishResource() {
  const { data, generation } = usePractice<PracticeSetPreview>();
  return <PublishPractice key={`${generation}/${data.paper.updatedAt}`} preview={data} />;
}
