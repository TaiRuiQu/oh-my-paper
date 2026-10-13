CREATE TABLE "grading_workflows" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "userId" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
 "sourceId" TEXT NOT NULL REFERENCES "exam_tasks"("id") ON DELETE CASCADE,
 "kind" TEXT NOT NULL CHECK ("kind" IN ('GRADING', 'QUICK')),
 "name" TEXT NOT NULL,
 "status" "ExamTaskStatus" NOT NULL DEFAULT 'QUEUED',
 "answerTaskId" TEXT,
 "gradingTaskId" TEXT,
 "inputFiles" TEXT[] NOT NULL,
 "jobId" TEXT NOT NULL UNIQUE,
 "error" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "grading_workflows_userId_createdAt_idx" ON "grading_workflows"("userId", "createdAt");
-- Keep existing grading reports discoverable in the new management history.
INSERT INTO "grading_workflows" (
 "id", "userId", "sourceId", "kind", "name", "status", "answerTaskId", "gradingTaskId", "inputFiles", "jobId", "error", "createdAt"
)
SELECT grade."id", source."userId", source."id", 'GRADING', grade."name",
 CASE WHEN grade."status" IN ('QUEUED', 'RUNNING') THEN 'FAILED'::"ExamTaskStatus" ELSE grade."status" END,
 (SELECT answer."id" FROM "exam_agent_tasks" answer WHERE answer."examId" = grade."examId" AND answer."kind" = 'ANSWER' AND answer."status" = 'COMPLETED' ORDER BY answer."createdAt" DESC LIMIT 1),
 grade."id", ARRAY[]::TEXT[], 'imported:' || grade."id",
 CASE WHEN grade."status" IN ('QUEUED', 'RUNNING') THEN '请继续批改。' ELSE grade."error" END,
 grade."createdAt"
FROM "exam_agent_tasks" grade JOIN "exam_tasks" source ON source."examId" = grade."examId"
WHERE grade."kind" = 'GRADING';
