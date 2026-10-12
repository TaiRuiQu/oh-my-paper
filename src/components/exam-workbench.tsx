"use client";
import { useQuery } from "@tanstack/react-query";
import type { ExamTaskSummary } from "@/contracts/exam-tasks";
import { apiRequest } from "@/lib/http-client";
import { ExamUpload } from "./exams/exam-upload";
import { ExamHistory } from "./exams/exam-history";

export function ExamWorkbench({
  initialTasks,
  model,
  isAdmin,
  grading = false,
  templateTaskId,
}: {
  initialTasks: ExamTaskSummary[];
  model: string | null;
  isAdmin: boolean;
  grading?: boolean;
  templateTaskId?: string;
}) {
  const tasks = useQuery({
    queryKey: ["exams"],
    queryFn: () => apiRequest<{ tasks: ExamTaskSummary[] }>("/api/exams"),
    initialData: { tasks: initialTasks },
    refetchInterval: (query) =>
      query.state.data?.tasks.some((t) => ["QUEUED", "RUNNING"].includes(t.status)) ? 2500 : false,
  });

  return (
    <>
      <ExamUpload
        tasks={tasks.data.tasks}
        model={model}
        isAdmin={isAdmin}
        grading={grading}
        templateTaskId={templateTaskId}
        onUploaded={() => tasks.refetch()}
      />
      <ExamHistory
        tasks={tasks.data.tasks}
        grading={grading}
        isFetching={tasks.isFetching}
        error={!!tasks.error}
        onRefresh={() => tasks.refetch()}
      />
    </>
  );
}
