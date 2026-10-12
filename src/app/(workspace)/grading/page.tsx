import { requirePageSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listExamTasks } from "@/server/exams/tasks";
import { classOverview } from "@/server/learning/classes";
import { GradingHub } from "@/components/grading-hub";
import { getActiveProvider } from "@/server/ai/settings";
export const metadata = { title: "批改板块" };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; templateId?: string }>;
}) {
  const { user } = await requirePageSession();
  const [tasks, classes, settings, current, search] = await Promise.all([
    listExamTasks(user.id),
    classOverview(user.id),
    getActiveProvider("inventory").catch(() => null),
    getDb().user.findUnique({ where: { id: user.id }, select: { role: true } }),
    searchParams,
  ]);
  return (
    <GradingHub
      tasks={tasks}
      classes={classes}
      model={settings?.model ?? null}
      isAdmin={current?.role === "ADMIN"}
      defaultMode={search.mode === "batch" ? "batch" : "student"}
      templateTaskId={search.templateId}
    />
  );
}
