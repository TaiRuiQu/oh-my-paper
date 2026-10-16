-- AlterTable
ALTER TABLE "teaching_plan_versions" ADD COLUMN     "assetUrls" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "teaching_plan_versions_assetUrls_idx" ON "teaching_plan_versions" USING GIN ("assetUrls");
