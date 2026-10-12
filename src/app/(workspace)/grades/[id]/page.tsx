import { notFound } from "next/navigation";
import { requirePageSession } from "@/server/auth/session";
import { gradeTaskResult, gradeTaskSummary, ownedGradeTask } from "@/server/grading/tasks";
import { AccessError } from "@/server/http/errors";
import { GradeReport } from "@/components/grade-report";
import { renderMathText } from "@/server/exams/math";

export const metadata = { title: "批改报告" };
export default async function GradeReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requirePageSession(); let task;
  try { task = await ownedGradeTask(user.id, (await params).id); }
  catch (error) { if (error instanceof AccessError && error.status === 404) notFound(); throw error; }
  const result = gradeTaskResult(task);
  return <GradeReport initialData={{ task: gradeTaskSummary(task), result, mathImages: result ? await renderMathText(result.questions.flatMap((q) => [q.questionText, q.studentAnswer, q.expectedAnswer, q.feedback])) : {} }} />;
}
