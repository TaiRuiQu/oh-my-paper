import { ScanPage } from "@/components/platform/review-pages";

export const metadata = { title: "扫描答题卡" };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ assessmentId?: string }>;
}) {
  const { assessmentId } = await searchParams;
  return <ScanPage assessmentId={assessmentId} />;
}
