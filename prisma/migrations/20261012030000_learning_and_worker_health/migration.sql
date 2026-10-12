-- AlterTable
ALTER TABLE "exam_tasks" ADD COLUMN     "autoGrade" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "batchId" TEXT,
ADD COLUMN     "studentId" TEXT;

-- CreateTable
CREATE TABLE "worker_heartbeats" (
    "id" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "worker_heartbeats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classrooms" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classrooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_profiles" (
    "id" TEXT NOT NULL,
    "classroomId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "accountId" TEXT,

    CONSTRAINT "student_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grade_batches" (
    "id" TEXT NOT NULL,
    "classroomId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grade_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_tags" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entryKey" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,

    CONSTRAINT "learning_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gradeTaskId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "entryKey" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" "ExamTaskStatus" NOT NULL DEFAULT 'QUEUED',
    "jobId" TEXT NOT NULL,
    "attempt" TEXT,
    "input" JSONB NOT NULL,
    "content" JSONB,
    "answers" JSONB,
    "result" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "practice_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "classrooms_ownerId_idx" ON "classrooms"("ownerId");

-- CreateIndex
CREATE INDEX "student_profiles_accountId_idx" ON "student_profiles"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "student_profiles_classroomId_number_key" ON "student_profiles"("classroomId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "learning_tags_userId_entryKey_key" ON "learning_tags"("userId", "entryKey");

-- CreateIndex
CREATE UNIQUE INDEX "practice_sessions_jobId_key" ON "practice_sessions"("jobId");

-- CreateIndex
CREATE INDEX "practice_sessions_userId_createdAt_idx" ON "practice_sessions"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "exam_tasks" ADD CONSTRAINT "exam_tasks_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "student_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_tasks" ADD CONSTRAINT "exam_tasks_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "grade_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "classrooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_batches" ADD CONSTRAINT "grade_batches_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "classrooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
