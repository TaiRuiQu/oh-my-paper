"use client";

import { useId, useRef, type ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
import styles from "./editable-list.module.css";

export function EditableList<T>({
  label,
  itemLabel,
  values,
  onChange,
  createItem,
  renderItem,
  min = 0,
  max = 100,
  disabled = false,
  hint,
}: {
  label: string;
  itemLabel: string;
  values: T[];
  onChange: (values: T[]) => void;
  createItem: () => T;
  renderItem: (value: T, index: number, update: (value: T) => void) => ReactNode;
  min?: number;
  max?: number;
  disabled?: boolean;
  hint?: string;
}) {
  const id = useId();
  const rows = useRef<HTMLDivElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const focusRow = (index: number) =>
    requestAnimationFrame(() => {
      const row = rows.current?.children[index];
      const target = row?.querySelector<HTMLElement>("input, textarea, button");
      (target ?? addButton.current)?.focus();
    });
  return (
    <div
      className={styles.editor}
      role="group"
      aria-labelledby={id}
      aria-describedby={hint ? `${id}-hint` : undefined}
    >
      <div id={id} className={styles.heading}>
        {label}
      </div>
      {hint && (
        <p id={`${id}-hint`} className={styles.hint}>
          {hint}
        </p>
      )}
      <div className={styles.rows} ref={rows}>
        {values.map((value, index) => (
          <div className={styles.row} key={index}>
            <div className={styles.fields}>
              {renderItem(value, index, (next) =>
                onChange(values.map((item, i) => (i === index ? next : item))),
              )}
            </div>
            <button
              type="button"
              className={styles.remove}
              disabled={disabled || values.length <= min}
              aria-label={`删除${itemLabel} ${index + 1}`}
              onClick={() => {
                onChange(values.filter((_, i) => i !== index));
                focusRow(Math.max(0, Math.min(index, values.length - 2)));
              }}
            >
              <Trash2 size={15} aria-hidden="true" />
              删除
            </button>
          </div>
        ))}
      </div>
      {!values.length && <p className={styles.empty}>尚未添加{itemLabel}。</p>}
      <button
        ref={addButton}
        type="button"
        className={`button secondary ${styles.add}`}
        disabled={disabled || values.length >= max}
        onClick={() => {
          onChange([...values, createItem()]);
          focusRow(values.length);
        }}
      >
        <Plus size={15} aria-hidden="true" />
        添加{itemLabel}
      </button>
    </div>
  );
}

export function StringListEditor({
  label,
  itemLabel,
  values,
  onChange,
  multiline = false,
}: {
  label: string;
  itemLabel: string;
  values: string[];
  onChange: (values: string[]) => void;
  multiline?: boolean;
}) {
  return (
    <EditableList
      label={label}
      itemLabel={itemLabel}
      values={values}
      onChange={onChange}
      createItem={() => ""}
      renderItem={(value, index, update) => (
        <label className="p-field">
          <span>
            {itemLabel} {index + 1}
          </span>
          {multiline ? (
            <textarea rows={2} value={value} onChange={(e) => update(e.target.value)} />
          ) : (
            <input
              required
              maxLength={120}
              value={value}
              onChange={(e) => update(e.target.value)}
            />
          )}
        </label>
      )}
    />
  );
}
