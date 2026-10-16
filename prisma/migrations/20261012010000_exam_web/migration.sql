CREATE TABLE "ai_providers" (
  "id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL, "apiType" TEXT NOT NULL,
  "baseURL" TEXT NOT NULL, "model" TEXT NOT NULL, "promptPreset" TEXT NOT NULL DEFAULT 'openai', "encryptedApiKey" TEXT NOT NULL,
  "structuredOutputs" BOOLEAN NOT NULL DEFAULT false, "maxOutputTokens" INTEGER NOT NULL DEFAULT 16000,
  "timeoutSeconds" INTEGER NOT NULL DEFAULT 240,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "ai_settings" (
  "id" TEXT NOT NULL PRIMARY KEY, "providerId" TEXT,
  CONSTRAINT "ai_settings_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ai_providers"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE TYPE "ExamTaskStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');
CREATE TABLE "exam_tasks" (
  "id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "name" TEXT NOT NULL,
  "status" "ExamTaskStatus" NOT NULL DEFAULT 'QUEUED', "inputFiles" TEXT[] NOT NULL,
  "providerSnapshot" JSONB NOT NULL, "model" TEXT NOT NULL, "jobId" TEXT NOT NULL,
  "attempt" TEXT, "outputKey" TEXT, "page" INTEGER NOT NULL DEFAULT 0,
  "totalPages" INTEGER NOT NULL DEFAULT 0, "phase" TEXT NOT NULL DEFAULT 'queued', "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "exam_tasks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "exam_tasks_jobId_key" ON "exam_tasks"("jobId");
CREATE INDEX "exam_tasks_userId_createdAt_idx" ON "exam_tasks"("userId", "createdAt");
