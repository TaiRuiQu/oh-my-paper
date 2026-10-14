"use client";
import { useRef, useState, type FormEvent } from "react";
import {
  API_TYPES,
  AI_PURPOSES,
  MAX_OUTPUT_TOKENS,
  type AiPurpose,
  REASONING_EFFORTS,
  supportsReasoningEffort,
  providerInputSchema,
  type ProviderInput,
  type ProviderSummary,
  type ReasoningEffort,
} from "@/contracts/ai-providers";
import { reportClientError } from "@/lib/error-message";
import { apiRequest, jsonBody } from "@/lib/http-client";
const effortLabels: Record<ReasoningEffort, string> = {
  default: "默认",
  none: "关闭",
  minimal: "最低",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "更高",
  max: "最高",
};
const emptyProvider = (): ProviderInput => ({
  name: "",
  apiType: "openai_responses",
  baseURL: "",
  apiKey: "",
  structuredOutputs: true,
  maxOutputTokens: MAX_OUTPUT_TOKENS,
  timeoutSeconds: 240,
  maxConcurrency: 3,
  models: [{ name: "", reasoningEfforts: ["default"] }],
});
export function AiProviderSettings({ initialProviders }: { initialProviders: ProviderSummary[] }) {
  const [providers, setProviders] = useState(initialProviders),
    [editingId, setEditingId] = useState<string>(),
    [draft, setDraft] = useState<ProviderInput | null>(null),
    [deletingId, setDeletingId] = useState<string>(),
    [notice, setNotice] = useState<string>(),
    [error, setError] = useState<string>(),
    [busy, setBusy] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  async function reload() {
    setProviders(
      (await apiRequest<{ providers: ProviderSummary[] }>("/api/admin/ai/providers")).providers,
    );
  }
  function edit(provider?: ProviderSummary) {
    setDeletingId(undefined);
    setNotice(undefined);
    setEditingId(provider?.id);
    setError(undefined);
    setDraft(
      provider
        ? {
            name: provider.name,
            apiType: provider.apiType,
            baseURL: provider.baseURL,
            apiKey: "",
            structuredOutputs: provider.structuredOutputs,
            maxOutputTokens: provider.maxOutputTokens,
            timeoutSeconds: provider.timeoutSeconds,
            maxConcurrency: provider.maxConcurrency,
            models: provider.models,
          }
        : emptyProvider(),
    );
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    const result = providerInputSchema.safeParse(draft);
    if (!result.success) {
      setError(result.error.issues[0].message);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await apiRequest(
        editingId ? `/api/admin/ai/providers/${editingId}` : "/api/admin/ai/providers",
        { method: editingId ? "PUT" : "POST", ...jsonBody(result.data) },
      );
      await reload();
      setDraft(null);
    } catch (error) {
      setError(reportClientError("ai.settings", error));
    } finally {
      setBusy(false);
    }
  }
  async function activate(
    purpose: AiPurpose,
    provider: ProviderSummary,
    modelId: string,
    reasoningEffort: ReasoningEffort,
  ) {
    setBusy(true);
    setError(undefined);
    try {
      await apiRequest(`/api/admin/ai/providers/${provider.id}/activate`, {
        method: "POST",
        ...jsonBody({ purpose, modelId, reasoningEffort }),
      });
      await reload();
    } catch (error) {
      setError(reportClientError("ai.settings", error));
    } finally {
      setBusy(false);
    }
  }
  async function remove(provider: ProviderSummary) {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await apiRequest(`/api/admin/ai/providers/${provider.id}`, { method: "DELETE" });
      if (editingId === provider.id) {
        setDraft(null);
        setEditingId(undefined);
      }
      setDeletingId(undefined);
      await reload();
      setNotice(`已删除提供商「${provider.name}」。请检查功能默认模型配置。`);
      requestAnimationFrame(() => addButton.current?.focus());
    } catch (error) {
      setError(reportClientError("ai.provider.delete", error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="provider-settings">
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <section className="surface model-assignments" aria-labelledby="model-assignments-title">
        <h2 id="model-assignments-title">功能默认模型</h2>
        <p className="hint">每项独立保存。用户创建任务时可以另选模型，未选择时使用默认配置。</p>
        {!providers.length && <p className="hint">先添加提供商和模型，再选择各功能使用的模型。</p>}
        {(Object.keys(AI_PURPOSES) as AiPurpose[]).map((purpose) => {
          const active = providers.find((provider) => provider.selections[purpose])?.selections[
            purpose
          ];
          return (
            <ModelAssignment
              key={`${purpose}:${active?.modelId}:${active?.reasoningEffort}:${providers.map((item) => item.id).join(",")}`}
              purpose={purpose}
              providers={providers}
              busy={busy}
              onSave={activate}
            />
          );
        })}
      </section>
      {providers.map((provider) => (
        <section className="provider-section" key={provider.id}>
          <div className="section-heading">
            <h2>{provider.name}</h2>
            <div className="delete-confirmation">
              <button className="button secondary" disabled={busy} onClick={() => edit(provider)}>
                编辑
              </button>
              {deletingId !== provider.id && (
                <button
                  className="text-action danger-action"
                  disabled={busy}
                  aria-label={`删除提供商 ${provider.name}`}
                  onClick={() => {
                    setError(undefined);
                    setNotice(undefined);
                    setDeletingId(provider.id);
                  }}
                >
                  删除
                </button>
              )}
            </div>
          </div>
          {deletingId === provider.id && (
            <div role="group" aria-label={`确认删除提供商 ${provider.name}`}>
              <p>
                删除「{provider.name}
                」及其全部模型？关联的功能默认模型和用户选择将清除，需重新配置。
                已有任务和用量记录保留。
              </p>
              <div className="delete-confirmation">
                <button
                  className="text-action danger-action"
                  disabled={busy}
                  onClick={() => void remove(provider)}
                >
                  {busy ? "正在删除…" : "确认删除"}
                </button>
                <button
                  className="text-action"
                  disabled={busy}
                  onClick={() => setDeletingId(undefined)}
                >
                  取消
                </button>
              </div>
            </div>
          )}
          <p className="hint">
            {API_TYPES[provider.apiType]} · {provider.baseURL}
          </p>
          <ul className="model-list">
            {provider.models.map((model) => (
              <li key={model.id}>
                <strong title={model.name}>{model.displayName || model.name}</strong>
                {model.displayName && <span className="hint model-api-code">{model.name}</span>}
                <span className="hint">
                  {model.isPublic ? "公众可选" : "未公开"} · {model.creditMultiplier ?? 1}× 计费 ·
                  推理选项：
                  {model.reasoningEfforts.map((effort) => effortLabels[effort]).join(" / ")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {!draft ? (
        <button ref={addButton} className="button" onClick={() => edit()} disabled={busy}>
          添加提供商
        </button>
      ) : (
        <form className="provider-form" onSubmit={save}>
          <h2>{editingId ? "编辑提供商" : "添加提供商"}</h2>
          <fieldset disabled={busy}>
            <div className="field">
              <label htmlFor="provider-name">提供商名称</label>
              <input
                id="provider-name"
                required
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="api-type">API 协议</label>
              <select
                id="api-type"
                value={draft.apiType}
                onChange={(event) => {
                  const apiType = event.target.value as ProviderInput["apiType"];
                  setDraft({
                    ...draft,
                    apiType,
                    models: draft.models.map((model) => ({
                      ...model,
                      reasoningEfforts: model.reasoningEfforts.filter((effort) =>
                        supportsReasoningEffort(apiType, effort),
                      ),
                    })),
                  });
                }}
              >
                {Object.entries(API_TYPES).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="base-url">API Base URL</label>
              <input
                id="base-url"
                type="url"
                required
                value={draft.baseURL}
                placeholder={
                  draft.apiType === "google" || draft.apiType === "google_interactions"
                    ? "https://generativelanguage.googleapis.com/v1beta"
                    : undefined
                }
                onChange={(event) => setDraft({ ...draft, baseURL: event.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="api-key">API key{editingId ? "（留空保留现有密钥）" : ""}</label>
              <input
                id="api-key"
                type="password"
                autoComplete="new-password"
                required={!editingId}
                value={draft.apiKey}
                onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
              />
            </div>
            <h3>模型</h3>
            {draft.models.map((model, index) => (
              <fieldset className="model-editor" key={model.id ?? index}>
                <legend>模型 {index + 1}</legend>
                <div className="field">
                  <label htmlFor={`model-${index}`}>API 模型代码</label>
                  <input
                    id={`model-${index}`}
                    required
                    value={model.name}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        models: draft.models.map((item, i) =>
                          i === index ? { ...item, name: event.target.value } : item,
                        ),
                      })
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor={`model-display-${index}`}>显示名称（可选）</label>
                  <input
                    id={`model-display-${index}`}
                    maxLength={80}
                    placeholder="例如：高精度解析"
                    value={model.displayName ?? ""}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        models: draft.models.map((item, i) =>
                          i === index ? { ...item, displayName: event.target.value } : item,
                        ),
                      })
                    }
                  />
                  <p className="hint">
                    用于模型选项与排行榜；留空时显示 API 模型代码，不影响实际调用。
                  </p>
                </div>
                <div className="field">
                  <label>
                    <input
                      type="checkbox"
                      checked={model.isPublic ?? false}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          models: draft.models.map((item, i) =>
                            i === index ? { ...item, isPublic: event.target.checked } : item,
                          ),
                        })
                      }
                    />
                    对公众开放
                  </label>
                </div>
                <div className="field">
                  <label htmlFor={`model-multiplier-${index}`}>扣费倍率</label>
                  <input
                    id={`model-multiplier-${index}`}
                    type="number"
                    min="0.0001"
                    max="1000"
                    step="0.0001"
                    required
                    value={model.creditMultiplier ?? 1}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        models: draft.models.map((item, i) =>
                          i === index
                            ? { ...item, creditMultiplier: Number(event.target.value) }
                            : item,
                        ),
                      })
                    }
                  />
                  <p className="hint">
                    实际 token 用量折算为 credit 后乘以此倍率。修改只影响新任务。
                  </p>
                </div>
                <p className="hint">选择此模型支持的推理选项。</p>
                <div className="effort-options">
                  {REASONING_EFFORTS.filter((effort) =>
                    supportsReasoningEffort(draft.apiType, effort),
                  ).map((effort) => (
                    <label key={effort}>
                      <input
                        type="checkbox"
                        checked={model.reasoningEfforts.includes(effort)}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            models: draft.models.map((item, i) =>
                              i === index
                                ? {
                                    ...item,
                                    reasoningEfforts: event.target.checked
                                      ? [...item.reasoningEfforts, effort]
                                      : item.reasoningEfforts.filter((value) => value !== effort),
                                  }
                                : item,
                            ),
                          })
                        }
                      />
                      {effortLabels[effort]}
                    </label>
                  ))}
                </div>
                <button
                  className="button secondary"
                  type="button"
                  disabled={draft.models.length <= 1}
                  onClick={() =>
                    setDraft({ ...draft, models: draft.models.filter((_, i) => i !== index) })
                  }
                >
                  移除模型
                </button>
              </fieldset>
            ))}
            <button
              className="button secondary"
              type="button"
              onClick={() =>
                setDraft({
                  ...draft,
                  models: [...draft.models, { name: "", reasoningEfforts: ["default"] }],
                })
              }
            >
              添加模型
            </button>
            <details className="advanced-settings">
              <summary>请求设置</summary>
              {(
                [
                  ["maxOutputTokens", "最大输出 tokens", 1024, MAX_OUTPUT_TOKENS],
                  ["timeoutSeconds", "请求超时（秒）", 15, 1800],
                  ["maxConcurrency", "并发请求数", 1, 32],
                ] as const
              ).map(([key, label, min, max]) => (
                <div className="field" key={key}>
                  <label htmlFor={key}>{label}</label>
                  <input
                    id={key}
                    type="number"
                    min={min}
                    max={max}
                    required
                    value={draft[key]}
                    onChange={(event) => setDraft({ ...draft, [key]: Number(event.target.value) })}
                  />
                </div>
              ))}
            </details>
            <div className="inline-actions">
              <button className="button">{busy ? "正在保存…" : "保存"}</button>
              <button className="button secondary" type="button" onClick={() => setDraft(null)}>
                取消
              </button>
            </div>
          </fieldset>
        </form>
      )}
    </section>
  );
}

