ALTER TABLE "exam_tasks" ADD COLUMN "totalQuestions" INTEGER, ADD COLUMN "parsedQuestions" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "exam_agent_tasks" ADD COLUMN "totalQuestions" INTEGER;
UPDATE "exam_tasks" task SET "totalQuestions" = counts.total, "parsedQuestions" = counts.total
FROM (SELECT "examId", COUNT(*)::INTEGER AS total FROM "exam_questions" GROUP BY "examId") counts
WHERE task."examId" = counts."examId" AND task.status = 'COMPLETED';
UPDATE "exam_agent_tasks" task SET "totalQuestions" = counts.total
FROM (SELECT "examId", COUNT(*)::INTEGER AS total FROM "exam_questions" GROUP BY "examId") counts
WHERE task."examId" = counts."examId";
ALTER TABLE "exam_tasks" ADD CONSTRAINT "exam_tasks_question_progress_check" CHECK (
 "parsedQuestions" >= 0 AND ("totalQuestions" IS NULL OR ("totalQuestions" > 0 AND "parsedQuestions" <= "totalQuestions"))
);
ALTER TABLE "exam_agent_tasks" ADD CONSTRAINT "exam_agent_tasks_question_total_check" CHECK ("totalQuestions" IS NULL OR "totalQuestions" > 0);
