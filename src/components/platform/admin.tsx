"use client";
import { useEffect, useState } from "react";
import type { AccountCredentials } from "@/contracts/auth";
import { AccountImport } from "./account-import";
import importStyles from "./account-import.module.css";
import type { ImportRole } from "@/contracts/account-import";
import { AccountCredentialsPanel } from "./account-credentials";
import type { PlatformState, Role } from "@/contracts/platform";
import { apiRequest, jsonBody } from "@/lib/http-client";
import { Empty, Field, Panel, readForm, stringField } from "./primitives";
import { ProviderModelsEditor } from "./provider-models-editor";
import listStyles from "./editable-list.module.css";
import { EmbeddingSettings } from "./embedding-settings";
import { assignmentLabel, TeachingPermissions } from "./teaching-permissions";
type Provider = {
  id: string;
  name: string;
  apiType: string;
  baseURL: string;
  maxOutputTokens: number;
  usePreviousResponseId: boolean;
  models: { id: string; name: string; displayName: string }[];
};
export function Admin({
  state,
  refresh,
  notify,
  section,
}: {
  section?: "users" | "models";
  state: PlatformState;
  refresh: () => Promise<void>;
  notify: (message: string, error?: boolean) => void;
}) {
  const [providerApiType, setProviderApiType] = useState("openai_chat");
  const [newRole, setNewRole] = useState<Role>();
  const [importRole, setImportRole] = useState<ImportRole>();
  const [permissionUserId, setPermissionUserId] = useState<string>();
  const permissionUser = state.users.find(
    (user) => user.id === permissionUserId && user.role === "TEACHER",
  );
  const [credentials, setCredentials] = useState<AccountCredentials>();
  const [providers, setProviders] = useState<Provider[]>([]),
    [editing, setEditing] = useState<Provider | null | undefined>(),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    apiRequest<{ providers: Provider[] }>("/api/platform/admin")
      .then((r) => setProviders(r.providers))
      .catch((e) => notify(e.message, true));
  }, [notify]);
  async function save(body: unknown, creating = false, successMessage = "配置已保存。") {
    setBusy(true);
    try {
      const result = await apiRequest<{ credentials?: AccountCredentials }>("/api/platform/admin", {
        method: "POST",
        ...jsonBody(body),
      });
      if (creating) {
        setCredentials(result.credentials);
        setNewRole(undefined);
      }
      await refresh();
      const r = await apiRequest<{ providers: Provider[] }>("/api/platform/admin");
      setProviders(r.providers);
      notify(successMessage);
      setEditing(undefined);
      setPermissionUserId(undefined);
    } catch (e) {
      notify(e instanceof Error ? e.message : "操作失败，请重试。", true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {(!section || section === "users") && (
        <div className={importStyles.users}>
          <Panel
            title="账号与角色"
            description="管理员创建账号，并为教师配置可兼任的教学身份和数据范围。教师使用账号登录，学生使用学号登录。"
            actions={
              <div className="p-actions">
                <button
                  className="button"
                  disabled={busy || !!importRole}
                  onClick={() => {
                    setNewRole(undefined);
                    setImportRole("TEACHER");
                  }}
                >
                  批量导入教师
                </button>
                <button
                  className="button secondary"
                  disabled={busy || !!importRole}
                  onClick={() => {
                    setNewRole(undefined);
                    setImportRole("STUDENT");
                  }}
                >
                  批量导入学生
                </button>
                <button
                  className="button"
                  disabled={busy || !!importRole}
                  onClick={() => {
                    setCredentials(undefined);
                    setNewRole("TEACHER");
                  }}
                >
                  添加教师
                </button>
                <button
                  className="button secondary"
                  disabled={busy || !!importRole}
                  onClick={() => {
                    setCredentials(undefined);
                    setNewRole("STUDENT");
                  }}
                >
                  添加学生
                </button>
                <button
                  className="button secondary"
                  disabled={busy || !!importRole}
                  onClick={() => {
                    setCredentials(undefined);
                    setNewRole("ADMIN");
                  }}
                >
                  添加管理员
                </button>
              </div>
            }
          >
            {importRole && (
              <AccountImport
                key={importRole}
                role={importRole}
                refresh={refresh}
                onClose={() => setImportRole(undefined)}
              />
            )}
            {credentials && <AccountCredentialsPanel credentials={credentials} />}
            {newRole && (
              <form
                className="p-form"
                key={newRole}
                onSubmit={(e) => {
                  const d = readForm(e);
                  void save(
                    {
                      type: "user.create",
                      user:
                        newRole === "STUDENT"
                          ? {
                              role: newRole,
                              name: stringField(d, "name"),
                              studentNumber: stringField(d, "studentNumber") || undefined,
                            }
                          : {
                              role: newRole,
                              username: stringField(d, "username"),
                              password: stringField(d, "password"),
                            },
                    },
                    true,
                  );
                }}
              >
                <div className="p-form-grid">
                  {newRole === "STUDENT" ? (
                    <>
                      <Field label="真实姓名">
                        <input name="name" required maxLength={80} autoComplete="off" />
                      </Field>
                      <Field label="学号（可选）" hint="留空自动生成六位学号，密码由系统生成。">
                        <input
                          name="studentNumber"
                          pattern="[0-9]{1,20}"
                          maxLength={20}
                          inputMode="numeric"
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
                        />
                      </Field>
                    </>
                  )}
                </div>
                <div className="p-actions">
                  <button className="button" disabled={busy}>
                    {busy
                      ? "正在创建…"
                      : `创建${newRole === "STUDENT" ? "学生" : newRole === "TEACHER" ? "教师" : "管理员"}账号`}
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy}
                    onClick={() => setNewRole(undefined)}
                  >
                    取消
                  </button>
                </div>
              </form>
            )}
            <div className="p-table" role="region" aria-label="账号与角色列表" tabIndex={0}>
              <table>
                <thead>
                  <tr>
                    <th>姓名</th>
                    <th>账号 / 学号</th>
                    <th>角色</th>
                    <th>教学身份与范围</th>
                    <th>权限配置</th>
                  </tr>
                </thead>
                <tbody>
                  {state.users.map((u) => (
                    <tr key={u.id}>
                      <td>{u.name}</td>
                      <td>{u.username ?? u.email}</td>
                      <td>
                        <select
                          aria-label={`${u.name} 的角色`}
                          value={u.role}
                          disabled={busy || u.id === state.actor.id}
                          onChange={(e) =>
                            void save({ type: "user.role", id: u.id, role: e.target.value as Role })
                          }
                        >
                          <option value="ADMIN">管理员</option>
                          <option value="TEACHER">教师</option>
                          <option value="STUDENT">学生</option>
                        </select>
                      </td>
                      <td>
                        {u.role === "ADMIN" ? (
                          "全校教学数据与系统配置"
                        ) : u.role === "STUDENT" ? (
                          "本人学习数据"
                        ) : u.teachingAssignments?.length ? (
                          <ul className="p-permission-summary">
                            {u.teachingAssignments.map((row, index) => (
                              <li key={index}>{assignmentLabel(row, state.classrooms)}</li>
                            ))}
                          </ul>
                        ) : (
                          "尚未分配教学身份"
                        )}
                      </td>
                      <td>
                        {u.role === "TEACHER" && (
                          <button
                            className="button secondary"
                            disabled={busy}
                            aria-label={`配置 ${u.name} 的教学权限`}
                            onClick={() => setPermissionUserId(u.id)}
                          >
                            配置教学权限
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {permissionUser && (
              <TeachingPermissions
                key={permissionUser.id}
                name={permissionUser.name}
                assignments={permissionUser.teachingAssignments ?? []}
                classrooms={state.classrooms}
                busy={busy}
                onCancel={() => setPermissionUserId(undefined)}
                onSave={(assignments) =>
                  void save({ type: "user.permissions", id: permissionUser.id, assignments })
                }
              />
            )}
          </Panel>
        </div>
      )}
      {(!section || section === "models") && (
        <Panel
          title="AI 模型提供商"
          description="配置统一的模型接入，凭据保存在服务器，前端不显示已保存的密钥。"
          actions={
            <button
              className="button"
              disabled={busy}
              onClick={() => {
                setProviderApiType("openai_chat");
                setEditing(null);
              }}
            >
              添加提供商
            </button>
          }
        >
          {editing !== undefined && (
            <form
              className="p-form"
              key={editing?.id ?? "new"}
              onSubmit={(e) => {
                const d = readForm(e);
                void save({
                  type: "provider.save",
                  provider: {
                    id: editing?.id,
                    name: stringField(d, "name"),
                    apiType: stringField(d, "apiType"),
                    baseURL: stringField(d, "baseURL"),
                    apiKey: stringField(d, "apiKey") || undefined,
                    maxOutputTokens: Number(d.get("maxOutputTokens")),
                    usePreviousResponseId: d.get("usePreviousResponseId") === "true",
                    models: d.getAll("modelName").map((name, index) => ({
                      name: String(name).trim(),
                      displayName: String(d.getAll("modelDisplayName")[index] ?? "").trim(),
                    })),
                  },
                });
              }}
            >
              <div className="p-form-grid">
                <Field label="显示名称">
                  <input required name="name" defaultValue={editing?.name} />
                </Field>
                <Field label="接口类型">
                  <select
                    name="apiType"
                    value={providerApiType}
                    onChange={(e) => setProviderApiType(e.target.value)}
                  >
                    <option value="openai_chat">OpenAI Chat Completions 兼容</option>
                    <option value="openai_responses">OpenAI Responses</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="google">Google</option>
                  </select>
                </Field>
                <Field label="接口地址">
                  <input type="url" required name="baseURL" defaultValue={editing?.baseURL} />
                </Field>
                <Field label="API 密钥" hint={editing ? "留空则保留原有密钥。" : undefined}>
                  <input
                    type="password"
                    name="apiKey"
                    autoComplete="new-password"
                    required={!editing}
                  />
                </Field>
              </div>
              {providerApiType === "openai_responses" && (
                <Field
                  label="使用 previous_response_id"
                  hint="开启后通过响应 ID 续接上下文，减少历史重传；供应商需支持响应保存。关闭时每轮发送完整历史。"
                >
                  <select
                    name="usePreviousResponseId"
                    defaultValue={String(editing?.usePreviousResponseId ?? false)}
                    disabled={busy}
                  >
                    <option value="false">关闭（默认）</option>
                    <option value="true">开启</option>
                  </select>
                </Field>
              )}
              <Field
                label="每步最大输出 tokens"
                hint="按供应商公布的模型输出上限设置，过大可能导致请求被拒绝。"
              >
                <input
                  required
                  type="number"
                  min={1024}
                  max={393216}
                  name="maxOutputTokens"
                  defaultValue={editing?.maxOutputTokens ?? 16384}
                />
              </Field>
              <ProviderModelsEditor models={editing?.models} disabled={busy} />
              <div className="p-actions">
                <button className="button" disabled={busy}>
                  {busy ? "正在保存…" : "保存提供商"}
                </button>
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => setEditing(undefined)}
                >
                  取消
                </button>
              </div>
            </form>
          )}
          {providers.length ? (
            <div className="p-table" role="region" aria-label="模型提供商列表" tabIndex={0}>
              <table>
                <thead>
                  <tr>
                    <th>提供商</th>
                    <th>接口类型</th>
                    <th>模型</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {providers.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <strong>{p.name}</strong>
                        <div className="p-muted">{p.baseURL}</div>
                      </td>
                      <td>{p.apiType}</td>
                      <td>
                        <ul className={listStyles.summary}>
                          {p.models.map((m) => (
                            <li key={m.id}>
                              {m.displayName || m.name}
                              {m.displayName && <small>{m.name}</small>}
                            </li>
                          ))}
                        </ul>
                      </td>
                      <td>
                        <div className="p-actions">
                          <button
                            className="button secondary"
                            disabled={busy}
                            onClick={() => {
                              setProviderApiType(p.apiType);
                              setEditing(p);
                            }}
                          >
                            编辑
                          </button>
                          <button
                            className="button danger"
                            disabled={busy}
                            aria-label={`删除 AI 供应商 ${p.name}`}
                            onClick={() => {
                              if (
                                window.confirm(
                                  `确定删除「${p.name}」及其 ${p.models.length} 个模型？删除后无法恢复，尚未开始的任务将无法使用这些模型。`,
                                )
                              )
                                void save(
                                  { type: "provider.delete", id: p.id },
                                  false,
                                  "AI 供应商已删除。",
                                );
                            }}
                          >
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>尚未配置模型提供商。</Empty>
          )}
        </Panel>
      )}
      {(!section || section === "models") && <EmbeddingSettings notify={notify} />}
    </>
  );
}
