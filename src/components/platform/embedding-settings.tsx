"use client";

import { useEffect, useState } from "react";
import type { AdminSearchConfiguration } from "@/contracts/platform-search";
import { apiRequest, jsonBody } from "@/lib/http-client";
import { Empty, Field, Panel, readForm, stringField } from "./primitives";
import { openAiProgress } from "@/lib/ai-progress-client";

export function EmbeddingSettings({
  notify,
}: {
  notify: (message: string, error?: boolean) => void;
}) {
  const [configuration, setConfiguration] = useState<AdminSearchConfiguration>();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<"save" | "reindex">();
  const [error, setError] = useState("");

  useEffect(() => {
    return openAiProgress({
      search: true,
      snapshot: (data) => {
        setConfiguration(data.searchConfiguration);
        setError("");
      },
      error: () => setError("暂时无法更新向量化进度，正在重新连接。"),
    });
  }, []);

  async function save(body: unknown, action: "save" | "reindex") {
    setBusy(action);
    setError("");
    try {
      const result = await apiRequest<{ queued?: number }>("/api/platform/admin", {
        method: "POST",
        ...jsonBody(body),
      });
      if (action === "save") {
        setEditing(false);
        notify("向量化配置已保存。首次配置或更换模型后，请重建题目索引。");
      } else {
        notify(`已安排 ${result.queued ?? 0} 道题重新索引，后台将逐题处理。`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败，请重试。");
    } finally {
      setBusy(undefined);
    }
  }

  const embedding = configuration?.embedding;
  const index = configuration?.searchIndex;
  return (
    <Panel
      title="向量化模型与语义搜索"
      description="配置用于理解题意的向量化模型。题目向量保存在 Qdrant，教师可按题意搜索题库。"
      actions={
        <button
          type="button"
          className="button"
          disabled={!configuration || !!busy || editing}
          onClick={() => {
            setError("");
            setEditing(true);
          }}
        >
          {embedding ? "编辑向量化配置" : "配置向量化模型"}
        </button>
      }
    >
      {error && (
        <p className="p-notice error" role="alert">
          {error}
        </p>
      )}
      {!configuration && !error && (
        <p className="p-panel-content" role="status">
          正在加载向量化配置…
        </p>
      )}
      {editing && (
        <form
          className="p-form"
          onSubmit={(event) => {
            const data = readForm(event);
            void save(
              {
                type: "embedding.save",
                embedding: {
                  name: stringField(data, "name"),
                  apiType: stringField(data, "apiType"),
                  baseURL: stringField(data, "baseURL"),
                  apiKey: stringField(data, "apiKey") || undefined,
                  model: stringField(data, "model"),
                  dimensions: Number(data.get("dimensions")),
                  enabled: data.get("enabled") === "true",
                },
              },
              "save",
            );
          }}
        >
          <div className="p-form-grid">
            <Field label="显示名称">
              <input name="name" required maxLength={80} defaultValue={embedding?.name} />
            </Field>
            <Field label="向量化接口类型">
              <select name="apiType" defaultValue={embedding?.apiType ?? "openai"}>
                <option value="openai">OpenAI Embeddings 兼容</option>
                <option value="google">Google Embeddings</option>
              </select>
            </Field>
            <Field label="向量化接口地址" hint="填写该模型的接口根地址。">
              <input type="url" name="baseURL" required defaultValue={embedding?.baseURL} />
            </Field>
            <Field
              label="向量化 API 密钥"
              hint={embedding?.hasApiKey ? "留空保留已保存的密钥。" : "凭据保存在服务器。"}
            >
              <input
                type="password"
                name="apiKey"
                autoComplete="new-password"
                required={!embedding?.hasApiKey}
              />
            </Field>
            <Field label="向量化模型 ID">
              <input name="model" required maxLength={120} defaultValue={embedding?.model} />
            </Field>
            <Field label="向量维度" hint="须与模型实际输出的维度一致；更改后需要重建索引。">
              <input
                type="number"
                name="dimensions"
                required
                min={1}
                max={65536}
                step={1}
                defaultValue={embedding?.dimensions}
              />
            </Field>
            <Field label="语义搜索状态">
              <select name="enabled" defaultValue={embedding?.enabled === false ? "false" : "true"}>
                <option value="true">启用</option>
                <option value="false">停用</option>
              </select>
            </Field>
          </div>
          <p className="p-muted">
            保存配置后，新建和编辑题目会自动同步索引。更换模型或维度后，存量题目需重新索引。
          </p>
          <div className="p-actions">
            <button className="button" disabled={!!busy}>
              {busy === "save" ? "正在保存…" : "保存向量化配置"}
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={!!busy}
              onClick={() => setEditing(false)}
            >
              取消
            </button>
          </div>
        </form>
      )}
      {configuration && (
        <div className="p-panel-content">
          {embedding ? (
            <>
              <div className="p-list-row">
                <span>当前模型</span>
                <strong>
                  {embedding.name} · {embedding.model}
                </strong>
              </div>
              <div className="p-list-row">
                <span>语义搜索</span>
                <strong>{embedding.enabled ? "已启用" : "已停用"}</strong>
              </div>
              <div className="p-list-row">
                <span>向量维度</span>
                <strong>{embedding.dimensions}</strong>
              </div>
            </>
          ) : (
            <Empty>尚未配置向量化模型。配置并建立索引后，题库即可使用语义搜索。</Empty>
          )}
          {index && (
            <>
              <div className="p-list-row">
                <span>索引覆盖</span>
                <strong>
                  {index.indexed} / {index.total} 道题
                </strong>
              </div>
              <div className="p-list-row" role="status">
                <span>处理状态</span>
                <span>
                  {index.pending} 道待处理 · {index.failed} 道失败
                </span>
              </div>
              {index.lastError && (
                <p className="p-notice error" role="alert">
                  {index.lastError}
                </p>
              )}
            </>
          )}
          <p className="p-muted">
            向量数据库 Qdrant 由部署配置连接。重建索引会调用向量化模型处理题库中的存量题目。
          </p>
          <button
            type="button"
            className="button secondary"
            disabled={!embedding?.enabled || !!busy || !!index?.pending || editing}
            onClick={() => void save({ type: "embedding.reindex" }, "reindex")}
          >
            {busy === "reindex" ? "正在安排…" : index?.pending ? "正在建立索引…" : "重建题目索引"}
          </button>
        </div>
      )}
    </Panel>
  );
}
