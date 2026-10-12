"use client";
import {
  API_TYPES,
  DEFAULT_AI_CONCURRENCY,
  MAX_AI_CONCURRENCY,
  type ProviderInput,
} from "@/contracts/ai-providers";
import { PROMPT_PRESETS } from "@/contracts/prompt-presets";
import { Input } from "@/components/ui/input";
import { providerBaseURLs } from "./provider-form";
import type { ProviderSettings } from "./use-provider-settings";

export function ProviderEditor({ settings }: { settings: ProviderSettings }) {
  const { form, editing, busy, error, notice, update, setForm, save, testConnection } = settings;
  return (
    <section className="provider-editor" aria-labelledby="provider-edit-heading">
      <h2 id="provider-edit-heading">{editing ? "编辑 AI 提供商" : "添加 AI 提供商"}</h2>
      <p className="hint">接口类型由服务商的 API 协议决定。模型需要支持图片输入。</p>
      <form onSubmit={save}>
        <fieldset disabled={!!busy}>
          <div className="field">
            <label htmlFor="provider-name">提供商名称</label>
            <input
              id="provider-name"
              required
              maxLength={80}
              value={form.name}
              placeholder="用于区分不同配置"
              onChange={(e) => update("name", e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="api-type">API 接口类型</label>
            <select
              id="api-type"
              value={form.apiType}
              onChange={(e) => {
                const type = e.target.value as ProviderInput["apiType"];
                setForm((old) => ({
                  ...old,
                  apiType: type,
                  baseURL: Object.values(providerBaseURLs).includes(old.baseURL)
                    ? providerBaseURLs[type]
                    : old.baseURL,
                }));
              }}
            >
              {Object.entries(API_TYPES).map(([type, label]) => (
                <option value={type} key={type}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="base-url">API base URL</label>
            <input
              id="base-url"
              type="url"
              required
              maxLength={500}
              value={form.baseURL}
              onChange={(e) => update("baseURL", e.target.value)}
              aria-describedby="url-hint"
            />
            <p className="hint" id="url-hint">
              填写完整的 API 前缀（如包含 /v1），无需追加 /responses 或 /chat/completions。
            </p>
          </div>
          <div className="field">
            <label htmlFor="api-key">API key{editing ? "（留空保留已存密钥）" : ""}</label>
            <input
              id="api-key"
              type="password"
              autoComplete="new-password"
              required={!editing}
              maxLength={4096}
              value={form.apiKey}
              onChange={(e) => update("apiKey", e.target.value)}
              aria-describedby="key-hint"
            />
            <p className="hint" id="key-hint">
              密钥加密保存，保存后不会显示。
            </p>
          </div>
          <div className="field">
            <label htmlFor="model-name">模型名称</label>
            <input
              id="model-name"
              required
              maxLength={160}
              value={form.model}
              placeholder="填写服务商提供的完整模型 ID"
              onChange={(e) => update("model", e.target.value)}
            />
            <p className="hint">可填写自定义模型，不限定服务商。</p>
          </div>
          <div className="field">
            <label htmlFor="prompt-preset">系统提示词预设</label>
            <select
              id="prompt-preset"
              value={form.promptPreset}
              onChange={(e) =>
                update("promptPreset", e.target.value as ProviderInput["promptPreset"])
              }
            >
              {Object.entries(PROMPT_PRESETS).map(([id, preset]) => (
                <option value={id} key={id}>
                  {preset.label}
                </option>
              ))}
            </select>
            <p className="hint">
              {PROMPT_PRESETS[form.promptPreset].description}{" "}
              <a href={PROMPT_PRESETS[form.promptPreset].source} target="_blank" rel="noreferrer">
                官方编写指南
              </a>
            </p>
            <p className="hint">
              按模型提供商选择；与 API 接口类型独立。预设用于识别、独立求解与批改各阶段。
            </p>
          </div>
          <div className="field">
            <label htmlFor="max-concurrency">最大并发数</label>
            <Input
              id="max-concurrency"
              type="number"
              min={1}
              max={MAX_AI_CONCURRENCY}
              step={1}
              required
              value={Number.isNaN(form.maxConcurrency) ? "" : form.maxConcurrency}
              onChange={(e) =>
                update("maxConcurrency", e.target.value === "" ? NaN : Number(e.target.value))
              }
              aria-describedby="concurrency-hint"
            />
            <p className="hint" id="concurrency-hint">
              同一供应商可同时处理的请求数，默认 {DEFAULT_AI_CONCURRENCY}
              ，可设为 1–{MAX_AI_CONCURRENCY}。设为 1 时逐题处理；新提交的任务使用保存后的设置。
            </p>
          </div>
          <details className="advanced-settings">
            <summary>高级设置</summary>
            {form.apiType === "openai_chat" && (
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={form.structuredOutputs}
                  onChange={(e) => update("structuredOutputs", e.target.checked)}
                />
                接口支持 JSON Schema 输出
                <p className="hint">关闭时使用 JSON Object 模式，并在服务端校验结构。</p>
              </label>
            )}
            <div className="field">
              <label htmlFor="output-tokens">最大输出 token 数</label>
              <input
                id="output-tokens"
                type="number"
                min={1024}
                max={64000}
                required
                value={form.maxOutputTokens}
                onChange={(e) => update("maxOutputTokens", Number(e.target.value))}
              />
              <p className="hint">请按模型限制设置；内容较多时需要更长的输出。</p>
            </div>
            <div className="field">
              <label htmlFor="timeout-seconds">每次调用超时（秒）</label>
              <input
                id="timeout-seconds"
                type="number"
                min={15}
                max={600}
                required
                value={form.timeoutSeconds}
                onChange={(e) => update("timeoutSeconds", Number(e.target.value))}
              />
            </div>
          </details>
          <div className="inline-actions">
            <button className="button" type="submit">
              {busy === "save" ? "正在保存…" : "保存配置"}
            </button>
            <button
              className="button secondary"
              type="button"
              onClick={() => void testConnection()}
            >
              {busy === "test" ? "正在测试…" : "测试连接"}
            </button>
          </div>
          <p className="hint">测试会调用模型检查图片输入和 JSON 输出，消耗少量 API 额度。</p>
        </fieldset>
      </form>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <p className="feedback" role="status">
        {notice}
      </p>
    </section>
  );
}
