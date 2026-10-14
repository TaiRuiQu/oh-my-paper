import { QuestionEditPage } from "@/components/platform/question-pages";

export const metadata = { title: "编辑题目" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <QuestionEditPage id={id} />;
}
