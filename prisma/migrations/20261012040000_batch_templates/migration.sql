ALTER TABLE "grade_batches" ADD COLUMN "templateId" TEXT, ADD COLUMN "templateOutputKey" TEXT;
ALTER TABLE "grade_batches" ADD CONSTRAINT "grade_batches_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "exam_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
