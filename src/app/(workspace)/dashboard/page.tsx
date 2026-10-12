import { requirePageSession } from "@/server/auth/session";
import { ensurePersonalWorkspace } from "@/server/db/workspaces";
import { getDb } from "@/server/db/client";
import { listExamTasks } from "@/server/exams/tasks";
import { ExamWorkbench } from "@/components/exam-workbench";
import { getActiveProvider } from "@/server/ai/settings";

export const metadata = { title: "试卷板块" };

export default async function DashboardPage() {
  const { user } = await requirePageSession();
  await ensurePersonalWorkspace(user);
  const [tasks, settings, role] = await Promise.all([
    listExamTasks(user.id),
    getActiveProvider("inventory").catch(() => null),
    getDb().user.findUnique({ where: { id: user.id }, select: { role: true } }),
  ]);
  return (
    <>
      <div className="workspace-heading">
        <h1>试卷板块</h1>
        <p className="intro">上传空白试卷，保存可核对、可复用的电子题套。</p>
      </div>
      <ol className="workflow-steps" aria-label="试卷处理流程">
        <li>
          <span>1</span>全卷识别 · 题量与分值
        </li>
        <li>
          <span>2</span>精细定位 · 整题与材料
        </li>
        <li>
          <span>3</span>文本化 · 文字与配图
        </li>
        <li>
          <span>4</span>标准答案 · 按需生成
        </li>
        <li>
          <span>5</span>用于批改 · 复用题套
        </li>
      </ol>
      <ExamWorkbench
        initialTasks={tasks}
        model={settings?.model ?? null}
        isAdmin={role?.role === "ADMIN"}
      />
    </>
  );
}
