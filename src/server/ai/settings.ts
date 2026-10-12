import "server-only";
import { AI_STAGES, providerSchema, type AiStage, type PipelineSnapshot, type ProviderInput, type ProviderSnapshot, type ProviderSummary } from "@/contracts/ai-providers";
import { getDb } from "@/server/db/client";
import { AccessError, RequestError } from "@/server/http/errors";
import { decryptApiKey, encryptApiKey } from "./credentials";

export async function listProviders(): Promise<ProviderSummary[]> {
  const [providers, settings] = await Promise.all([
    getDb().aiProvider.findMany({ orderBy: { createdAt: "asc" } }),
    getDb().aiSetting.findMany({ where: { id: { in: ["exam", ...Object.keys(AI_STAGES)] } } }),
  ]);
  const exam = settings.find((s) => s.id === "exam"), grading = settings.find((s) => s.id === "grading");
  return providers.map((provider) => ({ ...providerSchema.parse(provider), id: provider.id,
    hasApiKey: Boolean(provider.encryptedApiKey), active: exam?.providerId === provider.id,
    gradingActive: (grading?.providerId ?? exam?.providerId) === provider.id,
    stages: (Object.keys(AI_STAGES) as AiStage[]).filter((stage) => {
      const specific = settings.find((s) => s.id === stage);
      return (specific?.providerId ?? (stage === "solution" ? grading?.providerId : null) ?? exam?.providerId) === provider.id;
    }) }));
}

export async function saveProvider(input: ProviderInput, id?: string) {
  const config = providerSchema.parse(input);
  const existing = id ? await getDb().aiProvider.findUnique({ where: { id } }) : null;
  if (id && !existing) throw new AccessError(404, "提供商不存在。");
  if (!input.apiKey && !existing) throw new RequestError(400, "新增提供商需要填写 API key。");
  const encryptedApiKey = input.apiKey ? encryptApiKey(input.apiKey) : existing!.encryptedApiKey;
  // Check the retained key can still be decrypted after a deployment/config change.
  decryptApiKey(encryptedApiKey);
  return id ? getDb().aiProvider.update({ where: { id }, data: { ...config, encryptedApiKey } })
    : getDb().aiProvider.create({ data: { ...config, encryptedApiKey } });
}

export async function activateProvider(id: string, purpose: AiStage | "exam" = "exam") {
  const provider = await getDb().aiProvider.findUnique({ where: { id } });
  if (!provider) throw new AccessError(404, "提供商不存在。");
  decryptApiKey(provider.encryptedApiKey);
  await getDb().aiSetting.upsert({ where: { id: purpose }, create: { id: purpose, providerId: id }, update: { providerId: id } });
}

export async function getActiveProvider(purpose: AiStage | "exam" = "exam"): Promise<ProviderSnapshot> {
  const candidates = purpose === "solution" ? ["solution", "grading", "exam"] : purpose === "exam" ? ["exam", "inventory"] : [purpose, "exam"];
  const settings = await getDb().aiSetting.findMany({ where: { id: { in: candidates } }, include: { provider: true } });
  const setting = candidates.map((id) => settings.find((s) => s.id === id)).find((s) => s?.provider);
  if (!setting?.provider) throw new RequestError(409, "管理员尚未设置识别模型，请联系管理员完成 AI 配置。");
  decryptApiKey(setting.provider.encryptedApiKey);
  return { ...providerSchema.parse(setting.provider), providerId: setting.provider.id, encryptedApiKey: setting.provider.encryptedApiKey };
}

export async function getPipelineProviderSnapshot(): Promise<PipelineSnapshot> {
  const stages = Object.keys(AI_STAGES) as AiStage[];
  const values = await Promise.all(stages.map((stage) => getActiveProvider(stage)));
  return { ...values[0], stages: Object.fromEntries(stages.map((stage, i) => [stage, values[i]])),
    workflow: { generateAnswers: true, solveOnly: false } };
}
