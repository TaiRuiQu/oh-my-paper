import { headers } from "next/headers";
import { requireAdmin } from "@/server/auth/authorization";
import { AccessError } from "@/server/http/errors";
import { listProviders } from "@/server/ai/settings";
import { AiProviderSettings } from "@/components/ai-provider-settings";

export const metadata = { title: "AI 提供商设置" };
export default async function AiSettingsPage() {
  try {
    await requireAdmin(await headers());
  } catch (error) {
    if (error instanceof AccessError && error.status === 403)
      return (
        <div className="workspace-heading">
          <h1>需要管理员权限</h1>
          <p className="intro">AI 提供商配置由管理员维护。请联系管理员设置识别模型。</p>
        </div>
      );
    throw error;
  }
  return (
    <>
      <div className="workspace-heading">
        <h1>AI 提供商设置</h1>
        <p className="intro">
          为题目识别、精细定位、文本化、标准答案、作答解析和批改分别选择模型。配置变更用于新任务。
        </p>
      </div>
      <AiProviderSettings initialProviders={await listProviders()} />
    </>
  );
}
