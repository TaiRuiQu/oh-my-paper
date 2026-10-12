"use client";
import { useState, type FormEvent } from "react";
import {
  AI_STAGES,
  providerInputSchema,
  type AiStage,
  type ProviderInput,
  type ProviderSummary,
} from "@/contracts/ai-providers";
import { apiRequest, jsonBody } from "@/lib/http-client";
import { emptyProviderForm, providerBaseURLs } from "./provider-form";

export function useProviderSettings(initialProviders: ProviderSummary[]) {
  const [providers, setProviders] = useState(initialProviders);
  const [form, setForm] = useState<ProviderInput>({
    ...emptyProviderForm,
    baseURL: providerBaseURLs.openai_responses,
  });
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const update = <K extends keyof ProviderInput>(key: K, value: ProviderInput[K]) =>
    setForm((old) => ({ ...old, [key]: value }));

  async function refresh() {
    const data = await apiRequest<{ providers: ProviderSummary[] }>("/api/admin/ai/providers");
    setProviders(data.providers);
  }
  async function action(name: string, operation: () => Promise<void>) {
    setBusy(name);
    setError("");
    setNotice("");
    try {
      await operation();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败，请重试。");
    } finally {
      setBusy("");
    }
  }
  function edit(provider?: ProviderSummary) {
    setEditing(provider?.id ?? null);
    setForm(
      provider
        ? { ...provider, apiKey: "" }
        : { ...emptyProviderForm, baseURL: providerBaseURLs.openai_responses },
    );
    setError("");
    setNotice("");
    setDeleting(null);
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
      const saved = await apiRequest<{ id?: string }>(
        `/api/admin/ai/providers${editing ? `/${editing}` : ""}`,
        { method: editing ? "PATCH" : "POST", ...jsonBody(input) },
      );
      setEditing(editing ?? saved.id ?? null);
      update("apiKey", "");
      await refresh();
      setNotice("配置已保存。点击“用于识别”可设为当前模型。");
    });
  }

  async function selectStage(stage: AiStage, providerId: string) {
    if (!providerId) return;
    await action(`stage-${stage}`, async () => {
      await apiRequest(`/api/admin/ai/providers/${providerId}/activate`, {
        method: "POST",
        ...jsonBody({ purpose: stage }),
      });
      await refresh();
      setNotice(`${AI_STAGES[stage as keyof typeof AI_STAGES]}的模型已更新，新任务将使用此配置。`);
    });
  }

  async function activate(provider: ProviderSummary, purpose: "exam" | "grading") {
    await action(purpose === "exam" ? provider.id : `grade-${provider.id}`, async () => {
      await apiRequest(`/api/admin/ai/providers/${provider.id}/activate`, {
        method: "POST",
        ...(purpose === "grading" ? jsonBody({ purpose: "grading" }) : {}),
      });
      await refresh();
      setNotice(
        purpose === "grading"
          ? `批改将使用 ${provider.name} · ${provider.model}。`
          : `已使用 ${provider.name} · ${provider.model}，新提交的试卷将使用此模型。`,
      );
    });
  }
  async function remove(provider: ProviderSummary) {
    await action("delete", async () => {
      await apiRequest(`/api/admin/ai/providers/${provider.id}`, { method: "DELETE" });
      if (editing === provider.id) edit();
      setDeleting(null);
      await refresh();
      setNotice("提供商已删除。");
    });
  }
  async function testConnection() {
    await action("test", async () => {
      const input = validInput();
      const result = await apiRequest<{ message: string }>("/api/admin/ai/test", {
        method: "POST",
        ...jsonBody({ ...input, ...(editing ? { id: editing } : {}) }),
      });
      setNotice(result.message);
    });
  }
  return {
    providers,
    form,
    editing,
    busy,
    error,
    notice,
    deleting,
    update,
    setForm,
    edit,
    save,
    selectStage,
    setDeleting,
    activate,
    remove,
    testConnection,
  };
}

export type ProviderSettings = ReturnType<typeof useProviderSettings>;
