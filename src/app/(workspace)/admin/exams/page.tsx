import { headers } from "next/headers";
import { requireAdmin } from "@/server/auth/authorization";
import { AccessError } from "@/server/http/errors";
import { listAllExams } from "@/server/admin/exams";
import { AdminExams } from "@/components/admin-exams";
export const metadata = { title: "试卷记录审查" };
export default async function Page() {
  try {
    await requireAdmin(await headers());
  } catch (error) {
    if (error instanceof AccessError && error.status === 403)
      return (
        <>
          <h1>需要管理员权限</h1>
          <p className="intro">试卷记录审查仅供管理员使用。</p>
        </>
      );
    throw error;
  }
  return (
    <>
      <h1>试卷记录审查</h1>
      <p className="intro">查看所有用户上传的试卷及快速批改试卷。</p>
      <AdminExams initialData={await listAllExams("", 1)} />
    </>
  );
}
