import { QuestionDetailPage } from "@/components/platform/question-pages";

export const metadata = { title: "试题详情" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <QuestionDetailPage id={id} />;
}
