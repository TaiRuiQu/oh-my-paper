import { ScanPage } from "@/components/platform/review-pages";

export const metadata = { title: "录入练习册" };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ assessmentId?: string }>;
}) {
  const { assessmentId } = await searchParams;
  return <ScanPage assessmentId={assessmentId} />;
}
