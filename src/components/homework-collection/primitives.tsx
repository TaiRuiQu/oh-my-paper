"use client";
import { useRef, useState, type ComponentProps, type ReactNode } from "react";
import type { HomeworkCommand } from "@/contracts/homework";
import { Panel } from "@/components/platform/primitives";
import { useUnsavedChanges } from "@/components/platform/use-unsaved-changes";
import { useHomework } from "./provider";
import styles from "./homework.module.css";
export function HomeworkPanel({ children, ...props }: ComponentProps<typeof Panel>) {
  return (
    <Panel {...props}>
      <div className={styles.body}>{children}</div>
    </Panel>
  );
}
export function HomeworkForm({
  children,
  command,
  allowed = true,
  submitDisabled = false,
  dirty: externalDirty = false,
  label,
  close,
}: {
  children: ReactNode;
  command: (data: FormData) => HomeworkCommand;
  allowed?: boolean;
  submitDisabled?: boolean;
  dirty?: boolean;
  label: string;
  close?: () => void;
}) {
  const { pending, stale, execute, refresh } = useHomework();
  const [dirty, setDirty] = useState(false),
    [error, setError] = useState(""),
    [conflict, setConflict] = useState(false);
  const locked = useRef(false);
  const { markSaved, confirmDiscard } = useUnsavedChanges(
    dirty || externalDirty,
    "有未保存的作业修改，离开后会丢失。确定离开？",
  );
  return (
    <>
      {error && (
        <div className="p-notice error" role="alert">
          <p>{error}</p>
          {conflict && (
            <p>资料版本已变化，本次输入仍保留。请显式重新读取并核对，不会自动使用新版重复提交。</p>
          )}
          <button
            type="button"
            className="button secondary"
            disabled={pending}
            onClick={async () => {
              if (
                locked.current ||
                ((dirty || externalDirty) &&
                  !window.confirm("重新读取将放弃本次未保存输入。确定重新读取？"))
              )
                return;
              locked.current = true;
              try {
                await refresh();
                markSaved();
                setDirty(false);
                setError("");
                setConflict(false);
                close?.();
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : "重读失败，输入仍保留。");
              } finally {
                locked.current = false;
              }
            }}
          >
            放弃输入并重新读取
          </button>
        </div>
      )}
      {pending && <p role="status">正在保存或读取，暂时不能编辑。</p>}
      <form
        className="p-form"
        onChange={() => setDirty(true)}
        onSubmit={async (event) => {
          event.preventDefault();
          if (locked.current || pending || stale || !allowed || submitDisabled || conflict) return;
          const data = new FormData(event.currentTarget);
          locked.current = true;
          try {
            const result = await execute(command(data));
            if (result.ok) {
              markSaved();
              setDirty(false);
              close?.();
            } else {
              setError(result.error);
              setConflict(result.conflict);
            }
          } finally {
            locked.current = false;
          }
        }}
      >
        <fieldset className={styles.formFields} disabled={pending || stale || !allowed}>
          {children}
          <div className="p-actions">
            <button
              type="submit"
              className="button"
              disabled={pending || stale || !allowed || submitDisabled || conflict}
            >
              {pending ? "正在保存…" : label}
            </button>
            {close && (
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
            )}
          </div>
        </fieldset>
      </form>
    </>
  );
}
export const collectionLabel = {
  NOT_SUBMITTED: "未提交",
  SUBMITTED: "已提交",
  RETURNED: "退回待修改",
};
export const participationLabel = {
  REQUIRED: "需要提交",
  ABSENT: "本次缺席",
  EXEMPT: "免交",
  WITHDRAWN: "已退出",
};
