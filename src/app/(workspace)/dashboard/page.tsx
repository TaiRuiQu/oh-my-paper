import { requirePageSession } from "@/server/auth/session";
import { ensurePersonalWorkspace } from "@/server/db/workspaces";
import { getDb } from "@/server/db/client";
import { listExamTasks } from "@/server/exams/tasks";
import { ExamWorkbench } from "@/components/exam-workbench";

export const metadata = { title: "工作空间" };

export default async function DashboardPage() {
  const { user } = await requirePageSession();
  await ensurePersonalWorkspace(user);
  const [tasks, settings, role] = await Promise.all([listExamTasks(user.id),
    getDb().aiSetting.findUnique({ where: { id: "exam" }, include: { provider: { select: { model: true } } } }),
    getDb().user.findUnique({ where: { id: user.id }, select: { role: true } })]);
  return <>
    <div className="workspace-heading"><h1>从一份试卷开始</h1><p className="intro">上传作答，查看批改，把错题变成下一次进步。</p></div>
    <ol className="workflow-steps" aria-label="使用流程"><li><span>1</span>上传试卷</li><li><span>2</span>查看批改 · 核对分数</li><li><span>3</span>错题复习 · 巩固练习</li></ol>
    <ExamWorkbench initialTasks={tasks} model={settings?.provider?.model ?? null} isAdmin={role?.role === "ADMIN"} />
  </>;
}
