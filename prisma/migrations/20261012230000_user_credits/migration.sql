ALTER TABLE "users" ADD COLUMN "credits" DECIMAL(24,8) NOT NULL DEFAULT 100;
ALTER TABLE "ai_models"
  ADD COLUMN "isPublic" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "creditMultiplier" DECIMAL(12,4) NOT NULL DEFAULT 1,
  ADD CONSTRAINT "ai_models_credit_multiplier_check" CHECK ("creditMultiplier" BETWEEN 0.0001 AND 1000);
ALTER TABLE "exam_tasks" ADD COLUMN "creditsSpent" DECIMAL(24,8) NOT NULL DEFAULT 0, ADD COLUMN "errorCode" TEXT;
ALTER TABLE "exam_agent_tasks" ADD COLUMN "creditsSpent" DECIMAL(24,8) NOT NULL DEFAULT 0, ADD COLUMN "errorCode" TEXT;
ALTER TABLE "grading_workflows" ADD COLUMN "modelSnapshots" JSONB NOT NULL DEFAULT '{}', ADD COLUMN "billAnswer" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "errorCode" TEXT;

CREATE TABLE "user_ai_selections" (
  "userId" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "purpose" TEXT NOT NULL CHECK ("purpose" IN ('exam', 'answer', 'grading')),
  "modelId" TEXT NOT NULL REFERENCES "ai_models"("id") ON DELETE CASCADE,
  PRIMARY KEY ("userId", "purpose")
);

CREATE TABLE "credit_usage" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "taskId" TEXT NOT NULL,
  "taskKind" TEXT NOT NULL CHECK ("taskKind" IN ('EXAM', 'ANSWER', 'GRADING')),
  "attempt" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "providerName" TEXT NOT NULL,
  "modelId" TEXT,
  "model" TEXT NOT NULL,
  "creditMultiplier" DECIMAL(12,4) NOT NULL,
  "inputTokens" INTEGER NOT NULL CHECK ("inputTokens" >= 0),
  "cachedTokens" INTEGER NOT NULL CHECK ("cachedTokens" BETWEEN 0 AND "inputTokens"),
  "outputTokens" INTEGER NOT NULL CHECK ("outputTokens" >= 0),
  "credits" DECIMAL(24,8) NOT NULL CHECK ("credits" >= 0),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "credit_usage_userId_createdAt_idx" ON "credit_usage"("userId", "createdAt");
CREATE INDEX "credit_usage_taskKind_taskId_idx" ON "credit_usage"("taskKind", "taskId");
