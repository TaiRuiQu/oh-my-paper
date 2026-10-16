ALTER TABLE "exams" ADD COLUMN "layout" JSONB;
ALTER TABLE "exams" ADD CONSTRAINT "exams_layout_check" CHECK (
  "layout" IS NULL OR COALESCE(
    jsonb_typeof("layout") = 'object'
    AND "layout"->>'paperSize' IN ('A3', 'A4')
    AND "layout"->'columns' IN ('1'::jsonb, '2'::jsonb, '3'::jsonb, '4'::jsonb)
    AND (NOT "layout" ? 'orientation' OR "layout"->>'orientation' IN ('portrait', 'landscape')),
    FALSE
  )
);
