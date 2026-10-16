import { QuestionDetailPage } from "@/components/platform/question-pages";

export const metadata = { title: "使用记录" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <QuestionDetailPage id={id} usage />;
}
