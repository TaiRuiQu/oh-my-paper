ALTER TABLE "classrooms" DROP COLUMN "reviewerIds";
ALTER TABLE "assessments" ADD COLUMN "reviewScope" TEXT NOT NULL DEFAULT 'CLASSROOM';
ALTER TABLE "assessments" ADD CONSTRAINT "assessment_review_scope" CHECK (
  "reviewScope" = 'CLASSROOM' OR ("reviewScope" = 'GRADE' AND "kind" = 'EXAM')
);
