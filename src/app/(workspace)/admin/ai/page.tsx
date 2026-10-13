import { headers } from "next/headers";
import { requireAdmin } from "@/server/auth/authorization";
import { AccessError } from "@/server/http/errors";
import { listProviders } from "@/server/ai/settings";
import { AiProviderSettings } from "@/components/ai-provider-settings";
export const metadata = { title: "AI 设置" };
export default async function AiSettingsPage() {
  try {
    await requireAdmin(await headers());
  } catch (error) {
    if (error instanceof AccessError && error.status === 403)
      return (
        <>
          <h1>需要管理员权限</h1>
          <p className="intro">请联系管理员设置解析、批改和答案生成模型。</p>
        </>
      );
    throw error;
  }
  return (
    <>
      <h1>AI 设置</h1>
      <p className="intro">分别选择解析、批改和答案生成使用的模型与推理程度。</p>
      <AiProviderSettings initialProviders={await listProviders()} />
    </>
  );
}
