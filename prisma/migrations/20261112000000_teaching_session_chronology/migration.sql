-- Session IDs are UUIDv4, so chronology and its seek cursor use immutable createdAt.
CREATE INDEX "teaching_sessions_createdAt_id_idx" ON "teaching_sessions"("createdAt" DESC, "id" DESC);
CREATE INDEX "teaching_sessions_teacherId_createdAt_id_idx" ON "teaching_sessions"("teacherId", "createdAt" DESC, "id" DESC);
