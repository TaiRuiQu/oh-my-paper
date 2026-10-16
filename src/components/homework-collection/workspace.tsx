"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { HomeworkAssignments } from "@/contracts/homework";
import { Field } from "@/components/platform/primitives";
import { apiRequest } from "@/lib/http-client";
import { HomeworkProvider, useHomework } from "./provider";
import { HomeworkIssue } from "./issue";
import { TeacherCollection } from "./teacher";
import { HomeworkHistoryView } from "./history";
import { StudentWork } from "./student-work";
import { HomeworkPanel, collectionLabel, participationLabel } from "./primitives";
import styles from "./homework.module.css";
export function HomeworkCollectionWorkspace({ assessmentId }: { assessmentId: string }) {
  return (
    <div className={styles.workspace}>
      <div className="p-heading">
        <div>
          <h1>作业收交</h1>
          <p>核对学生题面、发放作业，再跟进提交与退回。</p>
        </div>
      </div>
      <HomeworkProvider key={assessmentId} assessmentId={assessmentId}>
        <TeacherWorkspace />
      </HomeworkProvider>
    </div>
  );
}
function TeacherWorkspace() {
  const { data, generation } = useHomework();
  if (data?.kind === "preview") return <HomeworkIssue key={generation} preview={data.preview} />;
  if (data?.kind === "detail" && data.detail.view === "TEACHER")
    return <TeacherCollection detail={data.detail} />;
  return <p role="alert">当前账号无法管理此作业收交。</p>;
}
export function StudentHomeworkWorkspace({ assignmentId }: { assignmentId?: string }) {
  return (
    <div className={styles.workspace}>
      <div className="p-heading">
        <div>
          <h1>{assignmentId ? "我的作业作答" : "我的作业"}</h1>
          <p>领取题目、保存本人草稿，确认提交后保留每次回执。</p>
        </div>
        {assignmentId && (
          <Link className="button secondary" href="/learning/homework">
            返回我的作业
          </Link>
        )}
      </div>
      <HomeworkProvider key={assignmentId ?? "list"} assignmentId={assignmentId}>
        <StudentWorkspace />
      </HomeworkProvider>
    </div>
  );
}
function StudentWorkspace() {
  const { data, generation, pending, refresh } = useHomework();
  const [active, setActive] = useState("");
  // Lives above the StudentList remount (key={generation}) so re-reading the list keeps the filter.
  const [statusFilter, setStatusFilter] = useState("");
  const dirty = useRef(false);
  const onDirty = useCallback((value: boolean) => {
    dirty.current = value;
  }, []);
  const [error, setError] = useState("");
  if (data?.kind === "list" && data.list.view === "STUDENT")
    return (
      <StudentList
        key={generation}
        initial={data.list}
        filter={statusFilter}
        onFilterChange={setStatusFilter}
      />
    );
  if (data?.kind !== "detail" || data.detail.view !== "STUDENT")
    return <p role="alert">当前账号无法领取此作业。</p>;
  const detail = data.detail,
    a = detail.assignment,
    work = detail.works.find((entry) => entry.id === active) ?? detail.works[0],
    paper = a.papers.find((entry) => entry.id === work?.paperId);
  return (
    <>
      <HomeworkPanel
        title={a.name}
        description="题目已按发放时内容冻结。老师未发布成绩前，此处仅显示本人作答与提交状态。"
        actions={
          <button
            type="button"
            className="button secondary"
            disabled={pending}
            onClick={async () => {
              if (
                dirty.current &&
                !window.confirm("重新读取会放弃本次未保存作答与图片。确定重新读取？")
              )
                return;
              try {
                await refresh();
                setError("");
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : "读取失败，作答仍保留。");
              }
            }}
          >
            重新读取本人作业
          </button>
        }
      >
        <p>
          {{ ISSUED: "开放提交", CLOSED: "已关闭提交", CANCELLED: "作业已撤回" }[a.status]} ·{" "}
          {a.allowLate ? "允许迟交并标记" : "超过截止后不可提交"} · 设置版本 v{a.version}
        </p>
        <p className={styles.answer}>{a.instructions || "请按题目要求完成作业。"}</p>
        {error && (
          <p className="p-notice error" role="alert">
            {error}
          </p>
        )}
        {detail.works.length > 1 && (
          <Field label="选择本次作业科目">
            <select
              value={work?.id ?? ""}
              disabled={pending}
              onChange={(event) => {
                if (
                  dirty.current &&
                  !window.confirm("切换科目会放弃本次未保存作答与图片。确定切换？")
                )
                  return;
                setActive(event.target.value);
              }}
            >
              {detail.works.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {a.papers.find((p) => p.id === entry.paperId)?.name ?? "作业"} ·{" "}
                  {entry.participationStatus === "REQUIRED"
                    ? collectionLabel[entry.collectionStatus]
                    : participationLabel[entry.participationStatus]}
                </option>
              ))}
            </select>
          </Field>
        )}
      </HomeworkPanel>
      {work && paper ? (
        <StudentWork
          key={`${generation}/${work.id}/${work.version}/${work.draft.version}`}
          assignment={a}
          work={work}
          paper={paper}
          onDirty={onDirty}
        />
      ) : work ? (
        <HomeworkPanel
          title="本人保留的作业记录"
          description="当前题面已隐藏，已有提交与退回记录仍保留；不恢复已撤回或无需提交的题目。"
        >
          <p>
            {work.participationStatus === "REQUIRED"
              ? collectionLabel[work.collectionStatus]
              : participationLabel[work.participationStatus]}
            {work.participationReason && ` · ${work.participationReason}`}
          </p>
          {work.currentAttempt && (
            <p>
              历史回执：第 {work.currentAttempt.sequence} 次提交 ·{" "}
              {work.currentAttempt.late ? "迟交" : "按时提交"}
              {work.currentAttempt.returnReason &&
                ` · 退回原因：${work.currentAttempt.returnReason}`}
            </p>
          )}
          {work.capabilities.blockReasons.map((reason, index) => (
            <p className={styles.help} key={index}>
              {reason}
            </p>
          ))}
          {work.capabilities.canViewAttemptHistory && (
            <HomeworkHistoryView
              key={`${generation}/${work.id}`}
              assignmentId={a.id}
              workId={work.id}
              timezone={a.timezone}
            />
          )}
          {a.resultsPublished && (
            <p>
              <Link className="button secondary" href={`/learning/results/${a.assessmentId}`}>
                查看老师已发布的完整反馈
              </Link>
            </p>
          )}
        </HomeworkPanel>
      ) : (
        <p className="p-empty">本次暂无需要本人提交的作业科目。</p>
      )}
    </>
  );
}
function StudentList({
  initial,
  filter,
  onFilterChange,
}: {
  initial: Extract<HomeworkAssignments, { view: "STUDENT" }>;
  filter: string;
  onFilterChange: (filter: string) => void;
}) {
  const { refresh, pending: refreshing } = useHomework();
  const [list, setList] = useState(initial),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false),
    request = useRef(0),
    applied = useRef("");
  const [retry, setRetry] = useState(0),
    [loadedFilter, setLoadedFilter] = useState("");
  useEffect(() => {
    if (applied.current === filter && retry === 0) return;
    const controller = new AbortController(),
      token = ++request.current;
    lock.current = true;
    setPending(true);
    setError("");
    const query = new URLSearchParams(filter ? { status: filter } : {});
    void apiRequest<HomeworkAssignments>(
      `/api/platform/homework/assignments${query.size ? `?${query}` : ""}`,
      { signal: controller.signal },
    )
      .then((next) => {
        if (controller.signal.aborted || token !== request.current) return;
        if (next.view !== "STUDENT") throw new Error("当前账号无法读取学生作业。");
        setList(next);
        setLoadedFilter(filter);
        applied.current = filter;
      })
      .catch((cause) => {
        if (!controller.signal.aborted && token === request.current)
          setError(cause instanceof Error ? cause.message : "筛选读取失败，请重试。");
      })
      .finally(() => {
        if (token === request.current) {
          lock.current = false;
          setPending(false);
        }
      });
    return () => controller.abort();
  }, [filter, retry]);
  const entries = loadedFilter === filter ? list.assignments : [];
  return (
    <HomeworkPanel
      title="已发放给我的作业"
      description="只显示本人作业及本人提交状态，截止时间按各作业学校时区显示。"
      actions={
        <button
          type="button"
          className="button secondary"
          disabled={pending || refreshing}
          onClick={async () => {
            try {
              await refresh();
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "读取失败，已显示作业仍保留。");
            }
          }}
        >
          重新读取我的作业列表
        </button>
      }
    >
      <Field label="筛选作业状态">
        <select value={filter} onChange={(event) => onFilterChange(event.target.value)}>
          <option value="">全部作业</option>
          <option value="ISSUED">开放提交</option>
          <option value="CLOSED">已关闭提交</option>
          <option value="CANCELLED">已撤回</option>
        </select>
      </Field>
      {entries.map((a) => (
        <article className={styles.row} key={a.id}>
          <div>
            <h3>
              <Link href={`/learning/homework/${a.id}`}>{a.name}</Link>
            </h3>
            <p>
              {{ ISSUED: "开放提交", CLOSED: "已关闭提交", CANCELLED: "已撤回" }[a.status]} ·{" "}
              {a.dueLocal.replace("T", " ")} · {a.timezone}
            </p>
            {a.works.map((work) => (
              <p key={work.id}>
                {work.participationStatus === "REQUIRED"
                  ? collectionLabel[work.collectionStatus]
                  : participationLabel[work.participationStatus]}
                {work.deadlineOverride && ` · 个人延期至 ${work.dueLocal.replace("T", " ")}`}
                {work.overdue ? " · 已过截止" : ""}
                {work.currentAttempt?.returnReason && ` · ${work.currentAttempt.returnReason}`}
              </p>
            ))}
          </div>
          <Link className="button secondary" href={`/learning/homework/${a.id}`}>
            查看题目与提交
          </Link>
        </article>
      ))}
      {pending && <p role="status">正在读取作业…</p>}
      {!pending && loadedFilter === filter && !entries.length && (
        <p className="p-empty">{filter ? "当前筛选下暂无作业。" : "暂无已发放给本人的作业。"}</p>
      )}
      {error && (
        <p role="alert" className="p-notice error">
          {error}，已显示作业仍保留，可重试。
          <button
            type="button"
            className="button secondary"
            disabled={pending}
            onClick={() => setRetry((value) => value + 1)}
          >
            重新读取筛选作业
          </button>
        </p>
      )}
      {loadedFilter === filter && list.nextBeforeId && (
        <button
          type="button"
          className="button secondary"
          disabled={pending}
          onClick={async () => {
            if (lock.current) return;
            lock.current = true;
            const token = ++request.current;
            setPending(true);
            try {
              const next = await apiRequest<HomeworkAssignments>(
                `/api/platform/homework/assignments?${new URLSearchParams({ beforeId: list.nextBeforeId!, ...(filter ? { status: filter } : {}) })}`,
              );
              if (token !== request.current) return;
              if (next.view !== "STUDENT") throw new Error("当前账号无法读取学生作业。");
              setList((prev) => ({
                ...next,
                assignments: [
                  ...new Map(
                    [...prev.assignments, ...next.assignments].map((a) => [a.id, a]),
                  ).values(),
                ],
              }));
              setError("");
            } catch (cause) {
              if (token === request.current)
                setError(cause instanceof Error ? cause.message : "作业读取失败");
            } finally {
              if (token === request.current) {
                lock.current = false;
                setPending(false);
              }
            }
          }}
        >
          {pending ? "正在读取…" : "读取更早作业"}
        </button>
      )}
    </HomeworkPanel>
  );
}
