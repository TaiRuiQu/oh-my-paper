import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import type { PlatformArea } from "@/contracts/navigation";
import { requirePageSession } from "@/server/auth/session";
import { getActor } from "@/server/platform/access";
import { loadPageState } from "@/server/platform/page-state";
import { DomainProvider } from "@/components/platform/domain-provider";

export async function ServerDomain({
  area,
  children,
}: {
  area: PlatformArea;
  children: ReactNode;
}) {
  const session = await requirePageSession();
  const actor = await getActor(session.user.id);
  if (actor.role === "STUDENT" && area !== "workspace" && area !== "learning")
    redirect("/workspace");
  if (actor.role !== "ADMIN" && area === "admin") redirect("/workspace");
  if (actor.role !== "STUDENT" && area === "learning") redirect("/workspace");
  return (
    <DomainProvider area={area} initialState={await loadPageState(actor, area)}>
      {children}
    </DomainProvider>
  );
}
