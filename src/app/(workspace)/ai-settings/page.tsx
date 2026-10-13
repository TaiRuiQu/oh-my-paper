import { requirePageSession } from "@/server/auth/session";
import { userAiSettings } from "@/server/ai/user-settings";
import { UserModelSettings } from "@/components/user-ai-settings";
export const metadata = { title: "AI 模型与额度" };
export default async function UserAiPage() {
  const { user } = await requirePageSession();
  return (
    <>
      <h1>AI 模型与额度</h1>
      <p className="intro">选择适合自己的模型，随时查看使用额度。</p>
      <UserModelSettings initialSettings={await userAiSettings(user.id)} />
    </>
  );
}
