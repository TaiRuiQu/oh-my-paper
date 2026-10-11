import Link from "next/link";
import { requirePageSession } from "@/server/auth/session";
import { SignOutButton } from "@/components/sign-out-button";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  await requirePageSession();
  return <div className="app-shell">
    <header className="app-header"><Link href="/dashboard" className="wordmark">Oh My Paper<span>试卷工作台</span></Link><SignOutButton /></header>
    <main id="main" className="workspace-main">{children}</main>
    <footer className="app-footer">每一份作答，都值得认真对待。</footer>
  </div>;
}
