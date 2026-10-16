-- Trusted prompt media selected and validated at release, independent of teacher solution assets.
ALTER TABLE "homework_assignments" ADD COLUMN "promptAssetUrls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
CREATE INDEX "homework_assignments_promptAssetUrls_idx" ON "homework_assignments" USING GIN ("promptAssetUrls");
