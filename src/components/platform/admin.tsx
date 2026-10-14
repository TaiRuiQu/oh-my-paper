"use client";
import { useEffect, useState } from "react";
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
}: {
  state: PlatformState;
  refresh: () => Promise<void>;
  notify: (message: string, error?: boolean) => void;
}) {
  const [providers, setProviders] = useState<Provider[]>([]),
    [editing, setEditing] = useState<Provider | null | undefined>(),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    apiRequest<{ providers: Provider[] }>("/api/platform/admin")
      .then((r) => setProviders(r.providers))
      .catch((e) => notify(e.message, true));
  }, [notify]);
  async function save(body: unknown) {
    setBusy(true);
    try {
      await apiRequest("/api/platform/admin", { method: "POST", ...jsonBody(body) });
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
      <Panel
        title="账号与角色"
        description="管理员拥有教师权限；教师组织考试和阅卷；学生仅能访问绑定自己的已发布成绩与学情。"
      >
        <div className="p-table" role="region" aria-label="账号与角色列表" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th>姓名</th>
                <th>邮箱</th>
                <th>角色</th>
              </tr>
            </thead>
            <tbody>
              {state.users.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td>{u.email}</td>
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
    </>
  );
}
