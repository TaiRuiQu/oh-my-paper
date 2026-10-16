ALTER TABLE "ai_providers" ALTER COLUMN "maxOutputTokens" SET DEFAULT 393216;

-- Apply the requested limit to providers used by the current default models.
UPDATE "ai_providers"
SET "maxOutputTokens" = 393216
WHERE "id" IN (
  SELECT "providerId" FROM "ai_models"
  WHERE "id" IN (SELECT "modelId" FROM "ai_settings" WHERE "modelId" IS NOT NULL)
);
