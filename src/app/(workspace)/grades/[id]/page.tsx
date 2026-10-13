import { presentWorkflow } from "@/lib/task-presentation";
import { notFound } from "next/navigation";
import { requirePageSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { workflowDetail } from "@/server/exams/workflows";
import { AccessError } from "@/server/http/errors";
import { WorkflowResult } from "@/components/workflow-result";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requirePageSession(),
    { id } = await params;
  const flow = await workflowDetail(user.id, id).catch((error) => {
    if (error instanceof AccessError && error.status === 404) notFound();
    throw error;
  });
  const current = await getDb().user.findUnique({ where: { id: user.id }, select: { role: true } });
  return (
    <WorkflowResult
      initialWorkflow={presentWorkflow(flow, current?.role === "ADMIN")}
      isAdmin={current?.role === "ADMIN"}
    />
  );
}
