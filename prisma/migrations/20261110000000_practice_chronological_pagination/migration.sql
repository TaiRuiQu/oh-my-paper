-- UUIDs identify rows; chronological lists seek by the timestamp plus UUID tie breaker.
-- Replace prefix-equivalent indexes rather than retaining the old UUID-only ordering.
DROP INDEX "papers_ownerId_idx";
CREATE INDEX "papers_ownerId_updatedAt_id_idx" ON "papers"("ownerId", "updatedAt" DESC, "id" DESC);
CREATE INDEX "papers_updatedAt_id_idx" ON "papers"("updatedAt" DESC, "id" DESC);

DROP INDEX "practice_sets_classroomId_subject_status_id_idx";
DROP INDEX "practice_sets_ownerId_idx";
CREATE INDEX "practice_sets_classroomId_subject_status_publishedAt_id_idx" ON "practice_sets"("classroomId", "subject", "status", "publishedAt" DESC, "id" DESC);
CREATE INDEX "practice_sets_publishedAt_id_idx" ON "practice_sets"("publishedAt" DESC, "id" DESC);
-- ownerId lookups are already covered by the publish receipt's unique owner/request index.

DROP INDEX "practice_sessions_userId_id_idx";
DROP INDEX "practice_sessions_studentId_idx";
DROP INDEX "practice_sessions_classroomId_subject_id_idx";
DROP INDEX "practice_sessions_setId_idx";
CREATE INDEX "practice_sessions_userId_createdAt_id_idx" ON "practice_sessions"("userId", "createdAt" DESC, "id" DESC);
CREATE INDEX "practice_sessions_createdAt_id_idx" ON "practice_sessions"("createdAt" DESC, "id" DESC);
CREATE INDEX "practice_sessions_studentId_createdAt_id_idx" ON "practice_sessions"("studentId", "createdAt" DESC, "id" DESC);
CREATE INDEX "practice_sessions_classroomId_subject_createdAt_id_idx" ON "practice_sessions"("classroomId", "subject", "createdAt" DESC, "id" DESC);
CREATE INDEX "practice_sessions_setId_createdAt_id_idx" ON "practice_sessions"("setId", "createdAt" DESC, "id" DESC);

CREATE INDEX "practice_attempts_submittedAt_id_idx" ON "practice_attempts"("submittedAt" DESC, "id" DESC);
DROP INDEX "practice_evidence_sessionId_recordedAt_idx";
CREATE INDEX "practice_evidence_sessionId_recordedAt_id_idx" ON "practice_evidence"("sessionId", "recordedAt" DESC, "id" DESC);
CREATE INDEX "practice_evidence_recordedAt_id_idx" ON "practice_evidence"("recordedAt" DESC, "id" DESC);
