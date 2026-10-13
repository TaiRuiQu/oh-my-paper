import { requirePageSession } from "@/server/auth/session";
import { listExamTasks } from "@/server/exams/tasks";
import { userAiSettings } from "@/server/ai/user-settings";
import { AnswerCardManager } from "@/components/answer-card-manager";
export default async function Page() {
  const { user } = await requirePageSession();
  const [tasks, models] = await Promise.all([listExamTasks(user.id), userAiSettings(user.id)]);
  return <AnswerCardManager initialTasks={tasks} initialModels={models} />;
}
