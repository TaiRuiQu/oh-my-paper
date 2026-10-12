import "server-only";
import { getDb } from "@/server/db/client";
import { taskResult } from "@/server/exams/tasks";
import { createGradeTask } from "@/server/grading/tasks";
import { defaultSubmissions } from "@/lib/grading-defaults";
import { MAX_GRADING_QUESTIONS } from "@/contracts/grading";

// Recover the handoff if a worker died after parsing but before enqueuing grading.
// Compare source versions, so re-recognition can produce its own fresh report.
export async function continueQuickGrade(id?: string) {
  const pending = await getDb().$queryRaw<{ id: string }[]>`
    SELECT e.id FROM exam_tasks e
    WHERE e."autoGrade" = true AND e.status = 'COMPLETED'
      AND e."outputKey" IS NOT NULL
      AND (${id ?? null}::text IS NULL OR e.id = ${id ?? null})
      AND NOT EXISTS (
        SELECT 1 FROM grade_tasks g WHERE g."examTaskId" = e.id
          AND g."examOutputKey" = e."outputKey"
      )
    ORDER BY e."createdAt" ASC LIMIT 50
  `;
  const tasks = await getDb().examTask.findMany({
    where: { id: { in: pending.map((t) => t.id) } },
  });
  for (const task of tasks) {
    const exam = await taskResult(task);
    if (
      !exam?.questions.length ||
      exam.questions.some((q) => !q.solution?.sufficient || !q.solution.answer.trim())
    )
      continue;
    try {
      await createGradeTask(
        task.userId,
        task.id,
        defaultSubmissions(exam).slice(0, MAX_GRADING_QUESTIONS),
      );
    } catch {
      /* An unavailable service leaves the handoff pending for the next sweep. */
    }
  }
}
