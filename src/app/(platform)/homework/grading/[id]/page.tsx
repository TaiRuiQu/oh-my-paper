import { SubmissionReviewPage } from "@/components/platform/review-pages";

export const metadata = { title: "逐题评阅" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SubmissionReviewPage id={id} />;
}
