"use client";
import { useEffect, useRef, useState } from "react";
import type {
  TeachingPermissionsHistory,
  TeachingPermissionsSnapshot,
} from "@/contracts/permissions";
import type { Classroom } from "@/contracts/platform";
import { apiRequest } from "@/lib/http-client";
import { assignmentLabel } from "./teaching-permissions";
import styles from "./permission-history.module.css";
export function PermissionHistory({
  userId,
  name,
  classrooms,
  onClose,
}: {
  userId: string;
  name: string;
  classrooms: Classroom[];
  onClose: () => void;
}) {
  const [data, setData] = useState<TeachingPermissionsHistory | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [attempt, setAttempt] = useState(0);
  const lock = useRef(false);
  const pageReader = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    lock.current = true;
    apiRequest<TeachingPermissionsHistory>(
      `/api/platform/admin/permissions/${encodeURIComponent(userId)}/history`,
      { signal: controller.signal },
    )
      .then((value) => {
        if (!controller.signal.aborted) {
          setData(value);
          setError("");
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "权限历史读取失败。");
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          lock.current = false;
          setLoading(false);
        }
      });
    return () => {
      controller.abort();
      pageReader.current?.abort();
    };
  }, [userId, attempt]);
  const role = (value: TeachingPermissionsSnapshot["role"]) =>
    ({ ADMIN: "管理员", TEACHER: "教师", STUDENT: "学生" })[value];
  const snapshot = (value: TeachingPermissionsSnapshot) => (
    <>
      <p>账号角色：{role(value.role)}</p>
      {value.assignments.length ? (
        <ul>
          {value.assignments.map((entry, index) => (
            <li key={index}>{assignmentLabel(entry, classrooms)}</li>
          ))}
        </ul>
      ) : (
        <p>无教学身份</p>
      )}
    </>
  );
  return (
    <section className={`p-panel-content ${styles.history}`} aria-label={`${name}的权限变更历史`}>
      <header className={styles.heading}>
        <div>
          <h3>{name}的权限与角色变更历史</h3>
          <p className={styles.description}>
            仅记录已启用审计后的明确变更，空历史不代表从未分配权限。记录中的操作者和原因按变更时保留。
          </p>
        </div>
        <button type="button" className="button secondary" onClick={onClose}>
          关闭变更历史
        </button>
      </header>
      {error && (
        <div role="alert" className="p-notice error">
          <p>{error}</p>
          <button
            type="button"
            className="button secondary"
            disabled={loading}
            onClick={() => {
              setError("");
              setLoading(true);
              setAttempt((value) => value + 1);
            }}
          >
            重新读取变更历史
          </button>
        </div>
      )}
      {!data && !error && <p role="status">正在读取变更历史…</p>}
      {data && (
        <>
          <p className={styles.version}>
            当前权限版本 <strong>v{data.user.permissionsVersion}</strong>
          </p>
          {!data.events.length && <p>暂无已记录的权限变更。</p>}
          <div className={styles.events}>
            {data.events.map((event) => (
              <article className={styles.event} key={event.id}>
                <header className={styles.eventHeading}>
                  <h4>
                    v{event.version} ·{" "}
                    {
                      {
                        "user.role": "账号角色变更",
                        "user.permissions": "教学权限变更",
                        "classroom.save": "新建班级自动配置身份",
                      }[event.type]
                    }
                  </h4>
                  <p className={styles.time}>
                    <time dateTime={event.createdAt}>
                      {new Date(event.createdAt).toLocaleString("zh-CN")}
                    </time>
                  </p>
                </header>
                <dl className={styles.metadata}>
                  <div>
                    <dt>操作人</dt>
                    <dd>{event.actorName}</dd>
                  </div>
                  <div>
                    <dt>目标账号</dt>
                    <dd>{event.targetName}</dd>
                  </div>
                  <div className={styles.reason}>
                    <dt>变更原因</dt>
                    <dd>{event.reason}</dd>
                  </div>
                </dl>
                <details className={styles.details}>
                  <summary>查看变更前后权限 v{event.version}</summary>
                  <div className={styles.comparison}>
                    <section className={styles.snapshot} aria-label={`v${event.version}变更前`}>
                      <h5>变更前</h5>
                      {snapshot(event.before)}
                    </section>
                    <section className={styles.snapshot} aria-label={`v${event.version}变更后`}>
                      <h5>变更后</h5>
                      {snapshot(event.after)}
                    </section>
                  </div>
                </details>
              </article>
            ))}
          </div>
          {data.nextBeforeId && (
            <div className="p-actions">
              <button
                type="button"
                className="button secondary"
                disabled={loading}
                onClick={async () => {
                  if (lock.current || !data.nextBeforeId) return;
                  lock.current = true;
                  setLoading(true);
                  setError("");
                  const controller = new AbortController();
                  pageReader.current = controller;
                  try {
                    const page = await apiRequest<TeachingPermissionsHistory>(
                      `/api/platform/admin/permissions/${encodeURIComponent(userId)}/history?${new URLSearchParams({ beforeId: data.nextBeforeId })}`,
                      { signal: controller.signal },
                    );
                    if (controller.signal.aborted) return;
                    setData((previous) =>
                      previous
                        ? {
                            ...page,
                            events: [
                              ...previous.events,
                              ...page.events.filter(
                                (event) => !previous.events.some((old) => old.id === event.id),
                              ),
                            ],
                          }
                        : page,
                    );
                  } catch (cause) {
                    if (!controller.signal.aborted)
                      setError(
                        cause instanceof Error
                          ? cause.message
                          : "更早历史读取失败，已读取记录仍保留。",
                      );
                  } finally {
                    if (!controller.signal.aborted) {
                      lock.current = false;
                      setLoading(false);
                    }
                  }
                }}
              >
                {loading ? "正在读取…" : "读取更早变更"}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
