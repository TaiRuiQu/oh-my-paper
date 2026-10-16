"use client";

import { useImperativeHandle, useState, type Ref } from "react";
import type { Role } from "@/contracts/platform";
import { Field, readForm, stringField } from "./primitives";
import { useUnsavedChanges } from "./use-unsaved-changes";

export type NewAccountLeaveGuard = { confirmLeave: () => boolean };

export function NewAccountForm({
  role,
  blocked,
  busy,
  leaveGuard,
  onSave,
  onCancel,
}: {
  role: Role;
  blocked: boolean;
  busy: boolean;
  leaveGuard: Ref<NewAccountLeaveGuard>;
  onSave: (command: unknown, onAccepted: () => void) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState({ name: "", studentNumber: "", username: "", password: "" });
  const { confirmDiscard, markSaved } = useUnsavedChanges(
    Object.values(draft).some(Boolean),
    "有未保存的新账号信息，离开后会丢失。确定放弃？",
  );
  useImperativeHandle(leaveGuard, () => ({ confirmLeave: confirmDiscard }), [confirmDiscard]);
  const field = (name: keyof typeof draft) => ({
    value: draft[name],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
      setDraft((current) => ({ ...current, [name]: event.target.value })),
  });
  return (
    <form
      className="p-form"
      inert={blocked}
      aria-busy={busy}
      onSubmit={(event) => {
        const data = readForm(event);
        if (blocked) return;
        onSave(
          {
            type: "user.create",
            user:
              role === "STUDENT"
                ? {
                    role,
                    name: stringField(data, "name"),
                    studentNumber: stringField(data, "studentNumber") || undefined,
                  }
                : {
                    role,
                    username: stringField(data, "username"),
                    password: stringField(data, "password"),
                  },
          },
          markSaved,
        );
      }}
    >
      <div className="p-form-grid">
        {role === "STUDENT" ? (
          <>
            <Field label="真实姓名">
              <input name="name" required maxLength={80} autoComplete="off" {...field("name")} />
            </Field>
            <Field label="学号（可选）" hint="留空自动生成六位学号，密码由系统生成。">
              <input
                name="studentNumber"
                pattern="[0-9]{1,20}"
                maxLength={20}
                inputMode="numeric"
                {...field("studentNumber")}
              />
            </Field>
          </>
        ) : (
          <>
            <Field label="账号" hint="字母、数字、下划线、点或短横线；不区分大小写。">
              <input
                name="username"
                required
                maxLength={64}
                pattern="[a-zA-Z0-9_.\-]+"
                autoComplete="off"
                {...field("username")}
              />
            </Field>
            <Field label="密码" hint="10 至 128 个字符。">
              <input
                type="password"
                name="password"
                required
                minLength={10}
                maxLength={128}
                autoComplete="new-password"
                {...field("password")}
              />
            </Field>
          </>
        )}
      </div>
      <div className="p-actions">
        <button className="button" disabled={blocked}>
          {busy
            ? "正在创建…"
            : `创建${role === "STUDENT" ? "学生" : role === "TEACHER" ? "教师" : "管理员"}账号`}
        </button>
        <button type="button" className="button secondary" disabled={blocked} onClick={onCancel}>
          取消
        </button>
      </div>
    </form>
  );
}
