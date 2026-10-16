import { PaperOverviewPage } from "@/components/platform/paper-pages";

export const metadata = { title: "试卷工作台" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PaperOverviewPage id={id} />;
}
