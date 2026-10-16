-- Store owned content and settings directly, without join tables.
ALTER TABLE "papers" ADD COLUMN "items" JSONB NOT NULL DEFAULT '[]';
UPDATE "papers" p SET "items" = COALESCE((
  SELECT jsonb_agg(jsonb_build_object('id', i.id, 'questionId', i."questionId", 'position', i.position, 'score', i.score, 'section', i.section, 'snapshot', i.snapshot) ORDER BY i.position)
  FROM "paper_items" i WHERE i."paperId" = p.id
), '[]'::jsonb);
ALTER TABLE "assessments" ADD COLUMN "papers" JSONB NOT NULL DEFAULT '[]';
UPDATE "assessments" a SET "papers" = COALESCE((
  SELECT jsonb_agg(to_jsonb(ap) - 'assessmentId' ORDER BY ap.subject)
  FROM "assessment_papers" ap WHERE ap."assessmentId" = a.id
), '[]'::jsonb);
DROP TABLE "paper_items";
DROP TABLE "assessment_papers";
ALTER TABLE "assessments" DROP COLUMN "studentIds";
