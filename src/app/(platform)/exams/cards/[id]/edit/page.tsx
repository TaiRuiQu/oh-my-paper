import { CardEditorPage } from "@/components/platform/card-workbench";

export const metadata = { title: "卡面排版" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CardEditorPage id={id} />;
}
