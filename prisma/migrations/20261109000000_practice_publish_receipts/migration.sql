-- Practice is unreleased. At this checkpoint practice_sets contains no rows.
-- Keep original publication requests so a lost response cannot create a duplicate release.
ALTER TABLE "practice_sets" ADD COLUMN "publishRequestId" TEXT NOT NULL;
ALTER TABLE "practice_sets" ADD COLUMN "publishInput" JSONB NOT NULL;
CREATE UNIQUE INDEX "practice_sets_ownerId_publishRequestId_key"
    ON "practice_sets"("ownerId", "publishRequestId");
