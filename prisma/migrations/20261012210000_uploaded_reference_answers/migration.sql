ALTER TABLE "grading_workflows"
ADD COLUMN "referenceFiles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
