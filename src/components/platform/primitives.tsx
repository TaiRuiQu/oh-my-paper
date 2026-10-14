"use client";

import type { ReactNode, FormEvent } from "react";

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="p-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function Panel({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="p-panel">
      <div className="p-panel-heading">
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {actions && <div className="p-actions">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="p-empty">{children}</p>;
}

export function Submit({ pending, children = "保存" }: { pending: boolean; children?: ReactNode }) {
  return (
    <button type="submit" className="button" disabled={pending}>
      {pending ? "正在保存…" : children}
    </button>
  );
}

export function readForm(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  return new FormData(event.currentTarget);
}

export const stringField = (data: FormData, name: string) => String(data.get(name) ?? "").trim();
export const numberField = (data: FormData, name: string) => Number(data.get(name) ?? 0);
export const splitList = (value: string) =>
  value
    .split(/[，,\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
