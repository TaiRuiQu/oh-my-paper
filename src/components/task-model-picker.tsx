"use client";
import { useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { AI_PURPOSES, type AiPurpose } from "@/contracts/ai-providers";
import { modelChoiceHint, type TaskModelSelection, type UserAiSettings } from "@/contracts/user-ai";
import { apiRequest } from "@/lib/http-client";
export function useTaskModelSettings(initialData?: UserAiSettings) {
  return useQuery({
    queryKey: ["user-ai-settings"],
    queryFn: () => apiRequest<UserAiSettings>("/api/ai/settings"),
    initialData,
  });
}
export function TaskModelPicker({
  query,
  purposes,
  value,
  onChange,
  disabled = false,
}: {
  query: ReturnType<typeof useTaskModelSettings>;
  purposes: AiPurpose[];
  value: TaskModelSelection;
  onChange: (value: TaskModelSelection) => void;
  disabled?: boolean;
}) {
  const id = useId(),
    settings = query.data;
  return (
    <div className="task-model-picker" role="group" aria-label="本次任务的模型">
      <div className="task-model-fields">
        {purposes.map((purpose) => {
          const preference = settings?.selections[purpose];
          const fallback = preference
            ? settings?.models.find((model) => model.id === preference)
            : settings?.adminDefaults
              ? settings.adminDefaults[purpose]
              : settings?.models.find((model) => model.id === settings.defaults[purpose]);
          const unavailablePreference = !!preference && !fallback;
          const selected = settings?.models.find((model) => model.id === value[purpose]);
          const unavailableChoice = !!value[purpose] && !selected;
          return (
            <div className="field" key={purpose}>
              <label htmlFor={`${id}-${purpose}`}>{AI_PURPOSES[purpose]}模型</label>
              <select
                id={`${id}-${purpose}`}
                value={value[purpose] ?? ""}
                disabled={disabled || query.isPending || !!query.error || !settings?.models.length}
                onChange={(event) => {
                  const next = { ...value };
                  if (event.target.value) next[purpose] = event.target.value;
                  else delete next[purpose];
                  onChange(next);
                }}
              >
                <option value="">
                  {query.isPending
                    ? "正在加载模型…"
                    : unavailablePreference
                      ? "账户模型已停止开放，请选择"
                      : `使用${preference ? "账户" : "后台"}默认${fallback ? ` · ${fallback.name} · ${fallback.creditMultiplier}×` : ""}`}
                </option>
                {unavailableChoice && (
                  <option value={value[purpose]}>所选模型已停止开放，请重新选择</option>
                )}
                {settings?.models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name} · {model.creditMultiplier}×
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
      <p className="hint">仅用于本次任务，不改变账户默认值。{modelChoiceHint}</p>
      {query.error && (
        <p className="form-error" role="alert">
          模型列表暂时无法加载。
          <button className="text-action" type="button" onClick={() => void query.refetch()}>
            重试
          </button>
        </p>
      )}
      {!query.isPending && !query.error && !settings?.models.length && (
        <p className="hint">
          暂无公开模型。{settings?.unlimited ? "可使用后台默认模型。" : "请联系管理员开放模型。"}
        </p>
      )}
    </div>
  );
}
