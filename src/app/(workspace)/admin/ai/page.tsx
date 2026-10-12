import { headers } from "next/headers";
import { requireAdmin } from "@/server/auth/authorization";
import { AccessError } from "@/server/http/errors";
import { listProviders } from "@/server/ai/settings";
import { AiProviderSettings } from "@/components/ai-provider-settings";

export const metadata = { title: "AI 提供商设置" };
export default async function AiSettingsPage() {
  try { await requireAdmin(await headers()); }
  catch (error) {
    if (error instanceof AccessError && error.status === 403) return <div className="workspace-heading"><h1>需要管理员权限</h1><p className="intro">AI 提供商配置由管理员维护。请联系管理员设置识别模型。</p></div>;
    throw error;
  }
  return <><div className="workspace-heading"><h1>AI 提供商设置</h1><p className="intro">分别选择识别和批改模型，配置变更用于新任务。未单独设置批改模型时，使用识别模型。</p></div><AiProviderSettings initialProviders={await listProviders()} /></>;
}
