"use client";
import { useRef, useState, type ReactNode } from "react";
import type { TeachingCommand } from "@/contracts/teaching";
import { useUnsavedChanges } from "@/components/platform/use-unsaved-changes";
import { useTeaching } from "./provider";

export function TeachingActionForm({
  children,
  command,
  allowed = true,
  submitDisabled = false,
  dirty: draftDirty = false,
  submitLabel,
  onSaved,
  onReload,
  onCancel,
}: {
  children: ReactNode;
  command: (data: FormData) => TeachingCommand;
  allowed?: boolean;
  submitDisabled?: boolean;
  dirty?: boolean;
  submitLabel: string;
  onSaved?: () => void;
  onReload?: () => void;
  onCancel?: () => void;
}) {
  const { pending, stale, execute, refresh } = useTeaching();
  const [dirty, setDirty] = useState(false),
    [error, setError] = useState(""),
    [conflict, setConflict] = useState(false);
  const lock = useRef(false);
  const { markSaved, confirmDiscard } = useUnsavedChanges(
    dirty || draftDirty,
    "有未保存的教学修改，离开后会丢失。确定离开？",
  );
  return (
    <>
      {error && (
        <div className="p-notice error" role="alert">
          <p>{error}</p>
          {conflict && (
            <p>资料版本已变化，当前草稿仍保留。请重新读取并核对，系统不会自动重放本次提交。</p>
          )}
          <button
            type="button"
            className="button secondary"
            disabled={pending}
            onClick={async () => {
              if (
                lock.current ||
                ((dirty || draftDirty) &&
                  !window.confirm("重新读取将放弃本次未保存的教学修改。确定重新读取？"))
              )
                return;
              lock.current = true;
              try {
                await refresh();
                markSaved();
                setDirty(false);
                setError("");
                setConflict(false);
                onReload?.();
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : "读取失败，草稿已保留。");
              } finally {
                lock.current = false;
              }
            }}
          >
            放弃草稿并重新读取
          </button>
        </div>
      )}
      {pending && <p role="status">正在处理，暂时不能编辑，请稍候。</p>}
      <form
        className="p-form"
        inert={pending || stale || !allowed}
        onChange={() => setDirty(true)}
        onSubmit={async (event) => {
          event.preventDefault();
          if (lock.current || pending || stale || !allowed || submitDisabled || conflict) return;
          const data = new FormData(event.currentTarget);
          lock.current = true;
          try {
            const result = await execute(command(data));
            if (result.ok) {
              markSaved();
              setDirty(false);
              setError("");
              onSaved?.();
            } else {
              setError(result.error);
              setConflict(result.conflict);
            }
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "保存失败，请重试。");
          } finally {
            lock.current = false;
          }
        }}
      >
        {children}
        <div className="p-actions">
          <button
            type="submit"
            className="button"
            disabled={pending || stale || !allowed || submitDisabled || conflict}
          >
            {pending ? "正在保存…" : submitLabel}
          </button>
          {onCancel && (
            <button
              type="button"
              className="button secondary"
              disabled={pending}
              onClick={() => {
                if (confirmDiscard()) onCancel();
              }}
            >
              取消编辑
            </button>
          )}
        </div>
      </form>
    </>
  );
}
