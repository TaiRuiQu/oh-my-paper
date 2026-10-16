CREATE TABLE "embedding_settings" (
  "id" TEXT NOT NULL DEFAULT 'question-bank',
  "name" TEXT NOT NULL,
  "apiType" TEXT NOT NULL,
  "baseURL" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "dimensions" INTEGER NOT NULL,
  "encryptedApiKey" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "version" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "embedding_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "question_search_indexes" (
  "questionId" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "revision" TEXT NOT NULL,
  "indexedRevision" TEXT,
  "action" TEXT NOT NULL DEFAULT 'UPSERT',
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "question_search_indexes_pkey" PRIMARY KEY ("questionId")
);
CREATE INDEX "question_search_indexes_version_status_updatedAt_idx"
  ON "question_search_indexes"("version", "status", "updatedAt");

-- Use the schema that owns the triggering table, including isolated test schemas.
-- No network requests or model calls occur in a question-write transaction.
CREATE FUNCTION enqueue_question_search_index() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE active_version TEXT;
        target_id TEXT;
BEGIN
  EXECUTE format('SELECT version FROM %I.embedding_settings WHERE id = $1', TG_TABLE_SCHEMA)
    INTO active_version USING 'question-bank';
  IF active_version IS NULL THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN target_id := OLD.id; ELSE target_id := NEW.id; END IF;
  EXECUTE format('INSERT INTO %I.question_search_indexes
    ("questionId", version, revision, action, status, attempts, "updatedAt")
    VALUES ($1, $2, gen_random_uuid()::text, $3, ''PENDING'', 0, CURRENT_TIMESTAMP)
    ON CONFLICT ("questionId") DO UPDATE SET version = EXCLUDED.version,
      revision = EXCLUDED.revision, action = EXCLUDED.action, status = ''PENDING'',
      attempts = 0, error = NULL, "updatedAt" = CURRENT_TIMESTAMP', TG_TABLE_SCHEMA)
    USING target_id, active_version, CASE WHEN TG_OP = 'DELETE' THEN 'DELETE' ELSE 'UPSERT' END;
  RETURN NULL;
END;
$$;
CREATE TRIGGER question_search_index_changed
  AFTER INSERT OR UPDATE OR DELETE ON "questions"
  FOR EACH ROW EXECUTE FUNCTION enqueue_question_search_index();
