import { AssessmentOverviewPage } from "@/components/platform/assessment-pages";

export const metadata = { title: "进度概览" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AssessmentOverviewPage id={id} />;
}
