-- AlterTable
ALTER TABLE "reviews" ADD COLUMN     "aiJobId" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'HUMAN';

-- CreateTable
CREATE TABLE "ai_jobs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "input" JSONB NOT NULL,
    "result" JSONB,
    "events" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "workerId" TEXT,
    "heartbeatAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ai_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_jobs_status_createdAt_idx" ON "ai_jobs"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ai_jobs_userId_createdAt_idx" ON "ai_jobs"("userId", "createdAt");
