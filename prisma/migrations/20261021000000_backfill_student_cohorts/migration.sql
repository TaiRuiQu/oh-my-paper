-- One-time conversion using the agreed reference: current 高三 graduates in 2027.
-- These years are fixed migration data, never derived from the execution date.
BEGIN;

CREATE TEMPORARY TABLE legacy_student_cohort_labels (
  label TEXT PRIMARY KEY,
  cohort TEXT NOT NULL
) ON COMMIT DROP;

INSERT INTO legacy_student_cohort_labels (label, cohort) VALUES
  ('高三', '2027届'), ('高中三年级', '2027届'),
  ('高二', '2028届'), ('高中二年级', '2028届'),
  ('高一', '2029届'), ('高中一年级', '2029届');

UPDATE classrooms classroom
SET cohort = mapping.cohort
FROM legacy_student_cohort_labels mapping
WHERE btrim(classroom.cohort) = mapping.label;

-- Aliases and an existing year-based grant can collapse to the same scope.
-- Keep one equivalent grant before updating to satisfy the unique scope index.
WITH normalized_assignments AS (
  SELECT assignment.id,
    row_number() OVER (
      PARTITION BY assignment."userId", COALESCE(mapping.cohort, assignment.cohort)
      ORDER BY (mapping.label IS NULL) DESC, assignment.id
    ) AS position
  FROM teaching_assignments assignment
  LEFT JOIN legacy_student_cohort_labels mapping ON btrim(assignment.cohort) = mapping.label
  WHERE assignment.role = 'GRADE_DIRECTOR'
)
DELETE FROM teaching_assignments assignment
USING normalized_assignments normalized
WHERE assignment.id = normalized.id AND normalized.position > 1;

UPDATE teaching_assignments assignment
SET cohort = mapping.cohort
FROM legacy_student_cohort_labels mapping
WHERE assignment.role = 'GRADE_DIRECTOR' AND btrim(assignment.cohort) = mapping.label;

COMMIT;
