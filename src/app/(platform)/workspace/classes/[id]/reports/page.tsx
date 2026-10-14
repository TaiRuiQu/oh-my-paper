import { ClassReportPage } from "@/components/platform/report-pages";

export const metadata = { title: "班级学情" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ClassReportPage id={id} />;
}
