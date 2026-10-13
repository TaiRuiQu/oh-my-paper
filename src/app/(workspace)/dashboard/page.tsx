import { userAiSettings } from "@/server/ai/user-settings";
import { presentExamTask } from "@/lib/task-presentation";
import { requirePageSession } from "@/server/auth/session";
import { listExamTasks } from "@/server/exams/tasks";
import { ExamWorkbench } from "@/components/exam-workbench";
import { getDb } from "@/server/db/client";
export default async function DashboardPage() {
  const { user } = await requirePageSession();
  const current = await getDb().user.findUnique({ where: { id: user.id }, select: { role: true } });
  return (
    <ExamWorkbench
      initialTasks={(await listExamTasks(user.id)).map((task) =>
        presentExamTask(task, current?.role === "ADMIN"),
      )}
      initialModels={await userAiSettings(user.id)}
      isAdmin={current?.role === "ADMIN"}
    />
  );
}
