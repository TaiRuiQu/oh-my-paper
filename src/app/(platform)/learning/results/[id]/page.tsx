import { LearningResultsPage } from "@/components/platform/report-pages";

export const metadata = { title: "成绩详情" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LearningResultsPage id={id} />;
}
