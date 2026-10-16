import { AssessmentCreatePage } from "@/components/platform/assessment-pages";

export const metadata = { title: "安排考试" };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ paperId?: string }>;
}) {
  const { paperId } = await searchParams;
  return <AssessmentCreatePage paperId={paperId} />;
}
