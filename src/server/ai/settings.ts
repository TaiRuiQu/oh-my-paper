import "server-only";
import {
  AI_PURPOSES,
  aiPurposeSchema,
  type AiPurpose,
  providerInputSchema,
  type ProviderInput,
  type ProviderSnapshot,
  type ProviderSummary,
  type ReasoningEffort,
} from "@/contracts/ai-providers";
import { getDb } from "@/server/db/client";
import { AccessError, RequestError } from "@/server/http/errors";
import { decryptApiKey, encryptApiKey } from "./credentials";

export async function listProviders(): Promise<ProviderSummary[]> {
  const [providers, active] = await Promise.all([
    getDb().aiProvider.findMany({
      include: { models: { orderBy: { name: "asc" } } },
      orderBy: { name: "asc" },
    }),
    getDb().aiSetting.findMany({ where: { id: { in: Object.keys(AI_PURPOSES) } } }),
  ]);
  return providers.map((provider) => ({
    id: provider.id,
    name: provider.name,
    baseURL: provider.baseURL,
    structuredOutputs: provider.structuredOutputs,
    maxOutputTokens: provider.maxOutputTokens,
    timeoutSeconds: provider.timeoutSeconds,
    maxConcurrency: provider.maxConcurrency,
    models: provider.models.map((model) => ({
      id: model.id,
      name: model.name,
      displayName: model.displayName,
      isPublic: model.isPublic,
      creditMultiplier: model.creditMultiplier.toNumber(),
      reasoningEfforts: model.reasoningEfforts as ReasoningEffort[],
    })),
    apiType: provider.apiType as ProviderSummary["apiType"],
    selections: Object.fromEntries(
      Object.keys(AI_PURPOSES).map((purpose) => {
        const setting = active.find((item) => item.id === purpose);
        return [
          purpose,
          setting?.modelId && provider.models.some((model) => model.id === setting.modelId)
            ? {
                modelId: setting.modelId,
                reasoningEffort: setting.reasoningEffort as ReasoningEffort,
              }
            : null,
        ];
      }),
    ) as ProviderSummary["selections"],
  }));
}

export async function saveProvider(raw: ProviderInput, id?: string) {
  const { apiKey, models, ...config } = providerInputSchema.parse(raw);
  return getDb().$transaction(async (tx) => {
    const existing = id
      ? await tx.aiProvider.findUnique({ where: { id }, include: { models: true } })
      : null;
    if (id && !existing) throw new AccessError(404, "提供商不存在。");
    if (!apiKey && !existing) throw new RequestError(400, "新增提供商需要填写 API key。");
    if (
      models.some((model) => model.id && !existing?.models.some((saved) => saved.id === model.id))
    )
      throw new RequestError(400, "模型不属于此提供商，请刷新后重试。");
    const encryptedApiKey = apiKey ? encryptApiKey(apiKey) : existing!.encryptedApiKey;
    decryptApiKey(encryptedApiKey);
    const provider = id
      ? await tx.aiProvider.update({ where: { id }, data: { ...config, encryptedApiKey } })
      : await tx.aiProvider.create({ data: { ...config, encryptedApiKey } });
    // Temporarily rename retained models so renames and name swaps remain atomic.
    for (const model of existing?.models ?? [])
      await tx.aiModel.update({
        where: { id: model.id },
        data: { name: `__updating_${model.id}` },
      });
    await tx.aiModel.deleteMany({
      where: {
        providerId: provider.id,
        id: { notIn: models.flatMap((model) => (model.id ? [model.id] : [])) },
      },
    });
    for (const { id: modelId, ...rawModel } of models) {
      const model = {
        ...rawModel,
        displayName: rawModel.displayName ?? "",
        isPublic: rawModel.isPublic ?? false,
        creditMultiplier: rawModel.creditMultiplier ?? 1,
      };
      if (modelId) await tx.aiModel.update({ where: { id: modelId }, data: model });
      else await tx.aiModel.create({ data: { ...model, providerId: provider.id } });
    }
    const activeSettings = await tx.aiSetting.findMany({
      where: { model: { providerId: provider.id } },
      include: { model: true },
    });
    for (const active of activeSettings) {
      if (
        active?.model?.providerId === provider.id &&
        !active.model.reasoningEfforts.includes(active.reasoningEffort)
      )
        await tx.aiSetting.update({
          where: { id: active.id },
          data: { reasoningEffort: active.model.reasoningEfforts[0] },
        });
    }
    return provider.id;
  });
}

export async function deleteProvider(id: string) {
  // Cascades remove models and user selections; defaults become unconfigured.
  // Task configuration snapshots and usage records have no provider foreign key.
  const deleted = await getDb().aiProvider.deleteMany({ where: { id } });
  if (!deleted.count) throw new AccessError(404, "提供商不存在。");
}

export async function activateModel(
  providerId: string,
  modelId: string,
  reasoningEffort: ReasoningEffort,
  purpose: AiPurpose = "exam",
) {
  aiPurposeSchema.parse(purpose);
  return getDb().$transaction(async (tx) => {
    const model = await tx.aiModel.findFirst({
      where: { id: modelId, providerId },
      include: { provider: true },
    });
    if (!model) throw new AccessError(404, "模型不存在。");
    if (!model.reasoningEfforts.includes(reasoningEffort))
      throw new RequestError(400, "请选择该模型支持的推理选项。");
    decryptApiKey(model.provider.encryptedApiKey);
    await tx.aiSetting.upsert({
      where: { id: purpose },
      create: { id: purpose, modelId, reasoningEffort },
      update: { modelId, reasoningEffort },
    });
  });
}

export async function getActiveProvider(purpose: AiPurpose = "exam"): Promise<ProviderSnapshot> {
  aiPurposeSchema.parse(purpose);
  const setting = await getDb().aiSetting.findUnique({
    where: { id: purpose },
    include: { model: { include: { provider: true } } },
  });
  if (!setting?.model)
    throw new RequestError(
      409,
      `管理员尚未设置${AI_PURPOSES[purpose]}模型，请联系管理员完成 AI 配置。`,
    );
  if (!setting.model.reasoningEfforts.includes(setting.reasoningEffort))
    throw new RequestError(409, `推理配置已变更，请让管理员重新选择${AI_PURPOSES[purpose]}模型。`);
  const { id, ...provider } = setting.model.provider;
  decryptApiKey(provider.encryptedApiKey);
  return {
    ...provider,
    providerId: id,
    apiType: provider.apiType as ProviderSnapshot["apiType"],
    displayName: setting.model.displayName,
    modelId: setting.model.id,
    creditMultiplier: setting.model.creditMultiplier.toNumber(),
    model: setting.model.name,
    reasoningEffort: setting.reasoningEffort as ReasoningEffort,
  };
}
