CREATE TABLE "exam_sections" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "score" DOUBLE PRECISION,
    CONSTRAINT "exam_sections_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "exam_sections_position_check" CHECK ("position" > 0),
    CONSTRAINT "exam_sections_score_check" CHECK ("score" >= 0 AND "score" < 'Infinity'::float8)
);

CREATE UNIQUE INDEX "exam_sections_examId_position_key" ON "exam_sections"("examId", "position");
CREATE UNIQUE INDEX "exam_sections_examId_number_key" ON "exam_sections"("examId", "number");
CREATE UNIQUE INDEX "exam_sections_id_examId_key" ON "exam_sections"("id", "examId");
ALTER TABLE "exam_sections" ADD CONSTRAINT "exam_sections_examId_fkey"
    FOREIGN KEY ("examId") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "exam_questions" ADD COLUMN "sectionId" TEXT;
ALTER TABLE "exam_questions" ADD COLUMN "number" INTEGER;
ALTER TABLE "exam_questions" ADD COLUMN "subquestions" JSONB NOT NULL DEFAULT '[]';

-- Existing flat results retain their content, IDs, order, answers and submissions.
-- The original source must be parsed again to recover its printed hierarchy.
INSERT INTO "exam_sections" ("id", "examId", "position", "number", "title", "description")
SELECT 'legacy-section-' || "id", "id", 1, '一', '题目', '' FROM "exams";
UPDATE "exam_questions" SET "sectionId" = 'legacy-section-' || "examId", "number" = "position";

ALTER TABLE "exam_questions" ALTER COLUMN "sectionId" SET NOT NULL;
ALTER TABLE "exam_questions" ALTER COLUMN "number" SET NOT NULL;
ALTER TABLE "exam_questions" ADD CONSTRAINT "exam_questions_number_check" CHECK ("number" > 0);
ALTER TABLE "exam_questions" ADD CONSTRAINT "exam_questions_subquestions_check"
    CHECK (jsonb_typeof("subquestions") = 'array');
ALTER TABLE "exam_questions" ADD CONSTRAINT "exam_questions_sectionId_examId_fkey"
    FOREIGN KEY ("sectionId", "examId") REFERENCES "exam_sections"("id", "examId") ON DELETE CASCADE ON UPDATE CASCADE;
