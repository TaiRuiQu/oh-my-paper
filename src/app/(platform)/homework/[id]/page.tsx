import { HomeworkOverviewPage } from "@/components/platform/homework-workbench";

export const metadata = { title: "作业工作台" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <HomeworkOverviewPage id={id} />;
}
