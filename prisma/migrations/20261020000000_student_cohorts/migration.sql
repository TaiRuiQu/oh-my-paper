-- Student cohorts identify a group of students; curriculum grades stay on questions and papers.
-- Existing labels are preserved: a graduation/admission year cannot be inferred from 高一/高二.
ALTER TABLE "classrooms" RENAME COLUMN "grade" TO "cohort";
ALTER TABLE "teaching_assignments" RENAME COLUMN "grade" TO "cohort";
