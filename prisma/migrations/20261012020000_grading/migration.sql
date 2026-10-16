CREATE TABLE "grade_tasks" (
  "id" TEXT NOT NULL PRIMARY KEY, "examTaskId" TEXT NOT NULL, "examOutputKey" TEXT NOT NULL,
  "status" "ExamTaskStatus" NOT NULL DEFAULT 'QUEUED', "input" JSONB NOT NULL,
  "providerSnapshot" JSONB NOT NULL, "model" TEXT NOT NULL, "promptVersion" TEXT NOT NULL,
  "jobId" TEXT NOT NULL, "attempt" TEXT, "progress" INTEGER NOT NULL DEFAULT 0,
  "total" INTEGER NOT NULL, "phase" TEXT NOT NULL DEFAULT 'queued', "result" JSONB, "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "grade_tasks_examTaskId_fkey" FOREIGN KEY ("examTaskId") REFERENCES "exam_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "grade_tasks_jobId_key" ON "grade_tasks"("jobId");
CREATE INDEX "grade_tasks_examTaskId_createdAt_idx" ON "grade_tasks"("examTaskId", "createdAt");