function ModelAssignment({
  purpose,
  providers,
  busy,
  onSave,
}: {
  purpose: AiPurpose;
  providers: ProviderSummary[];
  busy: boolean;
  onSave: (
    purpose: AiPurpose,
    provider: ProviderSummary,
    modelId: string,
    reasoningEffort: ReasoningEffort,
  ) => Promise<void>;
}) {
  const active = providers.find((provider) => provider.selections[purpose])?.selections[purpose];
  const [modelId, setModelId] = useState(active?.modelId ?? "");
  const [effort, setEffort] = useState<ReasoningEffort>(active?.reasoningEffort ?? "default");
  const provider = providers.find((item) => item.models.some((model) => model.id === modelId));
  const model = provider?.models.find((item) => item.id === modelId);
  const saved = active?.modelId === modelId && active?.reasoningEffort === effort;
  return (
    <form
      className="model-assignment"
      aria-label={AI_PURPOSES[purpose]}
      onSubmit={(event) => {
        event.preventDefault();
        if (provider && model && !busy && !saved) void onSave(purpose, provider, modelId, effort);
      }}
    >
      <div className="model-assignment-title">
        <h3>{AI_PURPOSES[purpose]}</h3>
        <span className="hint">{active ? "已配置" : "尚未配置"}</span>
      </div>
      <div className="field">
        <label htmlFor={`model-purpose-${purpose}`}>模型</label>
        <select
          id={`model-purpose-${purpose}`}
          value={modelId}
          disabled={busy || !providers.length}
          required
          onChange={(event) => {
            const id = event.target.value;
            setModelId(id);
            const nextModel = providers
              .flatMap((item) => item.models)
              .find((item) => item.id === id);
            setEffort(nextModel?.reasoningEfforts[0] ?? "default");
          }}
        >
          <option value="" disabled>
            请选择模型
          </option>
          {providers.map((item) => (
            <optgroup label={item.name} key={item.id}>
              {item.models.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.displayName || candidate.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`effort-purpose-${purpose}`}>推理程度</label>
        <select
          id={`effort-purpose-${purpose}`}
          value={effort}
          disabled={busy || !model}
          onChange={(event) => setEffort(event.target.value as ReasoningEffort)}
        >
          {(model?.reasoningEfforts ?? ["default" as const]).map((value) => (
            <option key={value} value={value}>
              {effortLabels[value]}
            </option>
          ))}
        </select>
      </div>
      <button className="button secondary" disabled={busy || !model || saved}>
        {saved ? "已保存" : "保存配置"}
      </button>
    </form>
  );
}
