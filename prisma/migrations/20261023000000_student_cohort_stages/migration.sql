BEGIN;

ALTER TABLE classrooms ADD COLUMN stage TEXT;
ALTER TABLE teaching_assignments ADD COLUMN stage TEXT NOT NULL DEFAULT '';
ALTER TABLE teaching_assignments DROP CONSTRAINT teaching_assignment_scope;
DROP INDEX teaching_assignments_scope_key;

-- Prior migrations prefixed primary/junior labels and used bare years for senior cohorts.
UPDATE classrooms SET
  stage = CASE
    WHEN cohort LIKE '小学%' THEN '小学'
    WHEN cohort LIKE '初中%' OR cohort LIKE '初%' THEN '初中'
    ELSE '高中'
  END,
  cohort = regexp_replace(cohort, '^(小学|初中|高中)([0-9]{4}[届级])$', '\2');

UPDATE teaching_assignments SET
  stage = CASE
    WHEN cohort LIKE '小学%' THEN '小学'
    WHEN cohort LIKE '初中%' OR cohort LIKE '初%' THEN '初中'
    ELSE '高中'
  END,
  cohort = regexp_replace(cohort, '^(小学|初中|高中)([0-9]{4}[届级])$', '\2')
WHERE role = 'GRADE_DIRECTOR';

-- A prefixed senior label can coincide with an existing bare-year grant.
WITH duplicate_scopes AS (
  SELECT id, row_number() OVER (
    PARTITION BY "userId", role, stage, cohort, COALESCE("classroomId", ''), subject
    ORDER BY id
  ) AS position FROM teaching_assignments
)
DELETE FROM teaching_assignments assignment USING duplicate_scopes duplicate
WHERE assignment.id = duplicate.id AND duplicate.position > 1;

ALTER TABLE classrooms ALTER COLUMN stage SET NOT NULL;
ALTER TABLE classrooms ADD CONSTRAINT classroom_stage CHECK (stage IN ('小学', '初中', '高中'));
ALTER TABLE teaching_assignments ADD CONSTRAINT teaching_assignment_scope CHECK (
  (role = 'SCHOOL_ADMIN' AND stage = '' AND cohort = '' AND "classroomId" IS NULL AND subject = '') OR
  (role = 'GRADE_DIRECTOR' AND stage IN ('小学', '初中', '高中') AND cohort <> '' AND "classroomId" IS NULL AND subject = '') OR
  (role = 'HOMEROOM' AND stage = '' AND cohort = '' AND "classroomId" IS NOT NULL AND subject = '') OR
  (role = 'SUBJECT_TEACHER' AND stage = '' AND cohort = '' AND "classroomId" IS NOT NULL AND subject IN ('语文','数学','英语','物理','化学','生物','政治','历史','地理'))
);
CREATE UNIQUE INDEX teaching_assignments_scope_key ON teaching_assignments
  ("userId", role, stage, cohort, COALESCE("classroomId", ''), subject);

COMMIT;
