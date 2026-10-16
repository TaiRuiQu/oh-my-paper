-- DropForeignKey
ALTER TABLE "exams" DROP CONSTRAINT "exams_userId_fkey";

-- DropForeignKey
ALTER TABLE "exam_sections" DROP CONSTRAINT "exam_sections_examId_fkey";

-- DropForeignKey
ALTER TABLE "exam_questions" DROP CONSTRAINT "exam_questions_examId_fkey";

-- DropForeignKey
ALTER TABLE "exam_questions" DROP CONSTRAINT "exam_questions_sectionId_examId_fkey";

-- DropForeignKey
ALTER TABLE "exam_answers" DROP CONSTRAINT "exam_answers_examId_fkey";

-- DropForeignKey
ALTER TABLE "question_answers" DROP CONSTRAINT "question_answers_examId_fkey";

-- DropForeignKey
ALTER TABLE "question_answers" DROP CONSTRAINT "question_answers_questionId_examId_fkey";

-- DropForeignKey
ALTER TABLE "submissions" DROP CONSTRAINT "submissions_examId_fkey";

-- DropForeignKey
ALTER TABLE "submissions" DROP CONSTRAINT "submissions_studentId_fkey";

-- DropForeignKey
ALTER TABLE "submission_answers" DROP CONSTRAINT "submission_answers_submissionId_examId_fkey";

-- DropForeignKey
ALTER TABLE "submission_answers" DROP CONSTRAINT "submission_answers_questionId_examId_fkey";

-- DropForeignKey
ALTER TABLE "exam_tasks" DROP CONSTRAINT "exam_tasks_userId_fkey";

-- DropForeignKey
ALTER TABLE "exam_tasks" DROP CONSTRAINT "exam_tasks_examId_fkey";

-- DropForeignKey
ALTER TABLE "exam_agent_tasks" DROP CONSTRAINT "exam_agent_tasks_examId_fkey";

-- DropForeignKey
ALTER TABLE "exam_agent_tasks" DROP CONSTRAINT "exam_agent_tasks_submissionId_fkey";

-- DropForeignKey
ALTER TABLE "grading_workflows" DROP CONSTRAINT "grading_workflows_userId_fkey";

-- DropForeignKey
ALTER TABLE "grading_workflows" DROP CONSTRAINT "grading_workflows_sourceId_fkey";

-- DropForeignKey
ALTER TABLE "user_ai_selections" DROP CONSTRAINT "user_ai_selections_userId_fkey";

-- DropForeignKey
ALTER TABLE "user_ai_selections" DROP CONSTRAINT "user_ai_selections_modelId_fkey";

-- DropForeignKey
ALTER TABLE "credit_usage" DROP CONSTRAINT "credit_usage_userId_fkey";

-- DropForeignKey
ALTER TABLE "credit_grants" DROP CONSTRAINT "credit_grants_userId_fkey";

-- DropForeignKey
ALTER TABLE "answer_card_templates" DROP CONSTRAINT "answer_card_templates_userId_fkey";

-- DropForeignKey
ALTER TABLE "answer_card_templates" DROP CONSTRAINT "answer_card_templates_sourceId_fkey";

-- DropForeignKey
ALTER TABLE "answer_card_batches" DROP CONSTRAINT "answer_card_batches_userId_fkey";

-- DropForeignKey
ALTER TABLE "answer_card_batches" DROP CONSTRAINT "answer_card_batches_templateId_fkey";

-- DropForeignKey
ALTER TABLE "answer_card_students" DROP CONSTRAINT "answer_card_students_batchId_fkey";

-- DropForeignKey
ALTER TABLE "answer_card_students" DROP CONSTRAINT "answer_card_students_submissionId_fkey";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "credits",
ALTER COLUMN "role" SET DEFAULT 'STUDENT';

-- AlterTable
ALTER TABLE "ai_providers" ALTER COLUMN "maxOutputTokens" SET DEFAULT 16384;

-- DropTable
DROP TABLE "exams";

-- DropTable
DROP TABLE "exam_sections";

-- DropTable
DROP TABLE "exam_questions";

-- DropTable
DROP TABLE "exam_answers";

-- DropTable
DROP TABLE "question_answers";

-- DropTable
DROP TABLE "submissions";

-- DropTable
DROP TABLE "submission_answers";

-- DropTable
DROP TABLE "exam_tasks";

