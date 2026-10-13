"use client";
import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AI_PURPOSES,
  REASONING_LABELS,
  type ReasoningEffort,
  type AiPurpose,
} from "@/contracts/ai-providers";
import { type UserAiSettings } from "@/contracts/user-ai";
import { apiRequest, jsonBody } from "@/lib/http-client";
import { formatCredits } from "@/lib/credits";

export function UserModelSettings({ initialSettings }: { initialSettings: UserAiSettings }) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["user-ai-settings"],
    queryFn: () => apiRequest<UserAiSettings>("/api/ai/settings"),
    initialData: initialSettings,
    refetchInterval: 5000,
  });
  const settings = query.data;
  return (
    <>
      <section className="surface user-credit-summary" aria-label="Credit 余额与计费说明">
        <div className="section-heading">
          <h2>可用额度</h2>
          <strong
            className={!settings.unlimited && Number(settings.credits) < 0 ? "form-error" : ""}
          >
            {settings.unlimited ? "不限量" : `${formatCredits(settings.credits)} credit`}
          </strong>
        </div>
        <p>{settings.unlimited ? "管理员额度不限量。" : "注册即赠送 100 credit。"}</p>
        <p className="hint">
          {settings.unlimited
            ? "模型用量仍会记录，管理员账户不扣减 credit。"
            : "余额变负后，当前处理会继续完成，但无法创建新任务。"}
        </p>
      </section>
      <section className="surface model-assignments" aria-labelledby="user-model-title">
        <h2 id="user-model-title">选择 AI 模型</h2>
        <p className="hint">可保存账户偏好的模型。创建任务时仍可另选，仅对本次任务生效。</p>
        {!settings.models.length && <p role="status">管理员尚未开放模型，请联系管理员。</p>}
        {query.error && (
          <p role="alert" className="form-error">
            配置暂时无法刷新。
            <button className="text-action" onClick={() => void query.refetch()}>
              重试
            </button>
          </p>
        )}
        {(Object.keys(AI_PURPOSES) as AiPurpose[]).map((purpose) => (
          <UserModelAssignment
            key={`${purpose}:${settings.selections[purpose]}:${settings.reasoningSelections?.[purpose]}`}
            purpose={purpose}
            settings={settings}
            onSaved={(next) => {
              client.setQueryData(["user-ai-settings"], next);
              client.setQueryData(["credit-balance"], {
                credits: next.credits,
                unlimited: next.unlimited,
              });
            }}
          />
        ))}
      </section>
    </>
  );
}
function UserModelAssignment({
  purpose,
  settings,
  onSaved,
}: {
  purpose: AiPurpose;
  settings: UserAiSettings;
  onSaved: (next: UserAiSettings) => void;
}) {
  const original = settings.selections[purpose] ?? "";
  const originalEffort = settings.reasoningSelections?.[purpose] ?? "";
  const [effort, setEffort] = useState<ReasoningEffort | "">(originalEffort);
  const [selected, setSelected] = useState(original),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const unavailable = !!selected && !settings.models.some((model) => model.id === selected);
  const defaultModel = settings.adminDefaults
    ? settings.adminDefaults[purpose]
    : settings.models.find((model) => model.id === settings.defaults[purpose]);
  const current = selected ? settings.models.find((model) => model.id === selected) : defaultModel;
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      onSaved(
        await apiRequest<UserAiSettings>("/api/ai/settings", {
          method: "PUT",
          ...jsonBody({ purpose, modelId: selected || null, reasoningEffort: effort || null }),
        }),
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : "保存失败，请重试。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="user-model-assignment" aria-label={AI_PURPOSES[purpose]} onSubmit={save}>
      <label htmlFor={`user-model-${purpose}`}>{AI_PURPOSES[purpose]}</label>
      <select
        id={`user-model-${purpose}`}
        value={selected}
        disabled={busy || !settings.models.length}
        onChange={(event) => {
          setSelected(event.target.value);
          setEffort("");
        }}
      >
        <option value="">
          使用默认模型
          {defaultModel ? ` · ${defaultModel.name}` : ""}
        </option>
        {unavailable && <option value={selected}>原模型已停止开放，请重新选择</option>}
        {settings.models.map((model) => (
          <option key={model.id} value={model.id}>
            {model.name} · {model.creditMultiplier}×
          </option>
        ))}
      </select>
      <div className="field">
        <label htmlFor={`user-effort-${purpose}`}>推理强度</label>
        <select
          id={`user-effort-${purpose}`}
          value={effort}
          disabled={busy || !selected || unavailable}
          onChange={(event) => setEffort(event.target.value as ReasoningEffort | "")}
        >
          <option value="">使用默认推理强度</option>
          {current?.reasoningEfforts?.map((item) => (
            <option key={item} value={item}>
              {REASONING_LABELS[item]}
            </option>
          ))}
        </select>
      </div>
      <button
        className="button secondary"
        disabled={
          busy ||
          unavailable ||
          (selected === original && effort === originalEffort) ||
          !settings.models.length
        }
      >
        {busy ? "正在保存" : selected === original && effort === originalEffort ? "已保存" : "保存"}
      </button>
      {error && (
        <p className="form-error assignment-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
