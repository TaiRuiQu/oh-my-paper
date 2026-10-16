import { PaperEditorPage } from "@/components/platform/paper-pages";

export const metadata = { title: "卷面排版" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PaperEditorPage id={id} view="layout" />;
}
