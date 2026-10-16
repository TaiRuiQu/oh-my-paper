BEGIN;

-- DropForeignKey
ALTER TABLE "ai_settings" DROP CONSTRAINT "ai_settings_providerId_fkey";

-- DropForeignKey
ALTER TABLE "exam_tasks" DROP CONSTRAINT "exam_tasks_studentId_fkey";

-- DropForeignKey
ALTER TABLE "exam_tasks" DROP CONSTRAINT "exam_tasks_batchId_fkey";

-- DropForeignKey
ALTER TABLE "student_profiles" DROP CONSTRAINT "student_profiles_classroomId_fkey";

-- DropForeignKey
ALTER TABLE "grade_batches" DROP CONSTRAINT "grade_batches_classroomId_fkey";

-- DropForeignKey
ALTER TABLE "grade_batches" DROP CONSTRAINT "grade_batches_templateId_fkey";

-- DropForeignKey
ALTER TABLE "grade_tasks" DROP CONSTRAINT "grade_tasks_examTaskId_fkey";

-- DropForeignKey
ALTER TABLE "workspaces" DROP CONSTRAINT "workspaces_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "workspace_members" DROP CONSTRAINT "workspace_members_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "workspace_members" DROP CONSTRAINT "workspace_members_userId_fkey";

-- Intentional domain reset: there is no compatibility with legacy parses or AI stages.
DELETE FROM "exam_tasks";
DELETE FROM "ai_settings";
DELETE FROM "ai_providers";

-- AlterTable
ALTER TABLE "ai_providers" DROP COLUMN "createdAt",
DROP COLUMN "model",
DROP COLUMN "promptPreset",
DROP COLUMN "updatedAt",
ALTER COLUMN "structuredOutputs" SET DEFAULT true;

-- AlterTable
ALTER TABLE "ai_settings" DROP COLUMN "providerId",
ADD COLUMN     "modelId" TEXT,
ADD COLUMN     "reasoningEffort" TEXT NOT NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE "exam_tasks" DROP COLUMN "autoGrade",
DROP COLUMN "batchId",
DROP COLUMN "model",
DROP COLUMN "page",
DROP COLUMN "phase",
DROP COLUMN "studentId",
DROP COLUMN "totalPages",
DROP COLUMN "updatedAt",
ADD COLUMN     "examId" TEXT;

-- DropTable
DROP TABLE "classrooms";

-- DropTable
DROP TABLE "student_profiles";

-- DropTable
DROP TABLE "grade_batches";

-- DropTable
DROP TABLE "learning_tags";

-- DropTable
DROP TABLE "practice_sessions";

-- DropTable
DROP TABLE "grade_tasks";

-- DropTable
DROP TABLE "workspaces";

-- DropTable
DROP TABLE "workspace_members";

-- DropEnum
DROP TYPE "WorkspaceKind";

-- DropEnum
DROP TYPE "WorkspaceRole";

-- CreateTable
CREATE TABLE "exams" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "totalScore" DOUBLE PRECISION,

    CONSTRAINT "exams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_questions" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "materials" JSONB NOT NULL,
    "score" DOUBLE PRECISION,

    CONSTRAINT "exam_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_answers" (
    "examId" TEXT NOT NULL,

    CONSTRAINT "exam_answers_pkey" PRIMARY KEY ("examId")
);

-- CreateTable
CREATE TABLE "question_answers" (
    "questionId" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "solution" TEXT NOT NULL,
    "gradingCriteria" TEXT NOT NULL,

    CONSTRAINT "question_answers_pkey" PRIMARY KEY ("questionId")
);

-- CreateTable
CREATE TABLE "submissions" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "studentId" TEXT,

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission_answers" (
    "submissionId" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "correct" BOOLEAN,
    "score" DOUBLE PRECISION,

    CONSTRAINT "submission_answers_pkey" PRIMARY KEY ("submissionId","questionId")
);

-- CreateTable
CREATE TABLE "ai_models" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "reasoningEfforts" TEXT[],

    CONSTRAINT "ai_models_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "exams_userId_idx" ON "exams"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "exam_questions_examId_position_key" ON "exam_questions"("examId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "exam_questions_id_examId_key" ON "exam_questions"("id", "examId");

-- CreateIndex
CREATE UNIQUE INDEX "question_answers_questionId_examId_key" ON "question_answers"("questionId", "examId");

-- CreateIndex
CREATE INDEX "submissions_examId_idx" ON "submissions"("examId");

-- CreateIndex
CREATE INDEX "submissions_studentId_idx" ON "submissions"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "submissions_id_examId_key" ON "submissions"("id", "examId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_models_providerId_name_key" ON "ai_models"("providerId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "exam_tasks_examId_key" ON "exam_tasks"("examId");

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_questions" ADD CONSTRAINT "exam_questions_examId_fkey" FOREIGN KEY ("examId") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_answers" ADD CONSTRAINT "exam_answers_examId_fkey" FOREIGN KEY ("examId") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_answers" ADD CONSTRAINT "question_answers_examId_fkey" FOREIGN KEY ("examId") REFERENCES "exam_answers"("examId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_answers" ADD CONSTRAINT "question_answers_questionId_examId_fkey" FOREIGN KEY ("questionId", "examId") REFERENCES "exam_questions"("id", "examId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_examId_fkey" FOREIGN KEY ("examId") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_answers" ADD CONSTRAINT "submission_answers_submissionId_examId_fkey" FOREIGN KEY ("submissionId", "examId") REFERENCES "submissions"("id", "examId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_answers" ADD CONSTRAINT "submission_answers_questionId_examId_fkey" FOREIGN KEY ("questionId", "examId") REFERENCES "exam_questions"("id", "examId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_models" ADD CONSTRAINT "ai_models_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ai_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "ai_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_tasks" ADD CONSTRAINT "exam_tasks_examId_fkey" FOREIGN KEY ("examId") REFERENCES "exams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Domain invariants shared by all future answer/submission writers.
ALTER TABLE "exams" ADD CONSTRAINT "exams_totalScore_check" CHECK ("totalScore" >= 0 AND "totalScore" < 'Infinity'::float8);
ALTER TABLE "exam_questions" ADD CONSTRAINT "exam_questions_score_check" CHECK ("score" >= 0 AND "score" < 'Infinity'::float8);
ALTER TABLE "exam_questions" ADD CONSTRAINT "exam_questions_position_check" CHECK ("position" > 0);
ALTER TABLE "exam_questions" ADD CONSTRAINT "exam_questions_materials_check" CHECK (jsonb_typeof("materials") = 'array');
ALTER TABLE "submission_answers" ADD CONSTRAINT "submission_answers_score_check" CHECK ("score" >= 0 AND "score" < 'Infinity'::float8);
ALTER TABLE "ai_models" ALTER COLUMN "reasoningEfforts" SET NOT NULL;
ALTER TABLE "ai_models" ADD CONSTRAINT "ai_models_efforts_check" CHECK (cardinality("reasoningEfforts") > 0);

COMMIT;
