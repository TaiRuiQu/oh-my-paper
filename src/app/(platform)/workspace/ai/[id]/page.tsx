import { notFound } from "next/navigation";
import { AIJobDetailPage } from "@/components/platform/ai-job-pages";
import type { AiJobDTO } from "@/contracts/platform-ai";
import { requirePageSession } from "@/server/auth/session";
import { AccessError } from "@/server/http/errors";
import { getAiJob } from "@/server/platform/ai-jobs";

export const metadata = { title: "AI 执行轨迹" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePageSession();
  let job;
  try {
    job = await getAiJob(session.user.id, (await params).id);
  } catch (error) {
    if (error instanceof AccessError && error.status === 404) notFound();
    throw error;
  }
  return <AIJobDetailPage key={job.id} initialJob={JSON.parse(JSON.stringify(job)) as AiJobDTO} />;
}
