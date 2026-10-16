-- DropIndex
DROP INDEX "scan_submissions_assessmentId_paperId_studentId_key";

-- AlterTable
ALTER TABLE "scan_submissions" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "attemptNumber" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "homework_assignments" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'ISSUED',
    "name" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "dueLocal" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "allowLate" BOOLEAN NOT NULL DEFAULT false,
    "rosterRevision" INTEGER NOT NULL,
    "papers" JSONB NOT NULL,
    "issuedBy" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "homework_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "homework_works" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "participantSubjectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "draftVersion" INTEGER NOT NULL DEFAULT 0,
    "draftAnswers" JSONB NOT NULL DEFAULT '[]',
    "collectionStatus" TEXT NOT NULL DEFAULT 'NOT_SUBMITTED',
    "dueAtOverride" TIMESTAMP(3),
    "dueLocalOverride" TEXT,
    "extensionReason" TEXT NOT NULL DEFAULT '',
    "currentAttemptId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "homework_works_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "homework_attempts" (
    "id" TEXT NOT NULL,
    "workId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "requestId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "submittedBy" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "late" BOOLEAN NOT NULL,

    CONSTRAINT "homework_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "homework_assets" (
    "id" TEXT NOT NULL,
    "workId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "homework_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "homework_events" (
    "id" TEXT NOT NULL,
    "sequence" SERIAL NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "workId" TEXT,
    "type" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "assignmentVersion" INTEGER NOT NULL,
    "workVersion" INTEGER,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "homework_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "homework_assignments_assessmentId_key" ON "homework_assignments"("assessmentId");

-- CreateIndex
CREATE INDEX "homework_assignments_status_dueAt_idx" ON "homework_assignments"("status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "homework_works_participantSubjectId_key" ON "homework_works"("participantSubjectId");

-- CreateIndex
CREATE UNIQUE INDEX "homework_works_currentAttemptId_key" ON "homework_works"("currentAttemptId");

-- CreateIndex
CREATE INDEX "homework_works_assignmentId_collectionStatus_idx" ON "homework_works"("assignmentId", "collectionStatus");

-- CreateIndex
CREATE UNIQUE INDEX "homework_attempts_submissionId_key" ON "homework_attempts"("submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "homework_attempts_workId_sequence_key" ON "homework_attempts"("workId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "homework_attempts_workId_requestId_key" ON "homework_attempts"("workId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "homework_assets_assetId_key" ON "homework_assets"("assetId");

-- CreateIndex
CREATE INDEX "homework_assets_workId_idx" ON "homework_assets"("workId");

-- CreateIndex
CREATE UNIQUE INDEX "homework_events_sequence_key" ON "homework_events"("sequence");

-- CreateIndex
CREATE INDEX "homework_events_assignmentId_sequence_idx" ON "homework_events"("assignmentId", "sequence");

-- CreateIndex
CREATE INDEX "homework_events_workId_sequence_idx" ON "homework_events"("workId", "sequence");

-- CreateIndex
CREATE INDEX "scan_submissions_assessmentId_active_idx" ON "scan_submissions"("assessmentId", "active");

-- A returned attempt remains immutable history; at most one attempt supplies current grades.
CREATE UNIQUE INDEX "scan_submissions_current_attempt_key"
ON "scan_submissions" ("assessmentId", "paperId", "studentId") WHERE "active" = true;

-- CreateIndex
CREATE UNIQUE INDEX "scan_submissions_assessmentId_paperId_studentId_attemptNumb_key" ON "scan_submissions"("assessmentId", "paperId", "studentId", "attemptNumber");

-- AddForeignKey
ALTER TABLE "homework_assignments" ADD CONSTRAINT "homework_assignments_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homework_works" ADD CONSTRAINT "homework_works_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "homework_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homework_works" ADD CONSTRAINT "homework_works_participantSubjectId_fkey" FOREIGN KEY ("participantSubjectId") REFERENCES "assessment_participant_subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homework_works" ADD CONSTRAINT "homework_works_currentAttemptId_fkey" FOREIGN KEY ("currentAttemptId") REFERENCES "homework_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homework_attempts" ADD CONSTRAINT "homework_attempts_workId_fkey" FOREIGN KEY ("workId") REFERENCES "homework_works"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homework_attempts" ADD CONSTRAINT "homework_attempts_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "scan_submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homework_assets" ADD CONSTRAINT "homework_assets_workId_fkey" FOREIGN KEY ("workId") REFERENCES "homework_works"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homework_assets" ADD CONSTRAINT "homework_assets_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "platform_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homework_events" ADD CONSTRAINT "homework_events_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "homework_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
