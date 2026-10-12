ALTER TABLE "ai_providers" ADD COLUMN "maxConcurrency" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "ai_providers" ADD CONSTRAINT "ai_providers_maxConcurrency_check" CHECK ("maxConcurrency" BETWEEN 1 AND 32);
