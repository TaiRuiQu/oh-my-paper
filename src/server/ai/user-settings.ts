import "server-only";
import {
  AI_PURPOSES,
  aiPurposeSchema,
  type AiPurpose,
  type ProviderSnapshot,
  type ReasoningEffort,
} from "@/contracts/ai-providers";
import type { UserAiSettings } from "@/contracts/user-ai";
import { getDb } from "@/server/db/client";
import { RequestError } from "@/server/http/errors";
import { decryptApiKey } from "./credentials";
import { getActiveProvider } from "./settings";

export async function userAiSettings(userId: string): Promise<UserAiSettings> {
  const [user, models, preferences, defaults] = await Promise.all([
    getDb().user.findUniqueOrThrow({
      where: { id: userId },
      select: { credits: true, role: true },
    }),
    getDb().aiModel.findMany({
      where: { isPublic: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    }),
    getDb().userAiSelection.findMany({ where: { userId } }),
    getDb().aiSetting.findMany({
      where: { id: { in: Object.keys(AI_PURPOSES) } },
      include: { model: true },
    }),
  ]);
  return {
    ...(user.role === "ADMIN"
      ? {
          adminDefaults: Object.fromEntries(
            Object.keys(AI_PURPOSES).map((purpose) => {
              const model = defaults.find((setting) => setting.id === purpose)?.model;
              return [
                purpose,
                model
                  ? {
                      name: model.displayName || model.name,
                      creditMultiplier: model.creditMultiplier.toNumber(),
                      reasoningEfforts: model.reasoningEfforts as ReasoningEffort[],
                    }
                  : null,
              ];
            }),
          ) as NonNullable<UserAiSettings["adminDefaults"]>,
        }
      : {}),
    credits: user.credits.toFixed(8),
    unlimited: user.role === "ADMIN",
    models: models.map((model) => ({
      id: model.id,
      name: model.displayName || model.name,
      creditMultiplier: model.creditMultiplier.toNumber(),
      reasoningEfforts: model.reasoningEfforts as ReasoningEffort[],
    })),
    selections: Object.fromEntries(
      Object.keys(AI_PURPOSES).map((purpose) => [
        purpose,
        preferences.find((item) => item.purpose === purpose)?.modelId ?? null,
      ]),
    ) as UserAiSettings["selections"],
    reasoningSelections: Object.fromEntries(
      Object.keys(AI_PURPOSES).map((purpose) => [
        purpose,
        preferences.find((item) => item.purpose === purpose)?.reasoningEffort ?? null,
      ]),
    ) as UserAiSettings["reasoningSelections"],
    defaultReasoningEfforts: Object.fromEntries(
      Object.keys(AI_PURPOSES).map((purpose) => [
        purpose,
        defaults.find((item) => item.id === purpose)?.reasoningEffort ?? "default",
      ]),
    ) as UserAiSettings["defaultReasoningEfforts"],
    defaults: Object.fromEntries(
      Object.keys(AI_PURPOSES).map((purpose) => {
        const active = defaults.find((item) => item.id === purpose)?.modelId;
        return [
          purpose,
          models.some((model) => model.id === active) ? active : (models[0]?.id ?? null),
        ];
      }),
    ) as UserAiSettings["defaults"],
  };
}

export async function selectUserModel(
  userId: string,
  purpose: AiPurpose,
  modelId: string | null,
  reasoningEffort?: ReasoningEffort | null,
) {
  aiPurposeSchema.parse(purpose);
  await getDb().$transaction(async (tx) => {
    if (modelId === null) {
      await tx.userAiSelection.deleteMany({ where: { userId, purpose } });
      return;
    }
    // Lock publication settings until selection commits.
    await tx.$queryRaw`SELECT id FROM ai_models WHERE id = ${modelId} FOR UPDATE`;
    const model = await tx.aiModel.findFirst({ where: { id: modelId, isPublic: true } });
    if (!model) throw new RequestError(409, "该模型未对公众开放，请选择其他模型。");
    if (reasoningEffort && !model.reasoningEfforts.includes(reasoningEffort))
      throw new RequestError(400, "该模型不支持所选推理强度。");
    await tx.userAiSelection.upsert({
      where: { userId_purpose: { userId, purpose } },
      create: { userId, purpose, modelId, reasoningEffort: reasoningEffort ?? null },
      update: { modelId, reasoningEffort: reasoningEffort ?? null },
    });
  });
}

export async function getUserProvider(
  userId: string,
  purpose: AiPurpose = "exam",
  taskModelId?: string,
  taskReasoningEffort?: ReasoningEffort,
): Promise<ProviderSnapshot> {
  aiPurposeSchema.parse(purpose);
  const preference = await getDb().userAiSelection.findUnique({
    where: { userId_purpose: { userId, purpose } },
  });
  if (taskModelId || preference) {
    const model = await getDb().aiModel.findFirst({
      where: { id: taskModelId ?? preference!.modelId, isPublic: true },
      include: { provider: true },
    });
    if (!model) throw new RequestError(409, "所选模型已停止开放，请在 AI 模型与额度中重新选择。");
    decryptApiKey(model.provider.encryptedApiKey);
    const { id, ...provider } = model.provider;
    return {
      ...provider,
      providerId: id,
      apiType: provider.apiType as ProviderSnapshot["apiType"],
      displayName: model.displayName,
      modelId: model.id,
      model: model.name,
      creditMultiplier: model.creditMultiplier.toNumber(),
      reasoningEffort: chooseReasoning(
        model.reasoningEfforts,
        taskReasoningEffort,
        !taskModelId ? preference?.reasoningEffort : null,
      ),
    };
  }
  const user = await getDb().user.findUniqueOrThrow({
    where: { id: userId },
    select: { role: true },
  });
  if (user.role === "ADMIN") {
    const provider = await getActiveProvider(purpose);
    if (!taskReasoningEffort) return provider;
    const model = await getDb().aiModel.findUniqueOrThrow({ where: { id: provider.modelId } });
    return {
      ...provider,
      reasoningEffort: chooseReasoning(model.reasoningEfforts, taskReasoningEffort),
    };
  }
  const available = await userAiSettings(userId);
  const modelId = available.defaults[purpose];
  if (!modelId) throw new RequestError(409, "暂无对公众开放的 AI 模型，请联系管理员。");
  const setting = await getDb().aiSetting.findUnique({ where: { id: purpose } });
  const model = await getDb().aiModel.findFirst({
    where: { id: modelId, isPublic: true },
    include: { provider: true },
  });
  if (!model) throw new RequestError(409, "模型开放状态已更新，请刷新后重试。");
  const { id, ...provider } = model.provider;
  decryptApiKey(provider.encryptedApiKey);
  return {
    ...provider,
    providerId: id,
    apiType: provider.apiType as ProviderSnapshot["apiType"],
    displayName: model.displayName,
    modelId: model.id,
    model: model.name,
    creditMultiplier: model.creditMultiplier.toNumber(),
    reasoningEffort: chooseReasoning(
      model.reasoningEfforts,
      taskReasoningEffort,
      setting?.modelId === modelId ? setting.reasoningEffort : null,
    ),
  };
}
function chooseReasoning(
  supported: string[],
  override?: ReasoningEffort,
  preference?: string | null,
): ReasoningEffort {
  if (override && !supported.includes(override))
    throw new RequestError(400, "该模型不支持所选推理强度，请重新选择。");
  return (override ??
    (preference && supported.includes(preference)
      ? preference
      : supported.includes("default")
        ? "default"
        : supported[0])) as ReasoningEffort;
}
