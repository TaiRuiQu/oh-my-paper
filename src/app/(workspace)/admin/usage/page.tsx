import { headers } from "next/headers";
import { requireAdmin } from "@/server/auth/authorization";
import { AccessError } from "@/server/http/errors";
import { usageDashboard } from "@/server/ai/usage";
import { UsageDashboardPanel } from "@/components/usage-dashboard";
export const metadata = { title: "用量统计" };
export default async function UsagePage() {
  try {
    await requireAdmin(await headers());
  } catch (error) {
    if (error instanceof AccessError && error.status === 403)
      return (
        <>
          <h1>需要管理员权限</h1>
          <p className="intro">用量统计仅供管理员查看。</p>
        </>
      );
    throw error;
  }
  return (
    <>
      <h1>用量统计</h1>
      <p className="intro">查看全系统、用户与模型的实际消耗。</p>
      <UsageDashboardPanel initialData={await usageDashboard()} />
    </>
  );
}
