import { AssessmentCreatePage } from "@/components/platform/assessment-pages";

export const metadata = { title: "安排设置" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AssessmentCreatePage id={id} />;
}
