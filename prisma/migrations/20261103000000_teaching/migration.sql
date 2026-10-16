-- CreateTable
CREATE TABLE "teaching_sessions" (
    "id" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "originalDate" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "bindingVersion" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "binding" JSONB NOT NULL,
    "planVersion" INTEGER NOT NULL DEFAULT 0,
    "confirmedPlanVersion" INTEGER,
    "rosterFingerprint" TEXT,
    "rosterConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "summary" TEXT NOT NULL DEFAULT '',
    "reflection" TEXT NOT NULL DEFAULT '',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "interruptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teaching_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teaching_session_lessons" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "bindingVersion" INTEGER NOT NULL,
    "lessonId" TEXT NOT NULL,

    CONSTRAINT "teaching_session_lessons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teaching_participants" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "classroomId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "studentNumber" TEXT NOT NULL,
    "classroomName" TEXT NOT NULL,
    "rosterStatus" TEXT NOT NULL DEFAULT 'EXPECTED',
    "rosterReason" TEXT NOT NULL DEFAULT '',
    "attendance" TEXT NOT NULL DEFAULT 'UNMARKED',
    "attendanceReason" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "teaching_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teaching_plan_versions" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "bindingVersion" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "aiJobId" TEXT,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "plan" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teaching_plan_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teaching_events" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teaching_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "teaching_sessions_teacherId_originalDate_idx" ON "teaching_sessions"("teacherId", "originalDate");

-- CreateIndex
CREATE UNIQUE INDEX "teaching_sessions_termId_slotId_originalDate_key" ON "teaching_sessions"("termId", "slotId", "originalDate");

-- CreateIndex
CREATE UNIQUE INDEX "teaching_session_lessons_sessionId_bindingVersion_lessonId_key" ON "teaching_session_lessons"("sessionId", "bindingVersion", "lessonId");

-- CreateIndex
CREATE UNIQUE INDEX "teaching_participants_sessionId_studentId_key" ON "teaching_participants"("sessionId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "teaching_plan_versions_sessionId_version_key" ON "teaching_plan_versions"("sessionId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "teaching_events_sessionId_version_key" ON "teaching_events"("sessionId", "version");

-- AddForeignKey
ALTER TABLE "teaching_sessions" ADD CONSTRAINT "teaching_sessions_termId_fkey" FOREIGN KEY ("termId") REFERENCES "school_terms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teaching_sessions" ADD CONSTRAINT "teaching_sessions_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teaching_session_lessons" ADD CONSTRAINT "teaching_session_lessons_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "teaching_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teaching_session_lessons" ADD CONSTRAINT "teaching_session_lessons_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "school_published_lessons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teaching_participants" ADD CONSTRAINT "teaching_participants_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "teaching_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teaching_participants" ADD CONSTRAINT "teaching_participants_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "classroom_students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teaching_participants" ADD CONSTRAINT "teaching_participants_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "classrooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teaching_plan_versions" ADD CONSTRAINT "teaching_plan_versions_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "teaching_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teaching_events" ADD CONSTRAINT "teaching_events_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "teaching_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
