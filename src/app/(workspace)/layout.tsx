import { requirePageSession } from "@/server/auth/session";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getDb } from "@/server/db/client";
export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requirePageSession();
  const current = await getDb().user.findUnique({
    where: { id: user.id },
    select: { role: true, credits: true },
  });
  return (
    <WorkspaceShell
      name={user.name}
      isAdmin={current?.role === "ADMIN"}
      initialCredits={current?.credits.toFixed(8) ?? "0"}
    >
      {children}
    </WorkspaceShell>
  );
}
