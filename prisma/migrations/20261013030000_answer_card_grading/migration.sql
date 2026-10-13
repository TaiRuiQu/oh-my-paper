-- CreateTable
CREATE TABLE "answer_card_templates" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "examRevision" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ExamTaskStatus" NOT NULL DEFAULT 'QUEUED',
    "inputFiles" TEXT[],
    "providerSnapshot" JSONB NOT NULL,
    "regions" JSONB NOT NULL DEFAULT '[]',
    "pageCount" INTEGER NOT NULL DEFAULT 0,
    "jobId" TEXT NOT NULL,
    "attempt" TEXT,
    "outputKey" TEXT,
    "creditsSpent" DECIMAL(24,8) NOT NULL DEFAULT 0,
    "error" TEXT,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "answer_card_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "answer_card_batches" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ExamTaskStatus" NOT NULL DEFAULT 'QUEUED',
    "examSnapshot" JSONB NOT NULL,
    "reference" JSONB NOT NULL,
    "providerSnapshot" JSONB NOT NULL,
    "jobId" TEXT NOT NULL,
    "attempt" TEXT,
    "creditsSpent" DECIMAL(24,8) NOT NULL DEFAULT 0,
    "error" TEXT,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "answer_card_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "answer_card_students" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "inputFiles" TEXT[],
    "status" "ExamTaskStatus" NOT NULL DEFAULT 'QUEUED',
    "result" JSONB NOT NULL DEFAULT '{"questions":[]}',
    "submissionId" TEXT,
    "error" TEXT,

    CONSTRAINT "answer_card_students_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "answer_card_templates_jobId_key" ON "answer_card_templates"("jobId");

-- CreateIndex
CREATE INDEX "answer_card_templates_userId_createdAt_idx" ON "answer_card_templates"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "answer_card_batches_jobId_key" ON "answer_card_batches"("jobId");

-- CreateIndex
CREATE INDEX "answer_card_batches_userId_createdAt_idx" ON "answer_card_batches"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "answer_card_students_submissionId_key" ON "answer_card_students"("submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "answer_card_students_batchId_position_key" ON "answer_card_students"("batchId", "position");

-- AddForeignKey
ALTER TABLE "answer_card_templates" ADD CONSTRAINT "answer_card_templates_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answer_card_templates" ADD CONSTRAINT "answer_card_templates_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "exam_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answer_card_batches" ADD CONSTRAINT "answer_card_batches_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answer_card_batches" ADD CONSTRAINT "answer_card_batches_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "answer_card_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answer_card_students" ADD CONSTRAINT "answer_card_students_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "answer_card_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answer_card_students" ADD CONSTRAINT "answer_card_students_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "submissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

