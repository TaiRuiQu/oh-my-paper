import { ReviewQueuePage } from "@/components/platform/review-pages";

export const metadata = { title: "作答记录" };

export default function Page() {
  return <ReviewQueuePage submissions />;
}
