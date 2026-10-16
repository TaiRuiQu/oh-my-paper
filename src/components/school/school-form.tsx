"use client";

import { useRef, useState, type ReactNode } from "react";
import type { SchoolCommand } from "@/contracts/school";
import { Submit } from "@/components/platform/primitives";
import { useUnsavedChanges } from "@/components/platform/use-unsaved-changes";
import { useSchool } from "./school-provider";
import styles from "./school.module.css";

export function SchoolForm({
  children,
  command,
  close,
  title,
}: {
  children: ReactNode;
  command: (data: FormData) => SchoolCommand;
  close: () => void;
  title: string;
}) {
  const { pending, stale, refresh, execute, state } = useSchool();
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const locked = useRef(false);
  const { markSaved, confirmDiscard } = useUnsavedChanges(
    dirty,
    "有未保存的教务修改，离开后会丢失。确定离开？",
  );
  return (
    <section className={styles.editor} aria-label={title}>
      <h3>{title}</h3>
      {error && (
        <div className="p-notice error" role="alert">
          <p>{error}</p>
          {conflict && (
            <p>资料版本已经变化。本次草稿已保留，请重新读取后核对，系统不会自动重放本次提交。</p>
          )}
          <button
            type="button"
            className="button secondary"
            disabled={pending}
            onClick={async () => {
              if (
                locked.current ||
                (dirty && !window.confirm("重新读取会放弃本次未保存的教务修改。确定重新读取？"))
              )
                return;
              locked.current = true;
              try {
                await refresh();
                markSaved();
                close();
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : "读取失败，草稿仍保留，请重试。");
              } finally {
                locked.current = false;
              }
            }}
          >
            放弃草稿并重新读取
          </button>
        </div>
      )}
      {pending && <p role="status">正在保存或读取，暂时不能编辑，请稍候。</p>}
      <form
        className="p-form"
        inert={pending || stale || !state.canManage}
        onChange={() => setDirty(true)}
        onSubmit={async (event) => {
          event.preventDefault();
          if (locked.current || pending || stale || conflict || !state.canManage) return;
          const data = new FormData(event.currentTarget);
          locked.current = true;
          try {
            const result = await execute(command(data));
            if (result.ok) {
              markSaved();
              close();
            } else {
              setError(result.error);
              setConflict(result.conflict);
            }
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "保存失败，请重试。");
          } finally {
            locked.current = false;
          }
        }}
      >
        {children}
        <div className="p-actions">
          <Submit pending={pending} disabled={stale || conflict || !state.canManage}>
            保存{title.replace(/^(新建|编辑)/, "")}
          </Submit>
          <button
            type="button"
            className="button secondary"
            disabled={pending}
            onClick={() => {
              if (confirmDiscard()) close();
            }}
          >
            取消编辑
          </button>
        </div>
      </form>
    </section>
  );
}

export const textValue = (data: FormData, key: string) => String(data.get(key) ?? "").trim();
