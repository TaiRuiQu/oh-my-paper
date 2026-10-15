-- One-time conversion: current six-year primary and three-year junior graduating classes
-- graduate in 2027. Keep the school stage in the cohort label to isolate equal-year scopes.
-- Existing senior cohorts and curriculum grades on questions/papers remain unchanged.
BEGIN;

CREATE TEMPORARY TABLE legacy_primary_junior_cohort_labels (
  label TEXT PRIMARY KEY,
  cohort TEXT NOT NULL
) ON COMMIT DROP;

INSERT INTO legacy_primary_junior_cohort_labels (label, cohort) VALUES
  ('小学一年级', '小学2032届'),
  ('一年级', '小学2032届'),
  ('小一', '小学2032届'),
  ('小学二年级', '小学2031届'),
  ('二年级', '小学2031届'),
  ('小二', '小学2031届'),
  ('小学三年级', '小学2030届'),
  ('三年级', '小学2030届'),
  ('小三', '小学2030届'),
  ('小学四年级', '小学2029届'),
  ('四年级', '小学2029届'),
  ('小四', '小学2029届'),
  ('小学五年级', '小学2028届'),
  ('五年级', '小学2028届'),
  ('小五', '小学2028届'),
  ('小学六年级', '小学2027届'),
  ('六年级', '小学2027届'),
  ('小六', '小学2027届'),
  ('初一', '初中2029届'),
  ('初中一年级', '初中2029届'),
  ('七年级', '初中2029届'),
  ('初二', '初中2028届'),
  ('初中二年级', '初中2028届'),
  ('八年级', '初中2028届'),
  ('初三', '初中2027届'),
  ('初中三年级', '初中2027届'),
  ('九年级', '初中2027届');

UPDATE classrooms classroom
SET cohort = mapping.cohort
FROM legacy_primary_junior_cohort_labels mapping
WHERE btrim(classroom.cohort) = mapping.label;

-- Merge equivalent director grants within each stage, preserving existing year-based grants.
WITH normalized_assignments AS (
  SELECT assignment.id,
    row_number() OVER (
      PARTITION BY assignment."userId", COALESCE(mapping.cohort, assignment.cohort)
      ORDER BY (mapping.label IS NULL) DESC, assignment.id
    ) AS position
  FROM teaching_assignments assignment
  LEFT JOIN legacy_primary_junior_cohort_labels mapping ON btrim(assignment.cohort) = mapping.label
  WHERE assignment.role = 'GRADE_DIRECTOR'
)
DELETE FROM teaching_assignments assignment
USING normalized_assignments normalized
WHERE assignment.id = normalized.id AND normalized.position > 1;

UPDATE teaching_assignments assignment
SET cohort = mapping.cohort
FROM legacy_primary_junior_cohort_labels mapping
WHERE assignment.role = 'GRADE_DIRECTOR' AND btrim(assignment.cohort) = mapping.label;

COMMIT;
