-- Notifications are delivered only after commit, including atomic domain commits.
-- Keep payloads small: the Web process reads the authorized snapshot from the DB.
CREATE FUNCTION notify_ai_progress() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'ai_jobs' THEN
    PERFORM pg_notify('omp_ai_progress', json_build_object(
      'schema', TG_TABLE_SCHEMA, 'kind', 'job',
      'userId', COALESCE(NEW."userId", OLD."userId"),
      'id', COALESCE(NEW.id, OLD.id)
    )::text);
  ELSIF TG_TABLE_NAME = 'ai_models' THEN
    PERFORM pg_notify('omp_ai_progress', json_build_object(
      'schema', TG_TABLE_SCHEMA, 'kind', 'models'
    )::text);
  ELSE
    PERFORM pg_notify('omp_ai_progress', json_build_object(
      'schema', TG_TABLE_SCHEMA, 'kind', 'search'
    )::text);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ai_jobs_insert_delete_notify
AFTER INSERT OR DELETE ON ai_jobs
FOR EACH ROW EXECUTE FUNCTION notify_ai_progress();

CREATE TRIGGER embedding_settings_progress_notify
AFTER INSERT OR UPDATE OR DELETE ON embedding_settings
FOR EACH ROW EXECUTE FUNCTION notify_ai_progress();

CREATE TRIGGER question_search_progress_notify
AFTER INSERT OR UPDATE OR DELETE ON question_search_indexes
FOR EACH ROW EXECUTE FUNCTION notify_ai_progress();

-- Coverage counts also change when questions are added before an embedding model exists.
CREATE TRIGGER question_search_coverage_notify
AFTER INSERT OR DELETE ON questions
FOR EACH ROW EXECUTE FUNCTION notify_ai_progress();

-- A lease heartbeat alone must not cause a progress query or a browser update.
CREATE TRIGGER ai_jobs_update_notify
AFTER UPDATE ON ai_jobs
FOR EACH ROW WHEN (
  (to_jsonb(OLD) - 'heartbeatAt' - 'workerId') IS DISTINCT FROM
  (to_jsonb(NEW) - 'heartbeatAt' - 'workerId')
) EXECUTE FUNCTION notify_ai_progress();

CREATE TRIGGER ai_models_progress_notify
AFTER INSERT OR UPDATE OR DELETE ON ai_models
FOR EACH ROW EXECUTE FUNCTION notify_ai_progress();
