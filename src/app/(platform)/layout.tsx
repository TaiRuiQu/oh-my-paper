import { requirePageSession } from "@/server/auth/session";
import { getActor } from "@/server/platform/access";
import { PlatformShell } from "@/components/platform/shell";

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePageSession();
  const actor = await getActor(session.user.id);
  return <PlatformShell actor={actor}>{children}</PlatformShell>;
}
