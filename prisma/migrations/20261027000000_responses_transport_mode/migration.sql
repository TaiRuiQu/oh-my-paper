ALTER TABLE "ai_providers"
  DROP COLUMN "usePreviousResponseId",
  ADD COLUMN "transportMode" TEXT NOT NULL DEFAULT 'http';

ALTER TABLE "ai_providers" ADD CONSTRAINT "ai_providers_transport_mode_check"
  CHECK ("transportMode" IN ('http', 'websocket') AND
    ("apiType" = 'openai_responses' OR "transportMode" = 'http'));
