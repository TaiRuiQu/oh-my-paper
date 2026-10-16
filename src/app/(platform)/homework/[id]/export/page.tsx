import { HomeworkExportPage } from "@/components/platform/homework-workbench";

export const metadata = { title: "导出练习册" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <HomeworkExportPage id={id} />;
}
