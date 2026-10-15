import { CardAIPage } from "@/components/platform/card-ai-page";

export const metadata = { title: "AI 自动排版答题卡" };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ paperId?: string }>;
}) {
  const { paperId } = await searchParams;
  return <CardAIPage paperId={paperId} />;
}
