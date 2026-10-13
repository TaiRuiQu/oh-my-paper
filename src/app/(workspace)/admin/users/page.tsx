import { headers } from "next/headers";
import { requireAdmin } from "@/server/auth/authorization";
import { AccessError } from "@/server/http/errors";
import { listUsers } from "@/server/admin/users";
import { AdminUsers } from "@/components/admin-users";
export const metadata = { title: "用户管理" };
export default async function Page() {
  try {
    await requireAdmin(await headers());
  } catch (error) {
    if (error instanceof AccessError && error.status === 403)
      return (
        <>
          <h1>需要管理员权限</h1>
          <p className="intro">用户管理仅供管理员使用。</p>
        </>
      );
    throw error;
  }
  return (
    <>
      <h1>用户管理</h1>
      <p className="intro">查看用户资料、管理角色与额度，或重置登录密码。</p>
      <AdminUsers initialData={await listUsers("", 1)} />
    </>
  );
}
