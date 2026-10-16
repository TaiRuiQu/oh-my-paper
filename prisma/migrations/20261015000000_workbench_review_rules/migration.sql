ALTER TABLE "assessment_papers" ADD COLUMN "questionRules" JSONB NOT NULL DEFAULT '{}';
CREATE INDEX "questions_ownerId_createdAt_id_idx" ON "questions"("ownerId", "createdAt", "id");
CREATE TABLE "review_events" ("id" TEXT PRIMARY KEY, "submissionId" TEXT NOT NULL, "itemId" TEXT NOT NULL, "reviewerId" TEXT NOT NULL, "round" TEXT NOT NULL, "score" DOUBLE PRECISION NOT NULL, "feedback" TEXT NOT NULL, "source" TEXT NOT NULL, "aiJobId" TEXT, "partScores" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "review_events_submissionId_itemId_createdAt_idx" ON "review_events"("submissionId", "itemId", "createdAt");
INSERT INTO "review_events" SELECT "id", "submissionId", "itemId", "reviewerId", "round", "score", "feedback", "source", "aiJobId", "partScores", "createdAt" FROM "reviews";
