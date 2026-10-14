-- Freeze the participant roster when an assessment is created.
ALTER TABLE "assessments" ADD COLUMN "studentIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
UPDATE "assessments" AS a SET "studentIds" = ARRAY(
  SELECT s.id FROM "classroom_students" AS s WHERE s."classroomId" = ANY(a."classroomIds")
);
-- Legacy ordinary accounts receive the least privileged role.
UPDATE "users" SET role = 'STUDENT' WHERE role = 'USER';
