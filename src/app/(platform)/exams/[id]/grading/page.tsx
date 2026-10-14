import { ReviewQueuePage } from "@/components/platform/review-pages";

export const metadata = { title: "评阅进度" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReviewQueuePage assessmentId={id} />;
}
