"use client";
import { useEffect, useState } from "react";
import type { AccountCredentials } from "@/contracts/auth";
import { AccountCredentialsPanel } from "./account-credentials";
import type { PlatformState, Role } from "@/contracts/platform";
import { apiRequest, jsonBody } from "@/lib/http-client";
import { Empty, Field, Panel, readForm, stringField, splitList } from "./primitives";
type Provider = {
  id: string;
  name: string;
  apiType: string;
  baseURL: string;
  maxOutputTokens: number;
  models: { id: string; name: string }[];
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
  const [newRole, setNewRole] = useState<Role>();
  const [credentials, setCredentials] = useState<AccountCredentials>();
  const [providers, setProviders] = useState<Provider[]>([]),
    [editing, setEditing] = useState<Provider | null | undefined>(),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    apiRequest<{ providers: Provider[] }>("/api/platform/admin")
      .then((r) => setProviders(r.providers))
      .catch((e) => notify(e.message, true));
  }, [notify]);
  async function save(body: unknown, creating = false) {
    setBusy(true);
    try {
      const result = await apiRequest<{ credentials?: AccountCredentials }>("/api/platform/admin", { method: "POST", ...jsonBody(body) });
      if (creating) { setCredentials(result.credentials); setNewRole(undefined); }
      await refresh();
      const r = await apiRequest<{ providers: Provider[] }>("/api/platform/admin");
      setProviders(r.providers);
      notify("配置已保存。");
      setEditing(undefined);
    } catch (e) {
      notify(e instanceof Error ? e.message : "保存失败", true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {(!section || section === "users") && (
        <Panel
          title="账号与角色"
          description="管理员添加账号，教师也可添加学生。教师使用账号登录，学生使用学号登录。"
          actions={<div className="p-actions">
            <button className="button" disabled={busy} onClick={() => {setCredentials(undefined); setNewRole("TEACHER");}}>添加教师</button>
            <button className="button secondary" disabled={busy} onClick={() => {setCredentials(undefined); setNewRole("STUDENT");}}>添加学生</button>
            <button className="button secondary" disabled={busy} onClick={() => {setCredentials(undefined); setNewRole("ADMIN");}}>添加管理员</button>
          </div>}
        >
          {credentials && <AccountCredentialsPanel credentials={credentials} />}
          {newRole && <form className="p-form" key={newRole} onSubmit={(e) => {
            const d = readForm(e);
            void save({ type: "user.create", user: newRole === "STUDENT"
              ? { role: newRole, name: stringField(d, "name"), studentNumber: stringField(d, "studentNumber") || undefined }
              : { role: newRole, username: stringField(d, "username"), password: stringField(d, "password") }
            }, true);
          }}>
            <div className="p-form-grid">
              {newRole === "STUDENT" ? <>
                <Field label="真实姓名"><input name="name" required maxLength={80} autoComplete="off" /></Field>
                <Field label="学号（可选）" hint="留空自动生成六位学号，密码由系统生成。"><input name="studentNumber" pattern="[0-9]{1,20}" maxLength={20} inputMode="numeric" /></Field>
              </> : <>
                <Field label="账号" hint="字母、数字、下划线、点或短横线；不区分大小写。"><input name="username" required maxLength={64} pattern="[a-zA-Z0-9_.\-]+" autoComplete="off" /></Field>
                <Field label="密码" hint="10 至 128 个字符。"><input type="password" name="password" required minLength={10} maxLength={128} autoComplete="new-password" /></Field>
              </>}
            </div>
            <div className="p-actions">
              <button className="button" disabled={busy}>{busy ? "正在创建…" : `创建${newRole === "STUDENT" ? "学生" : newRole === "TEACHER" ? "教师" : "管理员"}账号`}</button>
              <button type="button" className="button secondary" disabled={busy} onClick={() => setNewRole(undefined)}>取消</button>
            </div>
          </form>}
          <div className="p-table" role="region" aria-label="账号与角色列表" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th>姓名</th>
                  <th>账号 / 学号</th>
                  <th>角色</th>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
      {(!section || section === "models") && (
        <Panel
          title="AI 模型提供商"
          description="配置统一的模型接入，凭据保存在服务器，前端不显示已保存的密钥。"
          actions={
            <button className="button" onClick={() => setEditing(null)}>
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
                    models: splitList(stringField(d, "models")),
                  },
                });
              }}
            >
              <div className="p-form-grid">
                <Field label="显示名称">
                  <input required name="name" defaultValue={editing?.name} />
                </Field>
                <Field label="接口类型">
                  <select name="apiType" defaultValue={editing?.apiType ?? "openai_chat"}>
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
              <Field label="模型 ID（每行一个）">
                <textarea
                  required
                  name="models"
                  defaultValue={editing?.models.map((m) => m.name).join("\n")}
                />
              </Field>
              <div className="p-actions">
                <button className="button" disabled={busy}>
                  {busy ? "正在保存…" : "保存提供商"}
                </button>
                <button
                  type="button"
                  className="button secondary"
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
                      <td>{p.models.map((m) => m.name || m.id).join("、")}</td>
                      <td>
                        <button className="button secondary" onClick={() => setEditing(p)}>
                          编辑
                        </button>
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
    </>
  );
}
