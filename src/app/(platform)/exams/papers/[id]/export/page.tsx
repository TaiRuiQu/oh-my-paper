import { PaperExportPage } from "@/components/platform/paper-pages";

export const metadata = { title: "导出试卷" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PaperExportPage id={id} />;
}
