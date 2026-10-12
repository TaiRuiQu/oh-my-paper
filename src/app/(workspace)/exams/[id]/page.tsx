import { notFound } from "next/navigation";
import { requirePageSession } from "@/server/auth/session";
import { ownedExamTask, taskSummary } from "@/server/exams/tasks";
import { AccessError } from "@/server/http/errors";
import { ExamResult } from "@/components/exam-result";

export const metadata = { title: "识别结果" };
export default async function ExamPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requirePageSession();
  let task;
  try {
    task = await ownedExamTask(user.id, (await params).id);
  } catch (error) {
    if (error instanceof AccessError && error.status === 404) notFound();
    throw error;
  }
  return <ExamResult initialTask={taskSummary(task)} />;
}
