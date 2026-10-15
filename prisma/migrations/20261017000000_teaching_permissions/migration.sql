CREATE TABLE "teaching_assignments" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "role" TEXT NOT NULL,
  "grade" TEXT NOT NULL DEFAULT '',
  "classroomId" TEXT REFERENCES "classrooms"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "subject" TEXT NOT NULL DEFAULT '',
  CONSTRAINT "teaching_assignment_scope" CHECK (
    ("role" = 'SCHOOL_ADMIN' AND "grade" = '' AND "classroomId" IS NULL AND "subject" = '') OR
    ("role" = 'GRADE_DIRECTOR' AND "grade" <> '' AND "classroomId" IS NULL AND "subject" = '') OR
    ("role" = 'HOMEROOM' AND "grade" = '' AND "classroomId" IS NOT NULL AND "subject" = '') OR
    ("role" = 'SUBJECT_TEACHER' AND "grade" = '' AND "classroomId" IS NOT NULL AND "subject" IN ('语文','数学','英语','物理','化学','生物','政治','历史','地理'))
  )
);
CREATE INDEX "teaching_assignments_userId_idx" ON "teaching_assignments"("userId");
CREATE INDEX "teaching_assignments_classroomId_idx" ON "teaching_assignments"("classroomId");
CREATE UNIQUE INDEX "teaching_assignments_scope_key" ON "teaching_assignments"("userId", "role", "grade", COALESCE("classroomId", ''), "subject");
