import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getActor } from "@/server/platform/access";
import { requirePageSession } from "@/server/auth/session";
import { loadTeachingSessions } from "@/server/platform/teaching/service";
import { TeachingWorkspace } from "@/components/teaching/workspace";
export const metadata: Metadata = { title: "备课与课堂" };
export default async function Page() {
  const session = await requirePageSession();
  if ((await getActor(session.user.id)).role === "STUDENT") redirect("/school/schedule");
  return (
    <TeachingWorkspace
      initialList={await loadTeachingSessions({ id: session.user.id }, {})}
      section="list"
    />
  );
}
