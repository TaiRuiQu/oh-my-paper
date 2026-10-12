"use client";

import { useState, type FormEvent } from "react";
import { API_TYPES, providerInputSchema, type ProviderInput, type ProviderSummary } from "@/contracts/ai-providers";
import { apiRequest, jsonBody } from "@/lib/http-client";
import { PROMPT_PRESETS } from "@/contracts/prompt-presets";

const blank: ProviderInput = { name: "", apiType: "openai_responses", baseURL: "", apiKey: "", model: "", promptPreset: "openai",
  structuredOutputs: false, maxOutputTokens: 16000, timeoutSeconds: 240 };
const defaults = { openai_responses: "https://api.openai.com/v1", openai_chat: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1", google: "https://generativelanguage.googleapis.com/v1beta" };

export function AiProviderSettings({ initialProviders }: { initialProviders: ProviderSummary[] }) {
  const [providers, setProviders] = useState(initialProviders);
  const [form, setForm] = useState<ProviderInput>({ ...blank, baseURL: defaults.openai_responses });
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const update = <K extends keyof ProviderInput>(key: K, value: ProviderInput[K]) => setForm((old) => ({ ...old, [key]: value }));

  async function refresh() {
    const data = await apiRequest<{ providers: ProviderSummary[] }>("/api/admin/ai/providers");
    setProviders(data.providers);
  }
  async function action(name: string, operation: () => Promise<void>) {
    setBusy(name); setError(""); setNotice("");
    try { await operation(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "操作失败，请重试。"); }
    finally { setBusy(""); }
  }
  function edit(provider?: ProviderSummary) {
    setEditing(provider?.id ?? null);
    setForm(provider ? { ...provider, apiKey: "" } : { ...blank, baseURL: defaults.openai_responses });
    setError(""); setNotice(""); setDeleting(null);
  }
  function validInput() {
    const result = providerInputSchema.safeParse(form);
    if (!result.success) throw new Error(result.error.issues[0]?.message);
    if (!editing && !result.data.apiKey) throw new Error("新增提供商需要填写 API key。");
    return result.data;
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    await action("save", async () => {
      const input = validInput();
      const saved = await apiRequest<{ id?: string }>(`/api/admin/ai/providers${editing ? `/${editing}` : ""}`,
        { method: editing ? "PATCH" : "POST", ...jsonBody(input) });
      setEditing(editing ?? saved.id ?? null);
      update("apiKey", "");
      await refresh();
      setNotice("配置已保存。点击“用于识别”可设为当前模型。");
    });
  }

  return <div className="provider-workspace">
    <section className="provider-list" aria-labelledby="providers-heading">
      <div className="section-heading"><h2 id="providers-heading">提供商</h2><button className="text-button" disabled={!!busy} onClick={() => edit()}>新增提供商</button></div>
      {!providers.length && <p className="muted setup-note">添加支持图片输入的模型，保存后设为当前识别模型。</p>}
      {providers.map((provider) => <article className="provider-row" key={provider.id}>
        <div className="section-heading"><h3>{provider.name}</h3><div className="inline-actions">{provider.active && <span className="status-tag">当前识别模型</span>}{provider.gradingActive && <span className="status-tag">当前批改模型</span>}</div></div>
        <p className="provider-model">{provider.model}</p><p className="hint">{API_TYPES[provider.apiType]}</p>
        <div className="inline-actions">
          <button className="text-button" disabled={!!busy} onClick={() => edit(provider)}>编辑<span className="sr-only">{provider.name}</span></button>
          {!provider.active && <button className="text-button" disabled={!!busy} onClick={() => void action(provider.id, async () => {
            await apiRequest(`/api/admin/ai/providers/${provider.id}/activate`, { method: "POST" });
            await refresh(); setNotice(`已使用 ${provider.name} · ${provider.model}，新提交的试卷将使用此模型。`);
          })}>用于识别</button>}
          {!provider.gradingActive && <button className="text-button" disabled={!!busy} onClick={() => void action(`grade-${provider.id}`, async () => {
            await apiRequest(`/api/admin/ai/providers/${provider.id}/activate`, { method: "POST", ...jsonBody({ purpose: "grading" }) });
            await refresh(); setNotice(`批改将使用 ${provider.name} · ${provider.model}。`);
          })}>用于批改</button>}
          <button className="text-button danger" disabled={!!busy} onClick={() => setDeleting(provider.id)}>删除<span className="sr-only">{provider.name}</span></button>
        </div>
        {deleting === provider.id && <div className="delete-confirm"><p>删除 {provider.name}？{provider.active ? "删除后需要重新选择识别模型。" : ""}</p>
          <div className="inline-actions"><button className="text-button danger" disabled={!!busy} onClick={() => void action("delete", async () => {
            await apiRequest(`/api/admin/ai/providers/${provider.id}`, { method: "DELETE" });
            if (editing === provider.id) edit(); setDeleting(null); await refresh(); setNotice("提供商已删除。");
          })}>确认删除</button><button className="text-button" onClick={() => setDeleting(null)} disabled={!!busy}>取消</button></div>
        </div>}
      </article>)}
    </section>
    <section className="provider-editor" aria-labelledby="provider-edit-heading">
      <h2 id="provider-edit-heading">{editing ? "编辑 AI 提供商" : "添加 AI 提供商"}</h2>
      <p className="hint">接口类型由服务商的 API 协议决定。模型需要支持图片输入。</p>
      <form onSubmit={save}>
        <fieldset disabled={!!busy}>
          <div className="field"><label htmlFor="provider-name">提供商名称</label><input id="provider-name" required maxLength={80} value={form.name} placeholder="用于区分不同配置" onChange={(e) => update("name", e.target.value)} /></div>
          <div className="field"><label htmlFor="api-type">API 接口类型</label><select id="api-type" value={form.apiType} onChange={(e) => {
            const type = e.target.value as ProviderInput["apiType"];
            setForm((old) => ({ ...old, apiType: type, baseURL: Object.values(defaults).includes(old.baseURL) ? defaults[type] : old.baseURL }));
          }}>{Object.entries(API_TYPES).map(([type, label]) => <option value={type} key={type}>{label}</option>)}</select></div>
          <div className="field"><label htmlFor="base-url">API base URL</label><input id="base-url" type="url" required maxLength={500} value={form.baseURL} onChange={(e) => update("baseURL", e.target.value)} aria-describedby="url-hint" />
            <p className="hint" id="url-hint">填写完整的 API 前缀（如包含 /v1），无需追加 /responses 或 /chat/completions。</p></div>
          <div className="field"><label htmlFor="api-key">API key{editing ? "（留空保留已存密钥）" : ""}</label><input id="api-key" type="password" autoComplete="new-password" required={!editing} maxLength={4096} value={form.apiKey} onChange={(e) => update("apiKey", e.target.value)} aria-describedby="key-hint" />
            <p className="hint" id="key-hint">密钥加密保存，保存后不会显示。</p></div>
          <div className="field"><label htmlFor="model-name">模型名称</label><input id="model-name" required maxLength={160} value={form.model} placeholder="填写服务商提供的完整模型 ID" onChange={(e) => update("model", e.target.value)} />
            <p className="hint">可填写自定义模型，不限定服务商。</p></div>
          <div className="field"><label htmlFor="prompt-preset">系统提示词预设</label><select id="prompt-preset" value={form.promptPreset} onChange={(e) => update("promptPreset", e.target.value as ProviderInput["promptPreset"])}>
            {Object.entries(PROMPT_PRESETS).map(([id, preset]) => <option value={id} key={id}>{preset.label}</option>)}
          </select><p className="hint">{PROMPT_PRESETS[form.promptPreset].description} <a href={PROMPT_PRESETS[form.promptPreset].source} target="_blank" rel="noreferrer">官方编写指南</a></p>
            <p className="hint">按模型提供商选择；与 API 接口类型独立。预设用于识别、独立求解与批改各阶段。</p></div>
          <details className="advanced-settings"><summary>高级设置</summary>
            {form.apiType === "openai_chat" && <label className="checkbox-field"><input type="checkbox" checked={form.structuredOutputs} onChange={(e) => update("structuredOutputs", e.target.checked)} />接口支持 JSON Schema 输出<p className="hint">关闭时使用 JSON Object 模式，并在服务端校验结构。</p></label>}
            <div className="field"><label htmlFor="output-tokens">最大输出 token 数</label><input id="output-tokens" type="number" min={1024} max={64000} required value={form.maxOutputTokens} onChange={(e) => update("maxOutputTokens", Number(e.target.value))} /><p className="hint">请按模型限制设置；内容较多时需要更长的输出。</p></div>
            <div className="field"><label htmlFor="timeout-seconds">每次调用超时（秒）</label><input id="timeout-seconds" type="number" min={15} max={600} required value={form.timeoutSeconds} onChange={(e) => update("timeoutSeconds", Number(e.target.value))} /></div>
          </details>
          <div className="inline-actions"><button className="button" type="submit">{busy === "save" ? "正在保存…" : "保存配置"}</button>
            <button className="button secondary" type="button" onClick={() => void action("test", async () => {
              const input = validInput();
              const result = await apiRequest<{ message: string }>("/api/admin/ai/test", { method: "POST", ...jsonBody({ ...input, ...(editing ? { id: editing } : {}) }) });
              setNotice(result.message);
            })}>{busy === "test" ? "正在测试…" : "测试连接"}</button></div>
          <p className="hint">测试会调用模型检查图片输入和 JSON 输出，消耗少量 API 额度。</p>
        </fieldset>
      </form>
      {error && <p className="form-error" role="alert">{error}</p>}
      <p className="feedback" role="status">{notice}</p>
    </section>
  </div>;
}