-- DropTable
DROP TABLE "worker_heartbeats";

-- DropTable
DROP TABLE "exam_agent_tasks";

-- DropTable
DROP TABLE "grading_workflows";

-- DropTable
DROP TABLE "user_ai_selections";

-- DropTable
DROP TABLE "credit_usage";

-- DropTable
DROP TABLE "credit_grants";

-- DropTable
DROP TABLE "answer_card_templates";

-- DropTable
DROP TABLE "answer_card_batches";

-- DropTable
DROP TABLE "answer_card_students";

-- DropEnum
DROP TYPE "ExamTaskStatus";

-- DropEnum
DROP TYPE "ExamAgentKind";

-- CreateTable
CREATE TABLE "questions" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "difficulty" DOUBLE PRECISION NOT NULL,
    "knowledgeTags" TEXT[],
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "papers" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "layout" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "papers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paper_items" (
    "id" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "section" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,

    CONSTRAINT "paper_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classrooms" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "reviewerIds" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "classrooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classroom_students" (
    "id" TEXT NOT NULL,
    "classroomId" TEXT NOT NULL,
    "userId" TEXT,
    "studentNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "classroom_students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessments" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "classroomIds" TEXT[],
    "published" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_papers" (
    "assessmentId" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "gradingMode" TEXT NOT NULL,
    "arbitrationThreshold" DOUBLE PRECISION NOT NULL,
    "conversion" JSONB NOT NULL,

    CONSTRAINT "assessment_papers_pkey" PRIMARY KEY ("assessmentId","paperId")
);

-- CreateTable
CREATE TABLE "card_templates" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "paperId" TEXT,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "preset" BOOLEAN NOT NULL DEFAULT false,
    "layout" JSONB NOT NULL,

    CONSTRAINT "card_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scan_submissions" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "templateId" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "sourceFiles" TEXT[],
    "answers" JSONB NOT NULL,
    "alignment" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scan_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "round" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "feedback" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_assets" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "questions_ownerId_subject_idx" ON "questions"("ownerId", "subject");

-- CreateIndex
CREATE INDEX "papers_ownerId_idx" ON "papers"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "paper_items_paperId_position_key" ON "paper_items"("paperId", "position");

-- CreateIndex
CREATE INDEX "classrooms_ownerId_idx" ON "classrooms"("ownerId");

-- CreateIndex
CREATE INDEX "classroom_students_userId_idx" ON "classroom_students"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "classroom_students_classroomId_studentNumber_key" ON "classroom_students"("classroomId", "studentNumber");

-- CreateIndex
CREATE UNIQUE INDEX "classroom_students_classroomId_userId_key" ON "classroom_students"("classroomId", "userId");

-- CreateIndex
CREATE INDEX "assessments_ownerId_idx" ON "assessments"("ownerId");

-- CreateIndex
CREATE INDEX "card_templates_ownerId_idx" ON "card_templates"("ownerId");

-- CreateIndex
CREATE INDEX "scan_submissions_ownerId_idx" ON "scan_submissions"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "scan_submissions_assessmentId_paperId_studentId_key" ON "scan_submissions"("assessmentId", "paperId", "studentId");

-- CreateIndex
CREATE INDEX "reviews_reviewerId_idx" ON "reviews"("reviewerId");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_submissionId_itemId_round_key" ON "reviews"("submissionId", "itemId", "round");

-- CreateIndex
CREATE INDEX "platform_assets_ownerId_idx" ON "platform_assets"("ownerId");

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "papers" ADD CONSTRAINT "papers_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_items" ADD CONSTRAINT "paper_items_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "papers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classrooms" ADD CONSTRAINT "classrooms_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classroom_students" ADD CONSTRAINT "classroom_students_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "classrooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classroom_students" ADD CONSTRAINT "classroom_students_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_papers" ADD CONSTRAINT "assessment_papers_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_papers" ADD CONSTRAINT "assessment_papers_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "papers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_templates" ADD CONSTRAINT "card_templates_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_templates" ADD CONSTRAINT "card_templates_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "papers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_submissions" ADD CONSTRAINT "scan_submissions_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_submissions" ADD CONSTRAINT "scan_submissions_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_submissions" ADD CONSTRAINT "scan_submissions_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "papers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_submissions" ADD CONSTRAINT "scan_submissions_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "classroom_students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_submissions" ADD CONSTRAINT "scan_submissions_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "card_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "scan_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
