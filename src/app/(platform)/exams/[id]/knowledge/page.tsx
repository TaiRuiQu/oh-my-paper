import { AssessmentReportPage } from "@/components/platform/report-pages";

export const metadata = { title: "知识点表现" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AssessmentReportPage id={id} knowledge />;
}
