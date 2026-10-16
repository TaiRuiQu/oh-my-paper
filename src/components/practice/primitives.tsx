"use client";
import { useRef, useState, type ComponentProps, type ReactNode } from "react";
import type { PracticeCommand, PracticeCommandResult } from "@/contracts/practice";
import { Panel } from "@/components/platform/primitives";
import { useUnsavedChanges } from "@/components/platform/use-unsaved-changes";
import { usePractice } from "./provider";
import styles from "./practice.module.css";
export function PracticePanel({ children, ...props }: ComponentProps<typeof Panel>) {
  return (
    <Panel {...props}>
      <div className={styles.body}>{children}</div>
    </Panel>
  );
}
export function PracticeForm({
  children,
  label,
  command,
  allowed = true,
  submitDisabled = false,
  dirty: externalDirty = false,
  onSaved,
  close,
}: {
  children: ReactNode;
  label: string;
  command: () => PracticeCommand;
  allowed?: boolean;
  submitDisabled?: boolean;
  dirty?: boolean;
  onSaved?: (result: PracticeCommandResult) => void;
  close?: () => void;
}) {
  const { pending, stale, refresh, write } = usePractice<unknown>();
  const [dirty, setDirty] = useState(false),
    [error, setError] = useState(""),
    [conflict, setConflict] = useState(false);
  const lock = useRef(false);
  const { markSaved, confirmDiscard } = useUnsavedChanges(
    dirty || externalDirty,
    "有未保存的练习修改，离开后会丢失。确定离开？",
  );
  return (
    <>
      {error && (
        <div role="alert" className="p-notice error">
          <p>{error}</p>
          {conflict && (
            <p>资料版本已变化，输入仍保留。请明确重读核对，不会自动使用新版本重复提交。</p>
          )}
          <button
            type="button"
            className="button secondary"
            disabled={pending}
            onClick={async () => {
              if (
                lock.current ||
                ((dirty || externalDirty) &&
                  !window.confirm("重新读取会放弃未保存输入。确定重新读取？"))
              )
                return;
              lock.current = true;
              try {
                await refresh();
                markSaved();
                close?.();
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : "读取失败，输入仍保留。");
              } finally {
                lock.current = false;
              }
            }}
          >
            放弃输入并重新读取
          </button>
        </div>
      )}
      <form
        className="p-form"
        onChange={() => setDirty(true)}
        onSubmit={async (event) => {
          event.preventDefault();
          if (lock.current || pending || stale || !allowed || submitDisabled || conflict) return;
          lock.current = true;
          try {
            const result = await write(command());
            if (result.ok) {
              markSaved();
              setDirty(false);
              onSaved?.(result.result);
              close?.();
            } else {
              setError(result.error);
              setConflict(result.conflict);
            }
          } finally {
            lock.current = false;
          }
        }}
      >
        <fieldset className={styles.formFields} disabled={pending || stale || !allowed}>
          {pending && <p role="status">正在保存，暂时不能编辑。</p>}
          {children}
          <div className="p-actions">
            <button
              className="button"
              type="submit"
              disabled={pending || stale || !allowed || submitDisabled || conflict}
            >
              {pending ? "正在保存…" : label}
            </button>
            {close && (
              <button
                className="button secondary"
                type="button"
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
