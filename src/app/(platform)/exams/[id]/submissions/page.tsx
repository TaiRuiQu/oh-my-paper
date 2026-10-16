import { ReviewQueuePage } from "@/components/platform/review-pages";

export const metadata = { title: "学生作答" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReviewQueuePage assessmentId={id} submissions />;
}
