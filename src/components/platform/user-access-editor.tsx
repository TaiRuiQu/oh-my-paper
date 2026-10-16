"use client";
import { useEffect, useRef, useState } from "react";
import type { PlatformState, Role } from "@/contracts/platform";
import type { TeachingAssignment, TeachingPermissionsCommand } from "@/contracts/permissions";
import { apiRequest } from "@/lib/http-client";
import { Field } from "./primitives";
import { assignmentLabel, TeachingPermissions } from "./teaching-permissions";
import { useUnsavedChanges } from "./use-unsaved-changes";

type User = PlatformState["users"][number];
export type AccessSaveResult = {
  id?: string;
  permissionsVersion?: number;
  error?: string;
  errorStatus?: number;
};
export function UserAccessEditor({
  user,
  mode,
  nextRole,
  classrooms,
  busy,
  onSave,
  onCancel,
}: {
  user: User;
  mode: "permissions" | "role";
  nextRole?: Role;
  classrooms: PlatformState["classrooms"];
  busy: boolean;
  onSave: (command: TeachingPermissionsCommand) => Promise<AccessSaveResult | undefined>;
  onCancel: () => void;
}) {
  const [baseline, setBaseline] = useState(user),
    [draft, setDraft] = useState<TeachingAssignment[]>(user.teachingAssignments ?? []);
  const [role, setRole] = useState<Role>(nextRole ?? user.role),
    [reason, setReason] = useState("");
  const [error, setError] = useState(""),
    [conflict, setConflict] = useState(false),
    [reading, setReading] = useState(false),
    [saving, setSaving] = useState(false),
    [acknowledged, setAcknowledged] = useState(false);
  const [latest, setLatest] = useState<User | null>(null),
    [generation, setGeneration] = useState(0);
  const lock = useRef(false);
  const mounted = useRef(true),
    reader = useRef<AbortController | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      reader.current?.abort();
    };
  }, []);
  const dirty =
    !acknowledged &&
    (!!reason ||
      (mode === "role"
        ? role !== baseline.role
        : JSON.stringify(draft) !== JSON.stringify(baseline.teachingAssignments ?? [])));
  const { confirmDiscard, markSaved } = useUnsavedChanges(
    dirty,
    "有未保存的权限或角色变更，离开后会丢失。确定离开？",
  );
  const unavailable =
    baseline.permissionsVersion === undefined ||
    (mode === "permissions" && baseline.role !== "TEACHER");
  const blocked = busy || saving || reading || acknowledged;
  async function readLatest() {
    if (lock.current || busy || acknowledged) return;
    lock.current = true;
    setReading(true);
    setError("");
    const controller = new AbortController();
    reader.current = controller;
    try {
      // The state users payload carries staff only, so read the target account directly.
      const result = await apiRequest<{ users: PlatformState["users"] }>(
        `/api/platform/users?id=${encodeURIComponent(user.id)}`,
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      const value = result.users[0];
      if (!value || value.permissionsVersion === undefined)
        throw new Error("无法读取此账号的真实权限版本，请重试。");
      setLatest(structuredClone(value));
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : "读取失败，当前编辑仍保留。");
    } finally {
      lock.current = false;
      if (mounted.current) setReading(false);
    }
  }
  async function save(rows: TeachingAssignment[]) {
    if (lock.current || blocked || unavailable || conflict || !reason.trim()) return;
    lock.current = true;
    setSaving(true);
    setError("");
    try {
      const common = {
        id: user.id,
        expectedVersion: baseline.permissionsVersion!,
        reason: reason.trim(),
      };
      const result = await onSave(
        mode === "permissions"
          ? { type: "user.permissions", ...common, assignments: rows }
          : { type: "user.role", ...common, role },
      );
      if (!mounted.current) return;
      if (!result) {
        setError("当前操作未提交，请稍后重试。");
        return;
      }
      if (result.error) {
        setError(result.error);
        setConflict(result.errorStatus === 409);
      } else {
        markSaved();
        setAcknowledged(true);
      }
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : "保存失败，当前编辑仍保留。");
    } finally {
      lock.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  function cancel() {
    if (!lock.current && !busy && confirmDiscard()) onCancel();
  }
  const roleLabel = (value: Role) => ({ ADMIN: "管理员", TEACHER: "教师", STUDENT: "学生" })[value];
  const summary = (rows: TeachingAssignment[]) =>
    rows.length ? (
      <ul>
        {rows.map((row, index) => (
          <li key={index}>{assignmentLabel(row, classrooms)}</li>
        ))}
      </ul>
    ) : (
      <p>尚未分配教学身份</p>
    );
  const controls = (
    <>
      <p className="p-muted">
        编辑基于权限版本{" "}
        {baseline.permissionsVersion === undefined ? "未知" : `v${baseline.permissionsVersion}`}
        。保存后保留操作者、原因和变更前后记录。
      </p>
      {unavailable && (
        <p role="alert">当前权限版本未知或账号已不再是教师，请重新读取并核对后再编辑。</p>
      )}
      {error && (
        <p className="p-notice error" role="alert">
          {error.replace(/。+$/, "")}。当前选择与原因仍保留。
        </p>
      )}
      {conflict && (
        <p role="status">
          权限版本已变化，不能提交旧集合。请读取最新权限，比较后明确采用，再重新编辑。
        </p>
      )}
      <Field label="变更原因">
        <textarea
          required
          maxLength={2000}
          value={reason}
          disabled={blocked || unavailable || conflict}
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
    </>
  );
  return (
    <section aria-label={`${user.name}的权限变更编辑`}>
      <div className="p-actions">
        <button
          type="button"
          className="button secondary"
          disabled={blocked}
          onClick={() => void readLatest()}
        >
          {reading ? "正在读取…" : "读取最新权限并比较"}
        </button>
      </div>
      {latest && (
        <section aria-label={`${user.name}的权限版本比较`} className="p-notice">
          <h3>
            服务器最新权限 v{latest.permissionsVersion} · {roleLabel(latest.role)}
          </h3>
          {summary(latest.teachingAssignments ?? [])}
          <h4>当前未保存选择</h4>
          {mode === "permissions" ? summary(draft) : <p>{roleLabel(role)}</p>}
          <p>读取不会替换当前编辑。采用后放弃当前集合与原因，按最新版本重新编辑。</p>
          <button
            type="button"
            className="button secondary"
            disabled={blocked}
            onClick={() => {
              if (
                dirty &&
                !window.confirm("采用服务器最新权限会放弃当前未保存的选择与原因。确定采用？")
              )
                return;
              markSaved();
              setBaseline(latest);
              setDraft(latest.teachingAssignments ?? []);
              setRole(latest.role);
              setReason("");
              setConflict(false);
              setError("");
              setLatest(null);
              setGeneration((value) => value + 1);
            }}
          >
            采用最新权限重新编辑
          </button>
        </section>
      )}
      {mode === "permissions" ? (
        <TeachingPermissions
          key={generation}
          name={user.name}
          assignments={baseline.teachingAssignments ?? []}
          classrooms={classrooms}
          busy={blocked}
          readOnly={unavailable || conflict}
          submitDisabled={!reason.trim()}
          onDraftChange={setDraft}
          onSave={(rows) => void save(rows)}
          onCancel={cancel}
        >
          {controls}
        </TeachingPermissions>
      ) : (
        <form
          className="p-form"
          aria-label={`${user.name}的角色变更`}
          inert={blocked}
          onSubmit={(event) => {
            event.preventDefault();
            void save(draft);
          }}
        >
          <h3>变更 {user.name} 的角色</h3>
          <Field label="账号角色">
            <select
              value={role}
              disabled={blocked || unavailable || conflict}
              onChange={(event) => setRole(event.target.value as Role)}
            >
              {(["ADMIN", "TEACHER", "STUDENT"] as const).map((value) => (
                <option key={value} value={value}>
                  {roleLabel(value)}
                </option>
              ))}
            </select>
          </Field>
          {controls}
          <div className="p-actions">
            <button
              className="button"
              disabled={blocked || unavailable || conflict || !reason.trim()}
            >
              确认角色变更
            </button>
            <button type="button" className="button secondary" disabled={blocked} onClick={cancel}>
              取消
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
