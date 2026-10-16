ALTER TABLE "assessments"
  ADD COLUMN "rosterRevision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "rosterStatus" TEXT NOT NULL DEFAULT 'CONFIRMED',
  ADD CONSTRAINT "assessments_rosterRevision_check" CHECK ("rosterRevision" > 0),
  ADD CONSTRAINT "assessments_rosterStatus_check" CHECK ("rosterStatus" IN ('CONFIRMED', 'NEEDS_REVIEW'));

CREATE TABLE "assessment_participants" (
  "id" TEXT PRIMARY KEY,
  "assessmentId" TEXT NOT NULL REFERENCES "assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "studentId" TEXT NOT NULL REFERENCES "classroom_students"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "classroomId" TEXT NOT NULL REFERENCES "classrooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "classroomName" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "studentNumber" TEXT NOT NULL,
  "stage" TEXT NOT NULL,
  "cohort" TEXT NOT NULL
);
CREATE UNIQUE INDEX "assessment_participants_assessmentId_studentId_key" ON "assessment_participants"("assessmentId", "studentId");
CREATE INDEX "assessment_participants_studentId_idx" ON "assessment_participants"("studentId");
CREATE TABLE "assessment_participant_subjects" (
  "id" TEXT PRIMARY KEY,
  "participantId" TEXT NOT NULL REFERENCES "assessment_participants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "paperId" TEXT NOT NULL REFERENCES "papers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "status" TEXT NOT NULL DEFAULT 'REQUIRED',
  "reason" TEXT NOT NULL DEFAULT '',
  CONSTRAINT "assessment_participant_subjects_status_check" CHECK ("status" IN ('REQUIRED', 'ABSENT', 'EXEMPT', 'WITHDRAWN')),
  CONSTRAINT "assessment_participant_subjects_reason_check" CHECK ("status" = 'REQUIRED' OR length(trim("reason")) > 0)
);
CREATE UNIQUE INDEX "assessment_participant_subjects_participantId_paperId_key" ON "assessment_participant_subjects"("participantId", "paperId");
CREATE TABLE "assessment_roster_events" (
  "id" TEXT PRIMARY KEY,
  "assessmentId" TEXT NOT NULL REFERENCES "assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "revision" INTEGER NOT NULL,
  "actorId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "changes" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "assessment_roster_events_assessmentId_revision_key" ON "assessment_roster_events"("assessmentId", "revision");

-- No original roster was stored. This is a reconstruction for explicit human review,
-- including students proven by submissions; it is never labelled a historical truth.
UPDATE "assessments" SET "rosterStatus" = 'NEEDS_REVIEW';
INSERT INTO "assessment_participants" ("id", "assessmentId", "studentId", "classroomId", "classroomName", "name", "studentNumber", "stage", "cohort")
SELECT md5(a."id" || ':' || s."id"), a."id", s."id", c."id", c."name", s."name", s."studentNumber", c."stage", c."cohort"
FROM "assessments" a
JOIN "classroom_students" s ON s."classroomId" = ANY(a."classroomIds") OR EXISTS (
  SELECT 1 FROM "scan_submissions" submission WHERE submission."assessmentId" = a."id" AND submission."studentId" = s."id"
)
JOIN "classrooms" c ON c."id" = s."classroomId";
INSERT INTO "assessment_participant_subjects" ("id", "participantId", "paperId")
SELECT md5(participant."id" || ':' || (config->>'paperId')), participant."id", config->>'paperId'
FROM "assessment_participants" participant
JOIN "assessments" a ON a."id" = participant."assessmentId"
CROSS JOIN LATERAL jsonb_array_elements(a."papers") config
JOIN "papers" paper ON paper."id" = config->>'paperId';
INSERT INTO "assessment_roster_events" ("id", "assessmentId", "revision", "actorId", "reason", "changes")
SELECT md5("id" || ':roster-reconstruction'), "id", 1, 'system:migration',
  '原系统未保存参试名册，按迁移时班级名单与已有答卷重建，须人工核对。',
  '{"source":"MIGRATION_RECONSTRUCTION","requiresReview":true}'::jsonb
FROM "assessments";
