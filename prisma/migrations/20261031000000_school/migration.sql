-- CreateTable
CREATE TABLE "school_years" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,

    CONSTRAINT "school_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_terms" (
    "id" TEXT NOT NULL,
    "yearId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "weekOneMonday" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "publishedRevision" INTEGER,
    "publishedAt" TIMESTAMP(3),
    "timetable" JSONB NOT NULL DEFAULT '{"periods":[],"slots":[],"calendar":[],"overrides":[]}',
    "draftReason" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "school_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_courses" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "subject" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "school_courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_rooms" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "capacity" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "school_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_offerings" (
    "id" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "classroomId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "weeklyPeriods" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "school_offerings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_publications" (
    "id" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "timezone" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "termName" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lessonCount" INTEGER NOT NULL,
    "timetable" JSONB NOT NULL,

    CONSTRAINT "school_publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_published_lessons" (
    "id" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "offeringId" TEXT NOT NULL,
    "classroomId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "roomId" TEXT,
    "date" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,

    CONSTRAINT "school_published_lessons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "school_terms_yearId_idx" ON "school_terms"("yearId");

-- CreateIndex
CREATE INDEX "school_offerings_termId_idx" ON "school_offerings"("termId");

-- CreateIndex
CREATE INDEX "school_offerings_teacherId_idx" ON "school_offerings"("teacherId");

-- CreateIndex
CREATE INDEX "school_offerings_classroomId_idx" ON "school_offerings"("classroomId");

-- CreateIndex
CREATE UNIQUE INDEX "school_publications_termId_revision_key" ON "school_publications"("termId", "revision");

-- CreateIndex
CREATE INDEX "school_published_lessons_publicationId_date_idx" ON "school_published_lessons"("publicationId", "date");

-- CreateIndex
CREATE INDEX "school_published_lessons_teacherId_date_idx" ON "school_published_lessons"("teacherId", "date");

-- CreateIndex
CREATE INDEX "school_published_lessons_classroomId_date_idx" ON "school_published_lessons"("classroomId", "date");

-- AddForeignKey
ALTER TABLE "school_terms" ADD CONSTRAINT "school_terms_yearId_fkey" FOREIGN KEY ("yearId") REFERENCES "school_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_offerings" ADD CONSTRAINT "school_offerings_termId_fkey" FOREIGN KEY ("termId") REFERENCES "school_terms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_offerings" ADD CONSTRAINT "school_offerings_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "school_courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_offerings" ADD CONSTRAINT "school_offerings_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "classrooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_offerings" ADD CONSTRAINT "school_offerings_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_publications" ADD CONSTRAINT "school_publications_termId_fkey" FOREIGN KEY ("termId") REFERENCES "school_terms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_publications" ADD CONSTRAINT "school_publications_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_published_lessons" ADD CONSTRAINT "school_published_lessons_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "school_publications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_published_lessons" ADD CONSTRAINT "school_published_lessons_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "school_offerings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_published_lessons" ADD CONSTRAINT "school_published_lessons_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "classrooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_published_lessons" ADD CONSTRAINT "school_published_lessons_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_published_lessons" ADD CONSTRAINT "school_published_lessons_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "school_courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_published_lessons" ADD CONSTRAINT "school_published_lessons_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "school_rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
