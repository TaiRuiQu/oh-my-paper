import { PracticeWorkspace } from "@/components/practice/workspace";
import { notFound } from "next/navigation";
export const metadata = { title: "练习作答与反馈" };
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (
    Array.isArray(query.attemptId) ||
    Array.isArray(query.evaluationId) ||
    (query.evaluationId && !query.attemptId)
  )
    notFound();
  return (
    <PracticeWorkspace
      sessionId={id}
      source={
        query.attemptId
          ? { attemptId: query.attemptId, evaluationId: query.evaluationId }
          : undefined
      }
    />
  );
}
