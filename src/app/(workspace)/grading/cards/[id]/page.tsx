import { requirePageSession } from "@/server/auth/session";
import { cardBatchDetail } from "@/server/answer-cards/tasks";
import { AnswerCardResults } from "@/components/answer-card-results";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requirePageSession();
  return <AnswerCardResults initialBatch={await cardBatchDetail(user.id, (await params).id)} />;
}
