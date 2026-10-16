CREATE TYPE "ExamAgentKind" AS ENUM ('ANSWER', 'GRADING');
ALTER TABLE "submission_answers" ADD COLUMN "feedback" TEXT NOT NULL DEFAULT '';
CREATE TABLE "exam_agent_tasks" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "examId" TEXT NOT NULL REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "kind" "ExamAgentKind" NOT NULL,
  "name" TEXT NOT NULL,
  "status" "ExamTaskStatus" NOT NULL DEFAULT 'QUEUED',
  "inputFiles" TEXT[] NOT NULL,
  "providerSnapshot" JSONB NOT NULL,
  "reference" JSONB NOT NULL DEFAULT '[]',
  "result" JSONB NOT NULL DEFAULT '{"questions":[]}',
  "jobId" TEXT NOT NULL,
  "attempt" TEXT,
  "submissionId" TEXT REFERENCES "submissions"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "exam_agent_tasks_jobId_key" ON "exam_agent_tasks"("jobId");
CREATE UNIQUE INDEX "exam_agent_tasks_submissionId_key" ON "exam_agent_tasks"("submissionId");
CREATE INDEX "exam_agent_tasks_examId_createdAt_idx" ON "exam_agent_tasks"("examId", "createdAt");
-- Serialize new runs in application code and enforce one active answer writer in SQL.
CREATE UNIQUE INDEX "exam_agent_tasks_active_answer_key" ON "exam_agent_tasks"("examId") WHERE "kind" = 'ANSWER' AND "status" IN ('QUEUED', 'RUNNING');
