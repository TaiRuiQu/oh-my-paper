import { presentExamTask } from "@/lib/task-presentation";
import { notFound } from "next/navigation";
import { requirePageSession } from "@/server/auth/session";
import { ownedExamTask, taskResult, taskSummary } from "@/server/exams/tasks";
import { AccessError } from "@/server/http/errors";
import { ExamResult } from "@/components/exam-result";
import { getDb } from "@/server/db/client";
export default async function ExamPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { user } = await requirePageSession(),
    { id } = await params;
  const task = await ownedExamTask(user.id, id).catch((error) => {
    if (error instanceof AccessError && error.status === 404) notFound();
    throw error;
  });
  const exam = await taskResult(task);
  const current = await getDb().user.findUnique({ where: { id: user.id }, select: { role: true } });
  return (
    <ExamResult
      id={id}
      initialView={(await searchParams).view === "answers" ? "answers" : "questions"}
      isAdmin={current?.role === "ADMIN"}
      initialData={{
        task: presentExamTask(taskSummary(task), current?.role === "ADMIN"),
        exam,
      }}
    />
  );
}
