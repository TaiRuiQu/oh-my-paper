import { requirePageSession } from "@/server/auth/session";
import { ensurePersonalWorkspace } from "@/server/db/workspaces";

export const metadata = { title: "工作空间" };

export default async function DashboardPage() {
  const { user } = await requirePageSession();
  const workspace = await ensurePersonalWorkspace(user);
  return <>
    <div className="workspace-heading"><h1>{workspace.name}</h1><p className="intro">你好，{user.name}。你的工作空间已准备就绪。</p></div>
    <section className="empty-state" aria-labelledby="papers-heading"><h2 id="papers-heading">试卷与批改</h2><p>这里将保存你的试卷和批改结果。</p><p className="muted">试卷上传、解析和批改功能正在准备中。</p></section>
    <section className="account-section" aria-labelledby="account-heading"><h2 id="account-heading">当前账号</h2><dl><div><dt>姓名</dt><dd>{user.name}</dd></div><div><dt>邮箱</dt><dd>{user.email}</dd></div><div><dt>工作空间</dt><dd>个人工作空间</dd></div></dl></section>
  </>;
}
