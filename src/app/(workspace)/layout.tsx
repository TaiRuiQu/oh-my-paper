import Link from "next/link";
import { requirePageSession } from "@/server/auth/session";
import { SignOutButton } from "@/components/sign-out-button";
import { getDb } from "@/server/db/client";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requirePageSession();
  const current = await getDb().user.findUnique({ where: { id: user.id }, select: { role: true } });
  return <div className="app-shell">
    <header className="app-header"><Link href="/dashboard" className="wordmark">Oh My Paper<span>试卷工作台</span></Link><nav className="app-nav" aria-label="工作台导航"><Link href="/dashboard">我的试卷</Link><Link href="/wrong-questions">错题本</Link><Link href="/classes">班级</Link>{current?.role === "ADMIN" && <Link href="/admin/ai">服务设置</Link>}<SignOutButton /></nav></header>
    <main id="main" className="workspace-main">{children}</main>
    <footer className="app-footer">每一份作答，都值得认真对待。</footer>
  </div>;
}
