import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/server/auth/authorization";
import { AccessError } from "@/server/http/errors";
import { reviewExam } from "@/server/admin/exams";
import { AdminExamReview } from "@/components/admin-exam-review";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
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
  const data = await reviewExam((await params).id).catch((error) => {
    if (error instanceof AccessError && error.status === 404) notFound();
    throw error;
  });
  return <AdminExamReview initialData={data} />;
}
