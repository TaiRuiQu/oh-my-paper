-- CreateTable
CREATE TABLE "practice_sets" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "classroomId" TEXT NOT NULL,
    "classroomName" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "frozenPaper" JSONB NOT NULL,
    "contentFingerprint" TEXT NOT NULL,
    "promptAssetUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "referenceAssetUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "practice_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "classroomId" TEXT NOT NULL,
    "identity" JSONB NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "setId" TEXT,
    "sourcePaperId" TEXT NOT NULL,
    "sourceVersion" TEXT NOT NULL,
    "startRequestId" TEXT NOT NULL,
    "startInput" JSONB NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "frozenPaper" JSONB NOT NULL,
    "contentFingerprint" TEXT NOT NULL,
    "sourceItems" JSONB NOT NULL,
    "promptAssetUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "referenceAssetUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "revealedItemIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "draftVersion" INTEGER NOT NULL DEFAULT 0,
    "draftAnswers" JSONB NOT NULL DEFAULT '[]',
    "draftUpdatedAt" TIMESTAMP(3),
    "currentAttemptId" TEXT,
    "reviewRequestedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "practice_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_attempts" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "requestId" TEXT NOT NULL,
    "sessionVersion" INTEGER NOT NULL,
    "draftVersion" INTEGER NOT NULL,
    "answers" JSONB NOT NULL,
    "assetUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "eligibility" JSONB NOT NULL,
    "attemptFingerprint" TEXT NOT NULL,
    "contentFingerprint" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "practice_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_evaluations" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "candidateId" TEXT,
    "aiJobId" TEXT,
    "evaluation" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "practice_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_exposures" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "originalQuestionId" TEXT NOT NULL,
    "promptFingerprint" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "practice_exposures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_assets" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "practice_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_events" (
    "id" TEXT NOT NULL,
    "sequence" SERIAL NOT NULL,
    "sessionId" TEXT,
    "setId" TEXT,
    "type" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "practice_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_evidence" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "partId" TEXT NOT NULL DEFAULT '',
    "originalQuestionId" TEXT NOT NULL,
    "promptFingerprint" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "knowledgeTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "judgment" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "eligibility" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "practice_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "practice_sets_classroomId_subject_status_id_idx" ON "practice_sets"("classroomId", "subject", "status", "id");

-- CreateIndex
CREATE INDEX "practice_sets_ownerId_idx" ON "practice_sets"("ownerId");

-- CreateIndex
CREATE INDEX "practice_sets_promptAssetUrls_idx" ON "practice_sets" USING GIN ("promptAssetUrls");

-- CreateIndex
CREATE INDEX "practice_sets_referenceAssetUrls_idx" ON "practice_sets" USING GIN ("referenceAssetUrls");

-- CreateIndex
CREATE UNIQUE INDEX "practice_sessions_currentAttemptId_key" ON "practice_sessions"("currentAttemptId");

-- CreateIndex
CREATE INDEX "practice_sessions_userId_id_idx" ON "practice_sessions"("userId", "id");

-- CreateIndex
CREATE INDEX "practice_sessions_studentId_idx" ON "practice_sessions"("studentId");

-- CreateIndex
CREATE INDEX "practice_sessions_classroomId_subject_id_idx" ON "practice_sessions"("classroomId", "subject", "id");

-- CreateIndex
CREATE INDEX "practice_sessions_setId_idx" ON "practice_sessions"("setId");

-- CreateIndex
CREATE INDEX "practice_sessions_promptAssetUrls_idx" ON "practice_sessions" USING GIN ("promptAssetUrls");

-- CreateIndex
CREATE INDEX "practice_sessions_referenceAssetUrls_idx" ON "practice_sessions" USING GIN ("referenceAssetUrls");

-- CreateIndex
CREATE UNIQUE INDEX "practice_sessions_userId_startRequestId_key" ON "practice_sessions"("userId", "startRequestId");

-- CreateIndex
CREATE INDEX "practice_attempts_assetUrls_idx" ON "practice_attempts" USING GIN ("assetUrls");

-- CreateIndex
CREATE UNIQUE INDEX "practice_attempts_sessionId_sequence_key" ON "practice_attempts"("sessionId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "practice_attempts_sessionId_requestId_key" ON "practice_attempts"("sessionId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "practice_evaluations_aiJobId_key" ON "practice_evaluations"("aiJobId");

-- CreateIndex
CREATE UNIQUE INDEX "practice_evaluations_attemptId_version_key" ON "practice_evaluations"("attemptId", "version");

-- CreateIndex
CREATE INDEX "practice_exposures_userId_originalQuestionId_idx" ON "practice_exposures"("userId", "originalQuestionId");

-- CreateIndex
CREATE INDEX "practice_exposures_userId_promptFingerprint_idx" ON "practice_exposures"("userId", "promptFingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "practice_assets_assetId_key" ON "practice_assets"("assetId");

-- CreateIndex
CREATE INDEX "practice_assets_sessionId_idx" ON "practice_assets"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "practice_events_sequence_key" ON "practice_events"("sequence");

-- CreateIndex
CREATE INDEX "practice_events_sessionId_sequence_idx" ON "practice_events"("sessionId", "sequence");

-- CreateIndex
CREATE INDEX "practice_events_setId_sequence_idx" ON "practice_events"("setId", "sequence");

-- CreateIndex
CREATE INDEX "practice_evidence_sessionId_recordedAt_idx" ON "practice_evidence"("sessionId", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "practice_evidence_evaluationId_itemId_partId_key" ON "practice_evidence"("evaluationId", "itemId", "partId");

-- AddForeignKey
ALTER TABLE "practice_sets" ADD CONSTRAINT "practice_sets_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_sets" ADD CONSTRAINT "practice_sets_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "classrooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_sessions" ADD CONSTRAINT "practice_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_sessions" ADD CONSTRAINT "practice_sessions_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "classroom_students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_sessions" ADD CONSTRAINT "practice_sessions_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "classrooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_sessions" ADD CONSTRAINT "practice_sessions_setId_fkey" FOREIGN KEY ("setId") REFERENCES "practice_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_sessions" ADD CONSTRAINT "practice_sessions_currentAttemptId_fkey" FOREIGN KEY ("currentAttemptId") REFERENCES "practice_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_attempts" ADD CONSTRAINT "practice_attempts_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "practice_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_evaluations" ADD CONSTRAINT "practice_evaluations_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "practice_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_exposures" ADD CONSTRAINT "practice_exposures_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "practice_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_assets" ADD CONSTRAINT "practice_assets_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "practice_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_assets" ADD CONSTRAINT "practice_assets_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "platform_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_events" ADD CONSTRAINT "practice_events_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "practice_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_events" ADD CONSTRAINT "practice_events_setId_fkey" FOREIGN KEY ("setId") REFERENCES "practice_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_evidence" ADD CONSTRAINT "practice_evidence_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "practice_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_evidence" ADD CONSTRAINT "practice_evidence_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "practice_evaluations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
