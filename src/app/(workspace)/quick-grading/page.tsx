import { userAiSettings } from "@/server/ai/user-settings";
import { presentExamTask } from "@/lib/task-presentation";
import { requirePageSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listExamTasks } from "@/server/exams/tasks";
import { listWorkflows } from "@/server/exams/workflows";
import { GradingManager } from "@/components/grading-manager";
export default async function Page({ searchParams }: { searchParams: Promise<{ exam?: string }> }) {
  const { user } = await requirePageSession();
  const [current, tasks, flows, params] = await Promise.all([
    getDb().user.findUnique({ where: { id: user.id }, select: { role: true } }),
    listExamTasks(user.id),
    listWorkflows(user.id),
    searchParams,
  ]);
  return (
    <GradingManager
      quick={true}
      initialTasks={tasks.map((task) => presentExamTask(task, current?.role === "ADMIN"))}
      initialWorkflows={flows}
      selectedExam={params.exam}
      initialModels={await userAiSettings(user.id)}
      isAdmin={current?.role === "ADMIN"}
    />
  );
}
