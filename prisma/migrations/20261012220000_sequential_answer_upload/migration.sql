ALTER TABLE "grading_workflows" DROP CONSTRAINT "grading_workflows_kind_check";
ALTER TABLE "grading_workflows" ADD CONSTRAINT "grading_workflows_kind_check"
CHECK ("kind" IN ('GRADING', 'QUICK', 'ANSWER_UPLOAD'));
