import { CardOverviewPage } from "@/components/platform/card-workbench";

export const metadata = { title: "答题卡概览" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CardOverviewPage id={id} />;
}
