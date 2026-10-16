"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { RECORD_NAME_MAX_LENGTH } from "@/contracts/platform";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDomain } from "./domain-provider";
import styles from "./record-name-editor.module.css";

export function RecordNameEditor({
  record,
  kind,
  noun,
  href,
  heading = false,
}: {
  record: { id: string; ownerId: string; name: string; canManage?: boolean };
  kind: "paper" | "assessment";
  noun: string;
  href?: string;
  heading?: boolean;
}) {
  const { state, pending, mutate } = useDomain();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(record.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const canRename =
    kind === "assessment"
      ? record.canManage === true
      : state.actor.role === "ADMIN" ||
        (state.actor.role === "TEACHER" && state.actor.id === record.ownerId);
  const busy = pending || saving;

  useEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    } else if (restoreFocus.current) {
      trigger.current?.focus();
      restoreFocus.current = false;
    }
  }, [editing]);

  async function save() {
    if (busy) return;
    const next = name.trim();
    if (!next || next.length > RECORD_NAME_MAX_LENGTH) {
      setError(!next ? "请输入名称。" : `名称不能超过 ${RECORD_NAME_MAX_LENGTH} 字。`);
      input.current?.focus();
      return;
    }
    if (next === record.name) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const result = await mutate({
        type: kind === "paper" ? "paper.rename" : "assessment.rename",
        id: record.id,
        name: next,
      });
      if (result.error) setError(result.error);
      else setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "重命名失败，请重试。");
    } finally {
      setSaving(false);
    }
  }

  if (editing && canRename)
    return (
      <form
        className={`${styles.editor} ${heading ? styles.headingEditor : ""}`}
        aria-label={`重命名${noun}`}
        aria-busy={busy}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) {
            event.preventDefault();
            setEditing(false);
          }
        }}
      >
        <label htmlFor={inputId}>{noun}名称</label>
        <Input
          ref={input}
          id={inputId}
          value={name}
          maxLength={RECORD_NAME_MAX_LENGTH}
          disabled={busy}
          aria-invalid={!!error}
          aria-describedby={`${inputId}-hint${error ? ` ${inputId}-error` : ""}`}
          onChange={(event) => {
            setName(event.target.value);
            setError("");
          }}
        />
        <div className={styles.actions}>
          <Button type="submit" size="sm" disabled={busy}>
            {busy ? "正在保存…" : "保存名称"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => setEditing(false)}
          >
            取消
          </Button>
        </div>
        <small id={`${inputId}-hint`}>
          {kind === "paper" ? `用于${noun}列表与打印标题。` : `用于本次${noun}与成绩报告。`}
        </small>
        {error && (
          <span className={styles.error} id={`${inputId}-error`} role="alert">
            {error}
          </span>
        )}
      </form>
    );

  const title = href ? (
    <Link href={href}>
      <strong>{record.name}</strong>
    </Link>
  ) : (
    record.name
  );
  return (
    <div className={styles.name}>
      {heading ? <h1>{title}</h1> : <span className={styles.label}>{title}</span>}
      {canRename && (
        <Button
          ref={trigger}
          type="button"
          variant="ghost"
          size="sm"
          className={styles.trigger}
          aria-label={`重命名${noun}「${record.name}」`}
          disabled={busy}
          onClick={() => {
            setName(record.name);
            setError("");
            restoreFocus.current = true;
            setEditing(true);
          }}
        >
          <Pencil aria-hidden="true" />
          重命名
        </Button>
      )}
    </div>
  );
}
