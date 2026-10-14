import { AssessmentCreatePage } from "@/components/platform/assessment-pages";

export const metadata = { title: "布置作业" };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ paperId?: string }>;
}) {
  const { paperId } = await searchParams;
  return <AssessmentCreatePage paperId={paperId} />;
}
