import { ReviewQueuePage } from "@/components/platform/review-pages";
import { ServerDomain } from "@/server/platform/page-layout";

export const metadata = { title: "评阅进度" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <ServerDomain area="exams" reviewing>
      <ReviewQueuePage assessmentId={id} />
    </ServerDomain>
  );
}
