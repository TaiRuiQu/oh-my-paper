import { RevisionPaperPreview } from "@/components/platform/revision-paper-pages";
export const metadata = { title: "复习卷预览与导出" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RevisionPaperPreview id={id} />;
}
