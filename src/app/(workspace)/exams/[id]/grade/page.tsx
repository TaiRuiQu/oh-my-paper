import { notFound, redirect } from "next/navigation";
import { requirePageSession } from "@/server/auth/session";
import { ownedExamTask, taskResult } from "@/server/exams/tasks";
import { listGradeTasks } from "@/server/grading/tasks";
import { AccessError } from "@/server/http/errors";
import { getDb } from "@/server/db/client";
import { defaultSubmissions, questionToText } from "@/lib/grading-defaults";
import { GradingWorkspace } from "@/components/grading-workspace";
import { renderExamMath } from "@/server/exams/math";

export const metadata = { title: "AI 批改" };
export default async function GradePage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requirePageSession();
  const { id } = await params;
  let task;
  try {
    task = await ownedExamTask(user.id, id);
  } catch (error) {
    if (error instanceof AccessError && error.status === 404) notFound();
    throw error;
  }
  const exam = await taskResult(task);
  if (!exam) redirect(`/exams/${id}`);
  const [settings, history] = await Promise.all([
    getDb().aiSetting.findMany({
      where: { id: { in: ["grading", "exam"] } },
      include: { provider: { select: { model: true } } },
    }),
    listGradeTasks(user.id, id),
  ]);
  const model =
    settings.find((s) => s.id === "grading")?.provider?.model ??
    settings.find((s) => s.id === "exam")?.provider?.model ??
    null;
  return (
    <GradingWorkspace
      examTaskId={id}
      title={exam.title || task.name}
      model={model}
      initialHistory={history}
      mathImages={await renderExamMath(exam)}
      initialSubmissions={defaultSubmissions(exam)}
      questions={exam.questions.map((q) => ({
        id: q.id,
        number: q.number,
        section: q.section,
        stem: questionToText(q),
        requiresReview: q.status === "needs_review",
      }))}
    />
  );
}
