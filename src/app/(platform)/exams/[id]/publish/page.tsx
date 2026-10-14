import { AssessmentPublishPage } from "@/components/platform/assessment-pages";

export const metadata = { title: "发布成绩" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AssessmentPublishPage id={id} />;
}
