"use client";
import { API_TYPES, AI_STAGES, type AiStage } from "@/contracts/ai-providers";
import type { ProviderSettings } from "./use-provider-settings";

export function ProviderList({ settings }: { settings: ProviderSettings }) {
  const { providers, busy, deleting, edit, selectStage, setDeleting, activate, remove } = settings;
  return (
    <section className="provider-list" aria-labelledby="providers-heading">
      <div className="advanced-settings">
        <h2>流程模型</h2>
        <p className="hint">
          选择试卷识别 Agent、标准答案与批改的模型。识别 Agent
          自主调用工具；标准答案默认沿用批改模型。
        </p>
        {(Object.entries(AI_STAGES) as [AiStage, string][]).map(([stage, label]) => (
          <div className="field" key={stage}>
            <label htmlFor={`stage-model-${stage}`}>{label}</label>
            <select
              id={`stage-model-${stage}`}
              disabled={!!busy || !providers.length}
              value={providers.find((p) => p.stages?.includes(stage))?.id ?? ""}
              onChange={(event) => void selectStage(stage, event.target.value)}
            >
              <option value="" disabled>
                请选择模型
              </option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.model}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      <div className="section-heading">
        <h2 id="providers-heading">提供商</h2>
        <button className="text-button" disabled={!!busy} onClick={() => edit()}>
          新增提供商
        </button>
      </div>
      {!providers.length && (
        <p className="muted setup-note">添加支持图片输入的模型，保存后设为当前识别模型。</p>
      )}
      {providers.map((provider) => (
        <article className="provider-row" key={provider.id}>
          <div className="section-heading">
            <h3>{provider.name}</h3>
            <div className="inline-actions">
              {provider.active && <span className="status-tag">当前识别模型</span>}
              {provider.gradingActive && <span className="status-tag">当前批改模型</span>}
            </div>
          </div>
          <p className="provider-model">{provider.model}</p>
          <p className="hint">
            {API_TYPES[provider.apiType]} · 最大并发 {provider.maxConcurrency}
          </p>
          <div className="inline-actions">
            <button className="text-button" disabled={!!busy} onClick={() => edit(provider)}>
              编辑<span className="sr-only">{provider.name}</span>
            </button>
            {!provider.active && (
              <button
                className="text-button"
                disabled={!!busy}
                onClick={() => void activate(provider, "exam")}
              >
                用于识别
              </button>
            )}
            {!provider.gradingActive && (
              <button
                className="text-button"
                disabled={!!busy}
                onClick={() => void activate(provider, "grading")}
              >
                用于批改
              </button>
            )}
            <button
              className="text-button danger"
              disabled={!!busy}
              onClick={() => setDeleting(provider.id)}
            >
              删除<span className="sr-only">{provider.name}</span>
            </button>
          </div>
          {deleting === provider.id && (
            <div className="delete-confirm">
              <p>
                删除 {provider.name}？{provider.active ? "删除后需要重新选择识别模型。" : ""}
              </p>
              <div className="inline-actions">
                <button
                  className="text-button danger"
                  disabled={!!busy}
                  onClick={() => void remove(provider)}
                >
                  确认删除
                </button>
                <button className="text-button" onClick={() => setDeleting(null)} disabled={!!busy}>
                  取消
                </button>
              </div>
            </div>
          )}
        </article>
      ))}
    </section>
  );
}
