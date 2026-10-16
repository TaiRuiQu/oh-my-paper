"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AccountCredentials } from "@/contracts/auth";
import type { ReasoningEffort, ResponsesTransportMode } from "@/contracts/ai-models";
import { AccountImport } from "./account-import";
import importStyles from "./account-import.module.css";
import type { ImportRole } from "@/contracts/account-import";
import { AccountCredentialsPanel } from "./account-credentials";
import type { PlatformState, Role } from "@/contracts/platform";
import { apiRequest, jsonBody } from "@/lib/http-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Empty, Field, Panel, readForm, stringField } from "./primitives";
import { ProviderModelsEditor } from "./provider-models-editor";
import listStyles from "./editable-list.module.css";
import { EmbeddingSettings } from "./embedding-settings";
import { assignmentLabel } from "./teaching-permissions";
import { UserAccessEditor, type AccessSaveResult } from "./user-access-editor";
import { PermissionHistory } from "./permission-history";
import { NewAccountForm, type NewAccountLeaveGuard } from "./new-account-form";
type Provider = {
  id: string;
  name: string;
  apiType: string;
  baseURL: string;
  maxOutputTokens: number;
  transportMode: ResponsesTransportMode;
  models: { id: string; name: string; displayName: string; reasoningEffort: ReasoningEffort }[];
};
const ROLE_FILTERS = [
  { value: "", label: "教师与管理员" },
  { value: "ADMIN", label: "管理员" },
  { value: "TEACHER", label: "教师" },
  { value: "STUDENT", label: "学生" },
];
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
  const [accessTarget, setAccessTarget] = useState<{
    user: PlatformState["users"][number];
    mode: "permissions" | "role";
    nextRole?: Role;
  }>();
  const [historyUser, setHistoryUser] = useState<PlatformState["users"][number]>();
  const [credentials, setCredentials] = useState<AccountCredentials>();
  const [providers, setProviders] = useState<Provider[]>([]),
    [editing, setEditing] = useState<Provider | null | undefined>(),
    [busy, setBusy] = useState(false);
  const [savedMessage, setSavedMessage] = useState(""),
    [readError, setReadError] = useState("");
  // The account directory is searched server-side: state.users only carries staff.
  const [directoryQuery, setDirectoryQuery] = useState(""),
    [directoryRole, setDirectoryRole] = useState(""),
    [directory, setDirectory] = useState<{
      users: PlatformState["users"];
      total: number;
    }>(),
    [directoryError, setDirectoryError] = useState("");
  const directoryReader = useRef<AbortController | null>(null);
  const operation = useRef(false),
    saved = useRef(false);
  const newAccountGuard = useRef<NewAccountLeaveGuard>(null);
  const blocked = busy || !!savedMessage;
  const searchKeyword = directoryQuery.trim();
  const searching = !!searchKeyword || !!directoryRole;
  const readDirectory = useCallback((keyword: string, role: string) => {
    const controller = new AbortController();
    directoryReader.current?.abort();
    directoryReader.current = controller;
    const query = new URLSearchParams({
      ...(keyword ? { query: keyword } : {}),
      ...(role ? { role } : {}),
    });
    return apiRequest<{ users: PlatformState["users"]; total: number }>(
      `/api/platform/users?${query}`,
      { signal: controller.signal },
    )
      .then((r) => {
        if (controller.signal.aborted) return;
        setDirectory({ users: r.users, total: r.total });
        setDirectoryError("");
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setDirectoryError(cause instanceof Error ? cause.message : "账号读取失败，请重试。");
      });
  }, []);
  useEffect(() => {
    if (searching) void readDirectory(searchKeyword, directoryRole);
  }, [searching, searchKeyword, directoryRole, readDirectory]);
  function changeNewRole(role?: Role) {
    if (operation.current || saved.current || newRole === role) return;
    if (newAccountGuard.current?.confirmLeave() === false) return;
    if (role) setCredentials(undefined);
    setNewRole(role);
  }
  function openImport(role: ImportRole) {
    if (operation.current || saved.current) return;
    if (newAccountGuard.current?.confirmLeave() === false) return;
    setNewRole(undefined);
    setImportRole(role);
  }
  useEffect(() => {
    apiRequest<{ providers: Provider[] }>("/api/platform/admin")
      .then((r) => setProviders(r.providers))
      .catch((e) => notify(e.message, true));
  }, [notify]);
  async function readAfterSave(successMessage: string) {
    setReadError("");
    try {
      await refresh();
      const result = await apiRequest<{ providers: Provider[] }>("/api/platform/admin");
      setProviders(result.providers);
      setEditing(undefined);
      setAccessTarget(undefined);
      // A searched student account is invisible in state.users; refresh its row directly.
      if (searching) void readDirectory(searchKeyword, directoryRole);
      saved.current = false;
      setSavedMessage("");
      notify(successMessage);
    } catch (cause) {
      setReadError(cause instanceof Error ? cause.message : "暂时无法读取最新配置。");
    }
  }
  async function rereadSaved() {
    if (operation.current || !saved.current) return;
    operation.current = true;
    setBusy(true);
    try {
      await readAfterSave(savedMessage);
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }
  async function save(
    body: unknown,
    creating = false,
    successMessage = "配置已保存。",
    onAccepted?: () => void,
  ): Promise<AccessSaveResult | undefined> {
    if (operation.current || saved.current) return;
    operation.current = true;
    setBusy(true);
    try {
      const result = await apiRequest<{
        id?: string;
        permissionsVersion?: number;
        credentials?: AccountCredentials;
      }>("/api/platform/admin", {
        method: "POST",
        ...jsonBody(body),
      });
      // Keep the successful write separate from subsequent reads. A read failure
      // must never turn this receipt into a retry of the mutation.
      saved.current = true;
      setSavedMessage(successMessage);
      if (creating) {
        onAccepted?.();
        setCredentials(result.credentials);
        setNewRole(undefined);
      }
      await readAfterSave(successMessage);
      return { id: result.id, permissionsVersion: result.permissionsVersion };
    } catch (e) {
      const error = e instanceof Error ? e.message : "操作失败，请重试。";
      notify(error, true);
      return {
        error,
        errorStatus:
          e && typeof e === "object" && "status" in e && typeof e.status === "number"
            ? e.status
            : undefined,
      };
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      {savedMessage && (
        <div className="p-notice" role="status">
          <p>{savedMessage} 已收到保存回执，请勿重复提交。</p>
          {readError ? (
            <>
              <p>最新配置读取失败：{readError}。已保存的内容和账号凭据仍然保留。</p>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void rereadSaved()}
              >
                重新读取最新配置
              </button>
            </>
          ) : (
            <p>正在读取最新配置…</p>
          )}
        </div>
      )}
      {(!section || section === "users") && (
        <div className={importStyles.users}>
          <Panel
            title="账号与角色"
            description="管理员创建账号，并为教师配置可兼任的教学身份和数据范围。师生使用各自的绑定账号登录；学生学号 / 卡号另用于答题身份匹配。"
            actions={
              <div className="p-actions">
                <button
                  className="button"
                  disabled={blocked || !!importRole || !!accessTarget}
                  onClick={() => openImport("TEACHER")}
                >
                  批量导入教师
                </button>
                <button
                  className="button secondary"
                  disabled={blocked || !!importRole || !!accessTarget}
                  onClick={() => openImport("STUDENT")}
                >
                  批量导入学生
                </button>
                <button
                  className="button"
                  disabled={blocked || !!importRole || !!accessTarget}
                  onClick={() => changeNewRole("TEACHER")}
                >
                  添加教师
                </button>
                <button
                  className="button secondary"
                  disabled={blocked || !!importRole || !!accessTarget}
                  onClick={() => changeNewRole("STUDENT")}
                >
                  添加学生
                </button>
                <button
                  className="button secondary"
                  disabled={blocked || !!importRole || !!accessTarget}
                  onClick={() => changeNewRole("ADMIN")}
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
              <NewAccountForm
                key={newRole}
                role={newRole}
                blocked={blocked}
                busy={busy}
                leaveGuard={newAccountGuard}
                onSave={(command, markSaved) => {
                  void save(command, true, "配置已保存。", markSaved);
                }}
                onCancel={() => changeNewRole(undefined)}
              />
            )}
            <div className="p-toolbar">
              <Input
                aria-label="搜索账号"
                placeholder="姓名、登录账号或邮箱"
                value={directoryQuery}
                onChange={(e) => setDirectoryQuery(e.target.value)}
              />
              <select
                aria-label="按角色筛选账号"
                value={directoryRole}
                onChange={(e) => setDirectoryRole(e.target.value)}
              >
                {ROLE_FILTERS.map((role) => (
                  <option key={role.value} value={role.value}>
                    {role.label}
                  </option>
                ))}
              </select>
              {searching && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setDirectoryQuery("");
                    setDirectoryRole("");
                    setDirectoryError("");
                  }}
                >
                  清空搜索
                </Button>
              )}
            </div>
            {searching ? (
              directory ? (
                <p className="p-muted">
                  找到 {directory.total} 个账号
                  {directory.total > directory.users.length &&
                    `，仅显示最近创建的前 ${directory.users.length} 个，请继续缩小搜索范围`}
                  。
                </p>
              ) : (
                !directoryError && <p role="status">正在搜索账号…</p>
              )
            ) : (
              <p className="p-muted">
                默认显示教师与管理员账号，学生账号请输入姓名、学号或登录账号搜索
                {state.usersTotal && state.usersTotal > state.users.length
                  ? `，全校共 ${state.usersTotal} 个账号`
                  : ""}
                。
              </p>
            )}
            {directoryError && (
              <p className="p-notice error" role="alert">
                账号读取失败：{directoryError}
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => void readDirectory(searchKeyword, directoryRole)}
                >
                  重试
                </button>
              </p>
            )}
            {(searching ? (directory?.users ?? []) : state.users).length ? (
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
                    {(searching ? (directory?.users ?? []) : state.users).map((u) => (
                      <tr key={u.id}>
                        <td>{u.name}</td>
                        <td>{u.username ?? u.email}</td>
                        <td>
                          <select
                            className={importStyles.roleSelect}
                            aria-label={`${u.name} 的角色`}
                            value={u.role}
                            disabled={
                              blocked ||
                              !!accessTarget ||
                              !!newRole ||
                              !!importRole ||
                              u.id === state.actor.id
                            }
                            onChange={(e) =>
                              setAccessTarget({
                                user: structuredClone(u),
                                mode: "role",
                                nextRole: e.target.value as Role,
                              })
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
                              disabled={blocked || !!accessTarget || !!newRole || !!importRole}
                              aria-label={`配置 ${u.name} 的教学权限`}
                              onClick={() =>
                                setAccessTarget({ user: structuredClone(u), mode: "permissions" })
                              }
                            >
                              配置教学权限
                            </button>
                          )}
                          <button
                            type="button"
                            className="button secondary"
                            disabled={blocked}
                            aria-label={`查看 ${u.name} 的权限变更历史`}
                            onClick={() => setHistoryUser(u)}
                          >
                            查看变更历史
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>
                {searching
                  ? searchKeyword
                    ? `没有找到与“${searchKeyword}”匹配的账号，请修改关键词或清空搜索。`
                    : "该角色筛选下暂无账号。"
                  : "还没有教师与管理员账号，可批量导入或逐个添加。"}
              </Empty>
            )}
            {accessTarget && (
              <UserAccessEditor
                key={`${accessTarget.user.id}/${accessTarget.mode}`}
                user={accessTarget.user}
                mode={accessTarget.mode}
                nextRole={accessTarget.nextRole}
                classrooms={state.classrooms}
                busy={blocked}
                onCancel={() => setAccessTarget(undefined)}
                onSave={(command) =>
                  save(
                    command,
                    false,
                    command.type === "user.role" ? "账号角色已保存。" : "教学权限已保存。",
                  )
                }
              />
            )}
            {historyUser && (
              <PermissionHistory
                key={historyUser.id}
                userId={historyUser.id}
                name={historyUser.name}
                classrooms={state.classrooms}
                onClose={() => setHistoryUser(undefined)}
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
              disabled={blocked}
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
              inert={blocked}
              aria-busy={busy}
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
                    maxOutputTokens: Number(
                      d.get("maxOutputTokens") ?? editing?.maxOutputTokens ?? 16384,
                    ),
                    transportMode: stringField(d, "transportMode") || "http",
                    models: d.getAll("modelName").map((name, index) => ({
                      name: String(name).trim(),
                      displayName: String(d.getAll("modelDisplayName")[index] ?? "").trim(),
                      reasoningEffort: String(d.getAll("modelReasoningEffort")[index]),
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
                  label="连接模式"
                  hint="HTTP 每次发送完整上下文；WebSocket 复用连接，减少重复传输，连接不可用时自动切换为 HTTP。"
                >
                  <select
                    name="transportMode"
                    defaultValue={editing?.transportMode ?? "http"}
                    disabled={blocked}
                  >
                    <option value="http">HTTP 模式</option>
                    <option value="websocket">WebSocket 模式</option>
                  </select>
                </Field>
              )}
              {providerApiType !== "openai_responses" && (
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
              )}
              <ProviderModelsEditor models={editing?.models} disabled={blocked} />
              <div className="p-actions">
                <button className="button" disabled={blocked}>
                  {busy ? "正在保存…" : "保存提供商"}
                </button>
                <button
                  type="button"
                  className="button secondary"
                  disabled={blocked}
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
                            disabled={blocked}
                            onClick={() => {
                              setProviderApiType(p.apiType);
                              setEditing(p);
                            }}
                          >
                            编辑
                          </button>
                          <button
                            className="button danger"
                            disabled={blocked}
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
