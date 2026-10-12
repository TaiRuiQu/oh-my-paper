import { requirePageSession } from "@/server/auth/session";
import { ensurePersonalWorkspace } from "@/server/db/workspaces";
import { getDb } from "@/server/db/client";
import { listExamTasks } from "@/server/exams/tasks";
import { ExamWorkbench } from "@/components/exam-workbench";

export const metadata = { title: "工作空间" };

export default async function DashboardPage() {
  const { user } = await requirePageSession();
  const workspace = await ensurePersonalWorkspace(user);
  const [tasks, settings, role] = await Promise.all([listExamTasks(user.id),
    getDb().aiSetting.findUnique({ where: { id: "exam" }, include: { provider: { select: { model: true } } } }),
    getDb().user.findUnique({ where: { id: user.id }, select: { role: true } })]);
  return <>
    <div className="workspace-heading"><h1>{workspace.name}</h1><p className="intro">你好，{user.name}。你的工作空间已准备就绪。</p></div>
    <ExamWorkbench initialTasks={tasks} model={settings?.provider?.model ?? null} isAdmin={role?.role === "ADMIN"} />
  </>;
}
