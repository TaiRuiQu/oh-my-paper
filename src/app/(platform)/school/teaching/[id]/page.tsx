import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getActor } from "@/server/platform/access";
import { requirePageSession } from "@/server/auth/session";
import { loadTeachingSession } from "@/server/platform/teaching/service";
import { TeachingWorkspace } from "@/components/teaching/workspace";
export const metadata: Metadata = { title: "备课与课堂记录" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePageSession();
  if ((await getActor(session.user.id)).role === "STUDENT") redirect("/school/schedule");
  const { id } = await params;
  return (
    <TeachingWorkspace
      initialSession={await loadTeachingSession({ id: session.user.id }, id)}
      section="session"
    />
  );
}
