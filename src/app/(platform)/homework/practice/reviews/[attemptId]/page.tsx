import { PracticeReviewWorkspace } from "@/components/practice/workspace";
export const metadata = { title: "练习提交核验" };
export default async function Page({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = await params;
  return <PracticeReviewWorkspace attemptId={attemptId} />;
}
