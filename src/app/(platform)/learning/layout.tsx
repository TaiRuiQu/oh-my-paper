import { redirect } from "next/navigation";
import { requirePageSession } from "@/server/auth/session";
import { getActor } from "@/server/platform/access";

/** Practice and homework receive their own safe DTOs; formal reports opt in separately. */
export default async function Layout({ children }: { children: React.ReactNode }) {
  const session = await requirePageSession();
  const actor = await getActor(session.user.id);
  if (actor.role !== "STUDENT") redirect("/workspace");
  return children;
}
