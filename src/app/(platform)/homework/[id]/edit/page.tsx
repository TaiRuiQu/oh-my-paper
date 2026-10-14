import { HomeworkEditorPage } from "@/components/platform/homework-workbench";

export const metadata = { title: "练习册排版" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <HomeworkEditorPage id={id} />;
}
